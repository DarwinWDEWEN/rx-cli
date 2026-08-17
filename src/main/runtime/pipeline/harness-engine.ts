import type {
  AgentExecutionPolicy,
  HarnessExecutionContext,
  SkillBinding,
  TeamMemberRecord
} from '../../../shared/team-types'

// Why: Prompt 必须分层 — systemPrompt 放角色与规则，userPrompt 放场景与输入。
// 严禁把所有内容胡乱拼成一段超长 prompt。

export type HarnessRules = {
  requireProgressComment: boolean
  requireSummaryOnComplete: boolean
  scopeRequiresOwnerApproval: boolean
  forbidScopeCreep: boolean
}

export const DEFAULT_HARNESS_RULES: HarnessRules = {
  requireProgressComment: true,
  requireSummaryOnComplete: true,
  scopeRequiresOwnerApproval: true,
  forbidScopeCreep: true
}

/**
 * 构建 System Prompt。
 *
 * Why: systemPrompt 包含角色、技能、默认 Prompt、规则、反馈要求、scope 边界。
 * 这是 Agent 行为的"宪法"，不随具体任务变化。
 */
export function buildSystemPrompt(
  member: TeamMemberRecord,
  rules: HarnessRules = DEFAULT_HARNESS_RULES
): string {
  const skills = member.skills
    .filter((s: SkillBinding) => s.enabled)
    .map((s: SkillBinding) => `- ${s.skillName}`)
    .join('\n')

  // Why: explicit rule flags make the harness configurable without code changes.
  // Each rule is stated clearly so the Agent understands behavioral boundaries.
  const ruleLines: string[] = []
  if (rules.requireProgressComment) {
    ruleLines.push('1. 每次关键操作后在 Issue 中反馈进度（使用 orca issue comment 命令）')
  }
  if (rules.requireSummaryOnComplete) {
    ruleLines.push('2. 任务完成后必须评论总结')
  }
  if (rules.scopeRequiresOwnerApproval) {
    ruleLines.push('3. 超出 scope 的需求需由负责人确认')
  }
  if (rules.forbidScopeCreep) {
    ruleLines.push('4. 不要无限膨胀需求')
  }
  ruleLines.push('5. 使用 orca CLI 工具执行操作')
  ruleLines.push('6. 你的角色工作流以默认 Prompt 和当前 Harness 规则为准')

  return [
    `你是 ${member.name}，团队的 ${member.role}。`,
    '',
    '<skills>',
    skills || '（无绑定技能）',
    '</skills>',
    '',
    '<default_prompt>',
    member.defaultPrompt || '（无默认 Prompt）',
    '</default_prompt>',
    '',
    '<rules>',
    ruleLines.join('\n'),
    '</rules>'
  ].join('\n')
}

/**
 * 构建 User Prompt。
 *
 * Why: userPrompt 包含当前项目、Issue、工作线、任务说明、当前身份。
 * 这是 Agent 当前需要完成的具体工作。
 */
export function buildUserPrompt(context: HarnessExecutionContext): string {
  // Why: owner gets additional context about their integration responsibility.
  const ownerNote = context.isOwner ? '\n你是负责人，优先负责对外沟通、集成、验收和推进 PR。\n' : ''

  return [
    '<current_project>',
    `项目: ${context.projectName}`,
    `项目路径: ${context.projectPath}`,
    `宿主: ${context.hostId} (${context.hostType})`,
    '</current_project>',
    '',
    '<current_issue>',
    `Issue #${context.issueNumber}: ${context.issueTitle}`,
    `工作线: ${context.worklineKey}`,
    `你的工作目录: ${context.worktreePath}`,
    `工作模式: ${context.workMode}`,
    '</current_issue>',
    ownerNote,
    '<task>',
    context.assignmentTask,
    '</task>'
  ]
    .join('\n')
    .trim()
}

/**
 * 构建完整的 Harness Prompt（system + user 分层）。
 *
 * Why: 提供一个统一入口，返回分层后的 Prompt 供 runner 使用。
 * 调用方可选择直接使用分层 Prompt，或自行组合。
 */
export function buildHarnessPrompts(
  context: HarnessExecutionContext,
  member: TeamMemberRecord,
  rules: HarnessRules = DEFAULT_HARNESS_RULES
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: buildSystemPrompt(member, rules),
    userPrompt: buildUserPrompt(context)
  }
}

// Why: re-export for convenience.
export type { AgentExecutionPolicy }
