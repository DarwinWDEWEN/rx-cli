import type { AgentRunEvent } from '../../../shared/team-types'

// Why: 流事件归一化 — 把不同执行器返回的事件映射成统一格式，
// 维护 tool_use -> tool_result 对应关系，避免日志和追踪断链。

export type NormalizedEvent =
  | AgentRunEvent
  | { type: 'warning'; message: string; orphanCallIds?: string[] }
  | { type: 'metrics'; totalEvents: number; toolUseCount: number; toolResultCount: number }

export type NormalizerResult = {
  events: NormalizedEvent[]
  orphans: string[]
  metrics: {
    totalEvents: number
    toolUseCount: number
    toolResultCount: number
    thinkingCount: number
    textCount: number
    warningCount: number
  }
}

/**
 * 归一化 Agent 运行事件流。
 *
 * Why: 确保 tool_use 和 tool_result 配对，对未配对工具调用给出告警。
 * 无论成功失败，都产出统一的 result 事件。
 */
export async function* normalizeStream(
  source: AsyncIterable<AgentRunEvent>
): AsyncGenerator<NormalizedEvent, NormalizerResult> {
  // Why: track pending tool_use calls by callId to detect orphans at stream end.
  const pendingToolCalls = new Map<string, { toolName: string; callId: string }>()
  const orphans: string[] = []
  const events: NormalizedEvent[] = []

  let thinkingCount = 0
  let textCount = 0

  for await (const event of source) {
    switch (event.type) {
      case 'thinking':
        thinkingCount++
        break
      case 'text':
        textCount++
        break
      case 'tool_use': {
        // Why: register the tool_call — it must be paired with a tool_result later.
        pendingToolCalls.set(event.callId, { toolName: event.toolName, callId: event.callId })
        break
      }
      case 'tool_result': {
        // Why: pair with the tool_use — if no matching tool_use, it's an unexpected result.
        if (pendingToolCalls.has(event.callId)) {
          pendingToolCalls.delete(event.callId)
        } else {
          // Orphan result (no matching use) — still emit but warn.
          events.push({
            type: 'warning',
            message: `tool_result without matching tool_use: ${event.callId}`
          })
        }
        break
      }
      case 'result':
        // Why: result event is emitted as-is; no special tracking needed.
        break
    }

    events.push(event)
    yield event
  }

  // Why: at stream end, any remaining pending tool_use calls are orphans.
  if (pendingToolCalls.size > 0) {
    const orphanCallIds = [...pendingToolCalls.keys()]
    const warning: NormalizedEvent = {
      type: 'warning',
      message: `${pendingToolCalls.size} 个 tool_use 未收到 tool_result`,
      orphanCallIds
    }
    orphans.push(...orphanCallIds)
    events.push(warning)
    yield warning
  }

  // Why: emit final metrics for pipeline-tracker / telemetry.
  // Push metrics first so totalEvents includes the metrics event itself.
  const metrics: NormalizedEvent = {
    type: 'metrics',
    totalEvents: 0, // placeholder — updated after push
    toolUseCount: events.filter((e) => e.type === 'tool_use').length,
    toolResultCount: events.filter((e) => e.type === 'tool_result').length
  }
  events.push(metrics)
  metrics.totalEvents = events.length
  yield metrics

  return {
    events,
    orphans,
    metrics: {
      totalEvents: events.length,
      toolUseCount: events.filter((e) => e.type === 'tool_use').length,
      toolResultCount: events.filter((e) => e.type === 'tool_result').length,
      thinkingCount,
      textCount,
      warningCount: events.filter((e) => e.type === 'warning').length
    }
  }
}

/**
 * 辅助函数：收集归一化流的所有事件为数组。
 * Why: 测试和简单场景下方便使用。
 */
export async function collectNormalizedEvents(
  source: AsyncIterable<AgentRunEvent>
): Promise<NormalizerResult> {
  const normalized = normalizeStream(source)
  const events: NormalizedEvent[] = []

  let result: NormalizerResult | undefined
  while (true) {
    const { value, done } = await normalized.next()
    if (done) {
      result = value
      break
    }
    events.push(value)
  }

  return (
    result ?? {
      events,
      orphans: [],
      metrics: {
        totalEvents: 0,
        toolUseCount: 0,
        toolResultCount: 0,
        thinkingCount: 0,
        textCount: 0,
        warningCount: 0
      }
    }
  )
}

// Why: re-export for convenience.
export type { AgentRunEvent }
