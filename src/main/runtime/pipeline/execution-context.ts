import type {
  AgentRunner,
  HarnessExecutionContext,
  HarnessWorkMode,
  IssueWorktree
} from '../../../shared/team-types'
import type { TeamStore } from '../collaboration/team-store'
import type { ProjectStore } from '../collaboration/project-store'
import type { IssueStore } from '../collaboration/issue-store'

// Why: 显式依赖注入 — 与 collaboration-store 测试保持一致的模式，
// 确保跨-store 调用共享同一实例。
export type BuildContextDeps = {
  teamStore?: TeamStore
  projectStore?: ProjectStore
  issueStore?: IssueStore
}

export type BuildHarnessContextInput = {
  projectId: string
  issueId: string
  memberId: string
  assignmentTask: string
  worktree: IssueWorktree
  // Why: worktreePath 是文件系统真实路径，不是 worktree 实体 ID。
  // 由上层 runtime（host-aware）解析后传入，空路径 fail fast。
  worktreePath: string
  workMode?: HarnessWorkMode
}

/**
 * 组装 Harness 执行上下文快照。
 *
 * Why: 不能只传一个字符串 prompt — 必须显式建模统一上下文。
 * 缺关键字段时直接 fail fast，不在这里做业务状态变更。
 */
export function buildHarnessExecutionContext(
  input: BuildHarnessContextInput,
  deps: BuildContextDeps = {}
): HarnessExecutionContext {
  const teamStore = deps.teamStore
  const projectStore = deps.projectStore
  const issueStore = deps.issueStore

  if (!teamStore || !projectStore || !issueStore) {
    throw new Error('buildHarnessExecutionContext: missing required store dependencies')
  }

  // Why: worktreePath 必须是真实文件系统路径，空路径说明上层解析失败。
  if (!input.worktreePath) {
    throw new Error('buildHarnessExecutionContext: worktreePath is required')
  }

  const project = projectStore.get(input.projectId)
  if (!project) {
    throw new Error(`Project not found: ${input.projectId}`)
  }

  const issue = issueStore.get(input.issueId)
  if (!issue) {
    throw new Error(`Issue not found: ${input.issueId}`)
  }

  // Why: issue must belong to the project — fail fast on data inconsistency.
  if (issue.projectId !== project.id) {
    throw new Error(`Issue ${issue.id} does not belong to project ${project.id}`)
  }

  const member = teamStore.get(input.memberId)
  if (!member) {
    throw new Error(`Team member not found: ${input.memberId}`)
  }

  // Why: 执行者必须属于项目团队 — 与 issue-store 的 assertOwnerInProject 保持
  // 一致的硬性 invariant。不能允许全局团队成员以任意项目身份执行。
  const projectMembers = projectStore.listMembers(input.projectId)
  const isInProject = projectMembers.some((m) => m.memberId === input.memberId)
  if (!isInProject) {
    throw new Error(`Team member is not in the project team: ${input.memberId}`)
  }

  // Why: worktree 必须归属当前执行者 — 防止用别人的 worktree 组装上下文。
  if (input.worktree.memberId !== input.memberId) {
    throw new Error(`Worktree ${input.worktree.id} does not belong to member ${input.memberId}`)
  }

  // Why: isOwner is derived from issue ownership, not from project team role.
  // An Agent acting as owner has integration/communication responsibilities.
  const isOwner = issue.ownerId === member.id

  return {
    projectId: project.id,
    projectPath: project.repoPath,
    projectName: project.name,
    hostId: project.hostId,
    hostType: project.hostType,
    issueId: issue.id,
    issueNumber: issue.number,
    issueTitle: issue.title,
    worklineKey: issue.worklineKey,
    memberId: member.id,
    memberName: member.name,
    role: member.role,
    assignmentTask: input.assignmentTask,
    worktreePath: input.worktreePath,
    workMode: input.workMode ?? 'execute',
    isOwner
  }
}

// Why: re-export so pipeline consumers can import from a single barrel.
export type { AgentRunner }
export type { HarnessExecutionContext }
