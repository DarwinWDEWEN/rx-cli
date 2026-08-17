import type {
  AgentRunner,
  AgentRunEvent,
  AgentRunRequest,
  AgentExecutionPolicy
} from '../../../shared/team-types'

// Why: AgentRunner 是统一接口 — 不要和某一个具体 CLI 深度绑定。
// 本轮先做最小 MockRunner，但保持后续可扩展为真实 CLI runner。

/**
 * Mock Agent Runner — 用于测试和开发阶段的最小实现。
 *
 * Why: 在真实 CLI runner 就绪之前，MockRunner 可以产出统一事件流，
 * 让上层（stream-event-normalizer / pipeline-tracker）先跑通。
 *
 * 它模拟了一个简单的 Agent 执行过程：
 * 1. thinking → 表示 Agent 正在思考
 * 2. text → 输出一段文本
 * 3. tool_use → 调用一个工具
 * 4. tool_result → 工具返回结果
 * 5. result → 最终完成
 */
export class MockAgentRunner implements AgentRunner {
  private readonly defaultSteps: AgentRunEvent[]

  constructor(steps?: AgentRunEvent[]) {
    // Why: 可注入自定义事件序列，方便测试不同场景。
    this.defaultSteps = steps ?? [
      { type: 'thinking', text: '分析任务需求...' },
      { type: 'text', text: '开始执行任务。' },
      { type: 'tool_use', toolName: 'bash', callId: 'call-1', input: 'echo hello' },
      { type: 'tool_result', toolName: 'bash', callId: 'call-1', content: 'hello' },
      { type: 'result', status: 'success', summary: '任务完成' }
    ]
  }

  async *run(_request: AgentRunRequest): AsyncIterable<AgentRunEvent> {
    // Why: 忽略 request 参数 — MockRunner 只产出预设事件序列。
    // 真实 runner 会使用 request.systemPrompt / userPrompt / policy 来驱动 CLI。
    for (const step of this.defaultSteps) {
      yield step
    }
  }
}

/**
 * 卡住型 Agent Runner — 用于测试超时策略。
 *
 * Why: 模拟 Agent 长时间无输出的场景。配合 withPolicy 包装层使用时，
 * idleTimeout 到达后应被真正中断（不再等到 sleep 结束）。
 */
export class StuckAgentRunner implements AgentRunner {
  async *run(request: AgentRunRequest): AsyncIterable<AgentRunEvent> {
    // Why: yield one thinking event then hang — simulates a stuck agent.
    yield { type: 'thinking', text: '开始处理...' }
    // Simulate idle: wait longer than the policy allows.
    await new Promise((resolve) => setTimeout(resolve, request.policy.idleTimeoutMs + 1000))
    // This should never be reached if timeout is enforced correctly.
    yield { type: 'result', status: 'failed', reason: 'should have timed out' }
  }
}

/**
 * 失败路径 Runner — 模拟 Agent 执行失败。
 *
 * Why: 测试 stream-event-normalizer 对失败事件的处理。
 */
export class FailingAgentRunner implements AgentRunner {
  async *run(_request: AgentRunRequest): AsyncIterable<AgentRunEvent> {
    yield { type: 'thinking', text: '尝试执行...' }
    yield { type: 'text', text: '遇到错误' }
    yield { type: 'tool_use', toolName: 'bash', callId: 'call-err', input: 'invalid-cmd' }
    yield {
      type: 'tool_result',
      toolName: 'bash',
      callId: 'call-err',
      content: 'command not found',
      isError: true
    }
    yield { type: 'result', status: 'failed', reason: '工具执行失败' }
  }
}

/**
 * 策略强制层 — 包装任意 AgentRunner，强制执行执行策略。
 *
 * Why: maxTurns / idleTimeoutMs / allowedTools 不应依赖 runner 自行遵守，
 * 而应由外层统一强制执行。这样无论底层 runner 如何实现，策略都能生效。
 *
 * 功能：
 * - idleTimeout: 两次事件之间超过 idleTimeoutMs 则中断（真正中断，不是等到下个事件）
 * - maxTurns: 超出最大轮次时产出 failed result 并终止
 * - allowedTools: 非白名单 tool_use 产出 warning（不阻止，留给上层决定）
 */
export async function* withPolicy(
  runner: AgentRunner,
  request: AgentRunRequest
): AsyncGenerator<AgentRunEvent> {
  const policy = request.policy
  let turnCount = 0
  let lastEventTime = Date.now()

  // Why: 使用可重置的定时器来实现真正的 idleTimeout 中断。
  // 每次收到事件时重置定时器；定时器触发时说明 idleTimeout 到达。
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let timedOut = false

  function resetTimer(): void {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      timedOut = true
    }, policy.idleTimeoutMs)
  }

  // Why: 将 async iterator 转为 pull-based，这样才能 race next() 与 timer。
  // for await 会阻塞在 iterator 上，无法在等待时检查超时。
  const iterator = runner.run(request)[Symbol.asyncIterator]()

  resetTimer()

  try {
    while (true) {
      // Why: 检查是否已被超时中断（定时器在等待期间触发）。
      if (timedOut) {
        yield {
          type: 'result',
          status: 'failed',
          reason: `idle timeout: no event for ${policy.idleTimeoutMs}ms`
        }
        return
      }

      // Why: race iterator.next() 与剩余超时时间，实现真正的中断。
      const remainingMs = policy.idleTimeoutMs - (Date.now() - lastEventTime)
      const timeoutPromise = new Promise<{ type: 'timeout' }>((resolve) =>
        setTimeout(() => resolve({ type: 'timeout' }), Math.max(0, remainingMs))
      )

      const result = await Promise.race([iterator.next(), timeoutPromise])

      // Why: 超时先到达，中断执行。
      if ('type' in result && result.type === 'timeout') {
        timedOut = true
        yield {
          type: 'result',
          status: 'failed',
          reason: `idle timeout: no event for ${policy.idleTimeoutMs}ms`
        }
        return
      }

      const { value: event, done } = result as IteratorResult<AgentRunEvent>
      if (done || !event) {
        return
      }

      const now = Date.now()
      lastEventTime = now

      // Why: 轮次计数 — 每个 tool_use 计为一轮（代表一次 Agent 行动）。
      if (event.type === 'tool_use') {
        turnCount++
        // Why: allowedTools 白名单检查。
        if (policy.allowedTools.length > 0 && !policy.allowedTools.includes(event.toolName)) {
          yield {
            type: 'text',
            text: `[policy warning] tool "${event.toolName}" not in allowed list`
          }
        }
      }

      yield event

      // Why: 超出 maxTurns 时强制终止。
      if (turnCount >= policy.maxTurns) {
        yield {
          type: 'result',
          status: 'failed',
          reason: `max turns exceeded: ${policy.maxTurns}`
        }
        return
      }

      // Why: 每次成功产出事件后重置定时器。
      resetTimer()
    }
  } finally {
    // Why: 清理定时器，防止内存泄漏。
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

// Why: re-export for convenience.
export type { AgentRunner, AgentRunEvent, AgentRunRequest, AgentExecutionPolicy }
