import type { HarnessExecutionContext, AgentRunEvent } from '../../../shared/team-types'
import type { NormalizerResult } from './stream-event-normalizer'
import type { IssueCommentStore } from '../collaboration/issue-comment-store'
import { getIssueCommentStore } from '../collaboration/issue-comment-store'

// Why: 执行结果总结 — 从归一化事件流提炼结构化总结。
// 本轮是确定性规则总结（不用 LLM），遵循 Harness 原则：系统落库负责事实。

export type RunSummary = {
  status: 'success' | 'failed'
  summary: string
  toolUseCount: number
  toolSuccessCount: number
  toolFailureCount: number
  orphanCount: number
}

/**
 * 从归一化事件流提炼执行总结。
 *
 * Why: 将原始事件流转为结构化摘要，供评论回写使用。
 * 不使用 LLM — 本轮是确定性规则总结。
 */
export function summarizeRun(
  events: AgentRunEvent[],
  normalizerResult: NormalizerResult
): RunSummary {
  const resultEvent = events.find((e) => e.type === 'result') as
    | { type: 'result'; status: 'success' | 'failed'; summary?: string; reason?: string }
    | undefined

  const toolUseEvents = events.filter((e) => e.type === 'tool_use')
  const toolResultEvents = events.filter((e) => e.type === 'tool_result') as {
    type: 'tool_result'
    isError?: boolean
  }[]

  // Why: 提取最后一段有意义的文本作为摘要补充。
  const lastText = [...events].toReversed().find((e) => e.type === 'text') as
    | { type: 'text'; text: string }
    | undefined

  const status = resultEvent?.status ?? 'failed'

  // Why: 优先使用 result.summary，其次使用最后一段文本，最后使用 reason。
  let summary: string
  if (resultEvent?.summary) {
    summary = resultEvent.summary
  } else if (status === 'failed' && resultEvent?.reason) {
    summary = resultEvent.reason
  } else if (lastText?.text) {
    summary = lastText.text
  } else {
    summary = status === 'success' ? '执行完成' : '执行失败'
  }

  return {
    status,
    summary,
    toolUseCount: toolUseEvents.length,
    toolSuccessCount: toolResultEvents.filter((e) => !e.isError).length,
    toolFailureCount: toolResultEvents.filter((e) => e.isError).length,
    orphanCount: normalizerResult.orphans.length
  }
}

/**
 * 组装评论正文。
 *
 * Why: 评论包含执行者、角色、结果状态、总结、工具统计。
 * 负责人/成员标注由 context.isOwner 推导。
 */
function buildCommentBody(context: HarnessExecutionContext, runSummary: RunSummary): string {
  const roleLabel = context.isOwner ? '[负责人]' : '[成员]'
  const statusLabel = runSummary.status === 'success' ? '✅ 成功' : '❌ 失败'

  const lines = [
    `${roleLabel} ${context.memberName}（${context.role}）执行报告`,
    '',
    `**状态**: ${statusLabel}`,
    `**摘要**: ${runSummary.summary}`,
    '',
    `**工具调用**: ${runSummary.toolUseCount} 次（成功 ${runSummary.toolSuccessCount} / 失败 ${runSummary.toolFailureCount}）`
  ]

  if (runSummary.orphanCount > 0) {
    lines.push(`**警告**: ${runSummary.orphanCount} 个工具调用未收到结果`)
  }

  return lines.join('\n')
}

export type PostRunCommentDeps = {
  commentStore?: IssueCommentStore
}

/**
 * 评论回写闭环。
 *
 * Why: Agent 执行完成后自动在 Issue 评论中反馈进度/结果。
 * 不自动改 Issue 状态（status 流转属于负责人决策）。
 */
export function postRunComment(
  context: HarnessExecutionContext,
  events: AgentRunEvent[],
  normalizerResult: NormalizerResult,
  deps: PostRunCommentDeps = {}
): { commentId: string; body: string } {
  const commentStore = deps.commentStore ?? getIssueCommentStore()

  const runSummary = summarizeRun(events, normalizerResult)
  const body = buildCommentBody(context, runSummary)

  // Why: 使用 agent 作为 authorType，因为这是 Agent 执行后的自动回写。
  const comment = commentStore.create({
    issueId: context.issueId,
    authorId: context.memberId,
    authorType: 'agent',
    authorName: context.memberName,
    body,
    visibility: 'project_team'
  })

  return { commentId: comment.id, body }
}

// Why: re-export for convenience.
export type { AgentRunEvent }
