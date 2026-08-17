// 协作模块共享领域类型（Team/Issue/PR/Worktree）。
// 主进程 Store 与 IPC 契约共用；renderer 通过 IPC 消费，不直接读库。
//
// 收敛自 TECH-DESIGN §3.1 TeamMember / §2.2-§2.3 表结构。
// 时间戳遵循 Orca 既有约定（ISO 8601 TEXT），与设计文档的 INTEGER 不同。

import type { AgentType } from './agent-status-types'

// TECH-DESIGN §3.1 — 技能绑定
export type SkillBinding = {
  skillId: string
  skillName: string
  enabled: boolean
  config?: Record<string, unknown>
}

// TECH-DESIGN §3.1 — TeamMember（设计字段全集）
export type TeamMember = {
  id: string
  name: string
  role: string
  avatarUrl?: string
  personality: string
  responsibilities: string[]
  capabilities: string[]
  agentType: AgentType
  agentModel: string
  agentConfig: Record<string, unknown>
  skills: SkillBinding[]
  defaultPrompt: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// Orca 上层扩展（不归入协作域核心模型，但 DB 仍承载）。
// Why: status 不单独存 — is_active 已是单一状态源，避免双写不一致。
export type TeamMemberOrca = {
  hostType: string
  workspaceAccess: string[]
  customModelPackageDir?: string
  identity?: string
  totalTasks: number
  activeProjects: number
  activeWorktrees: number
}

export type TeamMemberRecord = TeamMember & TeamMemberOrca

// Why: name/role/agentType/agentModel are required (no defaults). All other fields
// are optional — the store applies defensive defaults when omitted. This lets direct
// callers (tests, future non-IPC code) rely on the store's defaults like IPC does.
export type CreateTeamMemberInput = Pick<TeamMember, 'name' | 'role' | 'agentType' | 'agentModel'> &
  Partial<
    Omit<
      TeamMember & TeamMemberOrca,
      | 'id'
      | 'name'
      | 'role'
      | 'agentType'
      | 'agentModel'
      | 'totalTasks'
      | 'activeProjects'
      | 'activeWorktrees'
      | 'createdAt'
      | 'updatedAt'
    >
  >

// Why: Clearable<T> lets the store distinguish "don't touch this field" (undefined)
// from "explicitly clear this optional field" (null). JSON-serializable so it can
// cross IPC without losing the null marker.
type Clearable<T> = T | null | undefined

// Why: on update, undefined = leave untouched, null = clear (for nullable fields).
// Required scalar fields (name/role/personality/agentType/agentModel/defaultPrompt)
// stay string so the store always writes a value.
export type UpdateTeamMemberInput = {
  id: string
  name?: string
  role?: string
  avatarUrl?: Clearable<string>
  personality?: string
  responsibilities?: string[]
  capabilities?: string[]
  agentType?: AgentType
  agentModel?: string
  agentConfig?: Record<string, unknown>
  skills?: SkillBinding[]
  defaultPrompt?: string
  isActive?: boolean
  hostType?: string
  workspaceAccess?: string[]
  customModelPackageDir?: Clearable<string>
  identity?: Clearable<string>
}

export type DeleteConstraintResult = { canDelete: true } | { canDelete: false; reasons: string[] }

// ── 项目域 ──────────────────────────────────────────────────────────────────

export type Project = {
  id: string
  name: string
  description: string
  workspaceId?: string
  hostId: string
  hostType: string
  repoPath: string
  defaultBranch: string
  gitInitialized: boolean
  status: string
  createdAt: string
  updatedAt: string
}

// Orca 扩展字段
export type ProjectOrca = {
  repoUrl?: string
  owner?: string
  repo?: string
  workspaceType?: string
}

// ── Issue 域 ─────────────────────────────────────────────────────────────────

// Why: TECH-DESIGN §2.2 只定义 open/done 两态；后续 M3 Pipeline 可扩展
export type IssueStatus = 'open' | 'done'
export type IssuePriority = 'low' | 'medium' | 'high' | 'urgent'

export type Issue = {
  id: string
  projectId: string
  number: number
  title: string
  description: string
  status: IssueStatus
  priority: IssuePriority
  ownerId: string
  worklineKey: string
  worklineState: string
  createdAt: string
  updatedAt: string
}

export type IssueComment = {
  id: string
  issueId: string
  authorId: string
  authorType: 'user' | 'agent'
  authorName: string
  body: string
  visibility: 'project_team' | 'public'
  createdAt: string
}

// ── PR 域 ────────────────────────────────────────────────────────────────────

export type PullRequestStatus = 'open' | 'merged' | 'closed'

export type PullRequest = {
  id: string
  projectId: string
  issueId?: string
  number: number
  title: string
  description: string
  status: PullRequestStatus
  sourceBranch: string
  targetBranch: string
  authorId: string
  reviewers: string[]
  approvals: string[]
  createdAt: string
  updatedAt: string
}

export type PrComment = {
  id: string
  prId: string
  authorId: string
  authorType: 'user' | 'agent'
  authorName: string
  body: string
  filePath?: string
  lineNumber?: number
  createdAt: string
}

// ── Worktree / Git ref 域 ────────────────────────────────────────────────────

export type IssueWorktree = {
  id: string
  issueId: string
  memberId: string
  worktreeId: string
  terminalId?: string
  activeRefName?: string
  hostId: string
  status: string
  createdAt: string
  updatedAt: string
}

export type IssueGitRef = {
  id: string
  issueId: string
  refName: string
  refRole: 'owner' | 'member' | 'release' | 'experiment'
  memberId?: string
  purpose: string
  status: string
  createdAt: string
  updatedAt: string
}

export type ActivityLog = {
  id: string
  projectId?: string
  actorType: string
  actorId: string
  actorName: string
  action: string
  targetType?: string
  targetId?: string
  metadata: Record<string, unknown>
  createdAt: string
}

export type ProjectTeamMember = {
  id: string
  projectId: string
  memberId: string
  roleInProject: string
  joinedAt: string
}

// ── Harness 运行时骨架 ──────────────────────────────────────────────────────
// Why: Harness 是运行时约束层，负责上下文注入、Prompt 规则、反馈要求和收敛策略。
// 这些类型定义了 Harness 基础骨架的统一契约，供 execution-context / harness-engine /
// agent-runner / stream-event-normalizer 四层共用。

/** Agent 执行模式：执行 / 评审 / 咨询 */
export type HarnessWorkMode = 'execute' | 'review' | 'ask'

/**
 * Harness 执行上下文快照。
 * Why: 不能只传一个字符串 prompt — 必须显式建模统一上下文，让 Agent 知道
 * 自己在谁的项目、哪条工作线、以什么身份工作。
 */
export type HarnessExecutionContext = {
  projectId: string
  projectPath: string
  projectName: string
  hostId: string
  hostType: string
  issueId: string
  issueNumber: number
  issueTitle: string
  worklineKey: string
  memberId: string
  memberName: string
  role: string
  assignmentTask: string
  worktreePath: string
  workMode: HarnessWorkMode
  isOwner: boolean
}

/**
 * Agent 执行策略。
 * Why: 轮次上限、超时、工具白名单、遥测开关不应散落在业务代码中。
 */
export type AgentExecutionPolicy = {
  maxTurns: number
  firstTokenTimeoutMs: number
  idleTimeoutMs: number
  allowedTools: string[]
  requireProgressComment: boolean
}

/**
 * 统一的 Agent 运行事件。
 * Why: 为后续 pipeline-tracker 和评论回写打基础 — 不同执行器的输出都映射到这个格式。
 */
export type AgentRunEvent =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; toolName: string; callId: string; input?: unknown }
  | { type: 'tool_result'; toolName: string; callId: string; content: string; isError?: boolean }
  | { type: 'result'; status: 'success' | 'failed'; summary?: string; reason?: string }

/**
 * Agent 执行器统一接口。
 * Why: 不要和某一个具体 CLI 深度绑定 — 提供统一接口，保持后续可扩展。
 */
export type AgentRunRequest = {
  agentType: string
  command: string
  env: Record<string, string>
  context: HarnessExecutionContext
  policy: AgentExecutionPolicy
  systemPrompt: string
  userPrompt: string
}

export type AgentRunner = {
  run(request: AgentRunRequest): AsyncIterable<AgentRunEvent>
}
