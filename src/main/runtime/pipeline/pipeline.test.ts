import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') }
}))

const dbMod = await import('../collaboration/collaboration-database')
const { createTeamStore, __resetTeamStoreForTests } = await import('../collaboration/team-store')
const { createProjectStore, __resetProjectStoreForTests } =
  await import('../collaboration/project-store')
const { createIssueStore, __resetIssueStoreForTests } = await import('../collaboration/issue-store')
const { __resetCollaborationDbForTests, __setCollaborationDbPathForTests } = dbMod

// ── Harness 类型 ──────────────────────────────────────────────────────────────

import type {
  AgentRunEvent,
  HarnessExecutionContext,
  Issue,
  IssueWorktree,
  Project,
  TeamMemberRecord
} from '../../../shared/team-types'

// ── 被测模块 ──────────────────────────────────────────────────────────────────

const { buildHarnessExecutionContext } = await import('./execution-context')
const { buildSystemPrompt, buildUserPrompt, buildHarnessPrompts, DEFAULT_HARNESS_RULES } =
  await import('./harness-engine')
const { MockAgentRunner, FailingAgentRunner, StuckAgentRunner, withPolicy } =
  await import('./agent-runner')
const { collectNormalizedEvents } = await import('./stream-event-normalizer')

// ── 测试 Fixtures ─────────────────────────────────────────────────────────────

function makeMember(
  store: ReturnType<typeof createTeamStore>,
  over: Partial<TeamMemberRecord> = {}
): TeamMemberRecord {
  return store.create({
    name: 'Alice',
    role: 'lead',
    agentType: 'claude',
    agentModel: 'claude-sonnet',
    personality: 'detail-oriented',
    responsibilities: ['review'],
    capabilities: ['code'],
    agentConfig: { foo: 'bar' },
    skills: [
      { skillId: 's1', skillName: 'TypeScript', enabled: true },
      { skillId: 's2', skillName: 'Testing', enabled: false }
    ],
    defaultPrompt: 'Be precise.',
    isActive: true,
    hostType: 'local',
    workspaceAccess: ['/tmp/p'],
    ...over
  })
}

function makeProject(
  store: ReturnType<typeof createProjectStore>,
  name = 'Test Project',
  repoPath = '/tmp/test-repo'
): Project {
  return store.register({
    name,
    hostId: 'local',
    hostType: 'local',
    repoPath
  })
}

function makeIssue(
  store: ReturnType<typeof createIssueStore>,
  projectId: string,
  ownerId: string
): Issue {
  return store.create({
    projectId,
    title: 'Fix bug',
    ownerId
  })
}

// Why: worktreeId 是实体 ID（如 'wt-xyz'），不是路径。worktreePath 是真实文件系统路径，
// 由上层 runtime 解析后传入。两者语义不同，测试必须显式区分。
function makeWorktree(issueId: string, memberId: string): IssueWorktree {
  return {
    id: `wt_${memberId}`,
    issueId,
    memberId,
    worktreeId: `wt-${memberId}-xyz`, // 实体 ID 样式
    hostId: 'local',
    status: 'active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01'
  }
}

// Why: 真实文件系统路径，由上层 runtime 解析后传入。
function makeWorktreePath(memberId: string): string {
  return `/home/user/workspaces/wt-${memberId}`
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('Harness 基础骨架', () => {
  let teamStore: ReturnType<typeof createTeamStore>
  let projectStore: ReturnType<typeof createProjectStore>
  let issueStore: ReturnType<typeof createIssueStore>

  beforeEach(() => {
    __resetCollaborationDbForTests()
    __setCollaborationDbPathForTests(':memory:')
    __resetTeamStoreForTests()
    __resetProjectStoreForTests()
    __resetIssueStoreForTests()
    teamStore = createTeamStore()
    projectStore = createProjectStore({ teamStore })
    issueStore = createIssueStore({ projectStore, teamStore })
  })

  afterEach(() => {
    __resetTeamStoreForTests()
    __resetProjectStoreForTests()
    __resetIssueStoreForTests()
    __resetCollaborationDbForTests()
  })

  // ── execution-context ──────────────────────────────────────────────────────

  describe('execution-context', () => {
    it('正常组装成功', () => {
      const member = makeMember(teamStore)
      const project = makeProject(projectStore)
      projectStore.inviteMember(project.id, member.id, 'owner')
      const issue = makeIssue(issueStore, project.id, member.id)
      const worktree = makeWorktree(issue.id, member.id)

      const ctx = buildHarnessExecutionContext(
        {
          projectId: project.id,
          issueId: issue.id,
          memberId: member.id,
          assignmentTask: '实现登录功能',
          worktree,
          worktreePath: makeWorktreePath(member.id)
        },
        { teamStore, projectStore, issueStore }
      )

      expect(ctx.projectId).toBe(project.id)
      expect(ctx.projectPath).toBe(project.repoPath)
      expect(ctx.projectName).toBe('Test Project')
      expect(ctx.issueId).toBe(issue.id)
      expect(ctx.issueNumber).toBe(issue.number)
      expect(ctx.issueTitle).toBe('Fix bug')
      expect(ctx.worklineKey).toBe(issue.worklineKey)
      expect(ctx.memberId).toBe(member.id)
      expect(ctx.memberName).toBe('Alice')
      expect(ctx.role).toBe('lead')
      expect(ctx.assignmentTask).toBe('实现登录功能')
      // Why: worktreePath 是真实路径，不是 worktreeId。
      expect(ctx.worktreePath).toBe(makeWorktreePath(member.id))
      expect(ctx.workMode).toBe('execute') // default
      expect(ctx.isOwner).toBe(true)
    })

    it('缺项目时 fail fast', () => {
      const member = makeMember(teamStore)
      const worktree = makeWorktree('iss_x', member.id)

      expect(() =>
        buildHarnessExecutionContext(
          {
            projectId: 'proj_missing',
            issueId: 'iss_x',
            memberId: member.id,
            assignmentTask: 'task',
            worktree,
            worktreePath: makeWorktreePath(member.id)
          },
          { teamStore, projectStore, issueStore }
        )
      ).toThrow(/Project not found/)
    })

    it('缺 Issue 时 fail fast', () => {
      const member = makeMember(teamStore)
      const project = makeProject(projectStore)
      const worktree = makeWorktree('iss_missing', member.id)

      expect(() =>
        buildHarnessExecutionContext(
          {
            projectId: project.id,
            issueId: 'iss_missing',
            memberId: member.id,
            assignmentTask: 'task',
            worktree,
            worktreePath: makeWorktreePath(member.id)
          },
          { teamStore, projectStore, issueStore }
        )
      ).toThrow(/Issue not found/)
    })

    it('Issue 不属于 Project 时 fail fast', () => {
      const member = makeMember(teamStore)
      // Why: different repoPath to avoid UNIQUE(host_id, repo_path) constraint.
      const project1 = makeProject(projectStore, 'Project A', '/tmp/project-a')
      const project2 = makeProject(projectStore, 'Project B', '/tmp/project-b')
      projectStore.inviteMember(project1.id, member.id)
      projectStore.inviteMember(project2.id, member.id)
      const issue = makeIssue(issueStore, project1.id, member.id)
      const worktree = makeWorktree(issue.id, member.id)

      expect(() =>
        buildHarnessExecutionContext(
          {
            projectId: project2.id, // wrong project
            issueId: issue.id,
            memberId: member.id,
            assignmentTask: 'task',
            worktree,
            worktreePath: makeWorktreePath(member.id)
          },
          { teamStore, projectStore, issueStore }
        )
      ).toThrow(/does not belong to project/)
    })

    // Why: 回归测试 — 执行者不属于项目团队时必须抛错。
    it('执行者不属于项目团队时 fail fast', () => {
      const member = makeMember(teamStore)
      const outsider = makeMember(teamStore, { name: 'Outsider' })
      const project = makeProject(projectStore)
      // Why: only member is invited, outsider is NOT in the project team.
      projectStore.inviteMember(project.id, member.id, 'owner')
      const issue = makeIssue(issueStore, project.id, member.id)
      const worktree = makeWorktree(issue.id, outsider.id)

      expect(() =>
        buildHarnessExecutionContext(
          {
            projectId: project.id,
            issueId: issue.id,
            memberId: outsider.id, // not in project team
            assignmentTask: 'task',
            worktree,
            worktreePath: makeWorktreePath(outsider.id)
          },
          { teamStore, projectStore, issueStore }
        )
      ).toThrow(/not in the project team/)
    })

    // Why: 回归测试 — worktree 归属必须与执行者一致。
    it('worktree 不属于执行者时 fail fast', () => {
      const owner = makeMember(teamStore, { name: 'Owner' })
      const dev = makeMember(teamStore, { name: 'Dev', role: 'dev' })
      const project = makeProject(projectStore)
      projectStore.inviteMember(project.id, owner.id, 'owner')
      projectStore.inviteMember(project.id, dev.id, 'member')
      const issue = makeIssue(issueStore, project.id, owner.id)
      // Why: worktree belongs to dev, but we try to use it with owner.
      const worktree = makeWorktree(issue.id, dev.id)

      expect(() =>
        buildHarnessExecutionContext(
          {
            projectId: project.id,
            issueId: issue.id,
            memberId: owner.id,
            assignmentTask: 'task',
            worktree,
            worktreePath: makeWorktreePath(owner.id)
          },
          { teamStore, projectStore, issueStore }
        )
      ).toThrow(/does not belong to member/)
    })

    it('worktreePath 为空时 fail fast', () => {
      const member = makeMember(teamStore)
      const project = makeProject(projectStore)
      projectStore.inviteMember(project.id, member.id)
      const issue = makeIssue(issueStore, project.id, member.id)
      const worktree = makeWorktree(issue.id, member.id)

      expect(() =>
        buildHarnessExecutionContext(
          {
            projectId: project.id,
            issueId: issue.id,
            memberId: member.id,
            assignmentTask: 'task',
            worktree,
            worktreePath: '' // empty path
          },
          { teamStore, projectStore, issueStore }
        )
      ).toThrow(/worktreePath is required/)
    })

    it('非负责人时 isOwner 为 false', () => {
      const owner = makeMember(teamStore, { name: 'Owner' })
      const dev = makeMember(teamStore, { name: 'Dev', role: 'dev' })
      const project = makeProject(projectStore)
      projectStore.inviteMember(project.id, owner.id, 'owner')
      projectStore.inviteMember(project.id, dev.id, 'member')
      const issue = makeIssue(issueStore, project.id, owner.id)
      const worktree = makeWorktree(issue.id, dev.id)

      const ctx = buildHarnessExecutionContext(
        {
          projectId: project.id,
          issueId: issue.id,
          memberId: dev.id,
          assignmentTask: '开发任务',
          worktree,
          worktreePath: makeWorktreePath(dev.id)
        },
        { teamStore, projectStore, issueStore }
      )

      expect(ctx.isOwner).toBe(false)
    })

    it('支持自定义 workMode', () => {
      const member = makeMember(teamStore)
      const project = makeProject(projectStore)
      projectStore.inviteMember(project.id, member.id)
      const issue = makeIssue(issueStore, project.id, member.id)
      const worktree = makeWorktree(issue.id, member.id)

      const ctx = buildHarnessExecutionContext(
        {
          projectId: project.id,
          issueId: issue.id,
          memberId: member.id,
          assignmentTask: 'review code',
          worktree,
          worktreePath: makeWorktreePath(member.id),
          workMode: 'review'
        },
        { teamStore, projectStore, issueStore }
      )

      expect(ctx.workMode).toBe('review')
    })
  })

  // ── harness-engine ─────────────────────────────────────────────────────────

  describe('harness-engine', () => {
    let member: TeamMemberRecord

    beforeEach(() => {
      // Why: teamStore must be initialized before makeMember is called.
      member = makeMember(teamStore)
    })

    it('systemPrompt 包含角色、技能、规则', () => {
      const prompt = buildSystemPrompt(member, DEFAULT_HARNESS_RULES)
      expect(prompt).toContain('Alice')
      expect(prompt).toContain('lead')
      expect(prompt).toContain('TypeScript')
      // Why: disabled skill should NOT appear in the prompt.
      expect(prompt).not.toContain('Testing')
      expect(prompt).toContain('Be precise.')
      expect(prompt).toContain('orca issue comment')
      expect(prompt).toContain('超出 scope')
      expect(prompt).toContain('不要无限膨胀需求')
    })

    it('userPrompt 包含项目、Issue、任务信息', () => {
      const ctx: HarnessExecutionContext = {
        projectId: 'p1',
        projectPath: '/repo',
        projectName: 'My Project',
        hostId: 'local',
        hostType: 'local',
        issueId: 'i1',
        issueNumber: 12,
        issueTitle: 'Fix bug',
        worklineKey: 'issue-12',
        memberId: 'm1',
        memberName: 'Alice',
        role: 'lead',
        assignmentTask: '实现功能 X',
        worktreePath: '/home/user/workspaces/wt-m1',
        workMode: 'execute',
        isOwner: true
      }

      const prompt = buildUserPrompt(ctx)
      expect(prompt).toContain('My Project')
      expect(prompt).toContain('/repo')
      expect(prompt).toContain('Issue #12')
      expect(prompt).toContain('Fix bug')
      expect(prompt).toContain('issue-12')
      expect(prompt).toContain('实现功能 X')
      expect(prompt).toContain('/home/user/workspaces/wt-m1')
      // Why: owner gets extra responsibility note.
      expect(prompt).toContain('负责人')
    })

    it('非负责人不包含负责人提示', () => {
      const ctx: HarnessExecutionContext = {
        projectId: 'p1',
        projectPath: '/repo',
        projectName: 'My Project',
        hostId: 'local',
        hostType: 'local',
        issueId: 'i1',
        issueNumber: 12,
        issueTitle: 'Fix bug',
        worklineKey: 'issue-12',
        memberId: 'm1',
        memberName: 'Bob',
        role: 'dev',
        assignmentTask: '编码实现',
        worktreePath: '/home/user/workspaces/wt-m1',
        workMode: 'execute',
        isOwner: false
      }

      const prompt = buildUserPrompt(ctx)
      expect(prompt).not.toContain('负责人')
    })

    it('buildHarnessPrompts 返回分层 Prompt', () => {
      const ctx: HarnessExecutionContext = {
        projectId: 'p1',
        projectPath: '/repo',
        projectName: 'Project',
        hostId: 'local',
        hostType: 'local',
        issueId: 'i1',
        issueNumber: 1,
        issueTitle: 'Task',
        worklineKey: 'issue-1',
        memberId: 'm1',
        memberName: 'Alice',
        role: 'lead',
        assignmentTask: 'Do something',
        worktreePath: '/home/user/workspaces/wt-m1',
        workMode: 'execute',
        isOwner: true
      }

      const { systemPrompt, userPrompt } = buildHarnessPrompts(ctx, member)

      expect(systemPrompt).toContain('Alice')
      expect(systemPrompt).toContain('<rules>')
      expect(userPrompt).toContain('Issue #1')
      expect(userPrompt).toContain('Do something')
    })
  })

  // ── agent-runner ───────────────────────────────────────────────────────────
  // Why: mockRequest is shared across agent-runner and stream-event-normalizer tests.
  const mockRequest = {
    agentType: 'claude',
    command: 'echo test',
    env: {},
    context: {} as HarnessExecutionContext,
    policy: {
      maxTurns: 10,
      firstTokenTimeoutMs: 5000,
      idleTimeoutMs: 30000,
      allowedTools: [],
      requireProgressComment: true
    },
    systemPrompt: 'test',
    userPrompt: 'test'
  }

  describe('agent-runner', () => {
    it('MockAgentRunner 返回统一事件流', async () => {
      const runner = new MockAgentRunner()
      const events: AgentRunEvent[] = []

      for await (const event of runner.run(mockRequest)) {
        events.push(event)
      }

      expect(events).toHaveLength(5)
      expect(events[0].type).toBe('thinking')
      expect(events[1].type).toBe('text')
      expect(events[2].type).toBe('tool_use')
      expect(events[3].type).toBe('tool_result')
      expect(events[4].type).toBe('result')

      const result = events[4] as { type: 'result'; status: string }
      expect(result.status).toBe('success')
    })

    it('MockAgentRunner 支持自定义事件序列', async () => {
      const customSteps: AgentRunEvent[] = [
        { type: 'text', text: 'hello' },
        { type: 'result', status: 'success' }
      ]
      const runner = new MockAgentRunner(customSteps)
      const events: AgentRunEvent[] = []

      for await (const event of runner.run(mockRequest)) {
        events.push(event)
      }

      expect(events).toHaveLength(2)
      expect(events[0].type).toBe('text')
      expect(events[1].type).toBe('result')
    })

    it('FailingAgentRunner 返回失败事件', async () => {
      const runner = new FailingAgentRunner()
      const events: AgentRunEvent[] = []

      for await (const event of runner.run(mockRequest)) {
        events.push(event)
      }

      const result = events.find((e) => e.type === 'result') as {
        type: 'result'
        status: string
        reason?: string
      }
      expect(result.status).toBe('failed')
      expect(result.reason).toBe('工具执行失败')
    })
  })

  // ── withPolicy 策略强制层 ──────────────────────────────────────────────────

  describe('withPolicy', () => {
    it('正常执行不超限', async () => {
      const runner = new MockAgentRunner()
      const request = {
        ...mockRequest,
        policy: {
          maxTurns: 10,
          firstTokenTimeoutMs: 5000,
          idleTimeoutMs: 30000,
          allowedTools: [],
          requireProgressComment: true
        }
      }
      const events: AgentRunEvent[] = []

      for await (const event of withPolicy(runner, request)) {
        events.push(event)
      }

      // Why: MockAgentRunner yields 5 events, all within policy limits.
      const resultEvent = events.find((e) => e.type === 'result') as {
        type: 'result'
        status: string
      }
      expect(resultEvent.status).toBe('success')
    })

    it('超出 maxTurns 时强制终止', async () => {
      // Why: 3 tool_use events but maxTurns = 2.
      const steps: AgentRunEvent[] = [
        { type: 'tool_use', toolName: 'bash', callId: 'c1' },
        { type: 'tool_result', toolName: 'bash', callId: 'c1', content: 'a' },
        { type: 'tool_use', toolName: 'bash', callId: 'c2' },
        { type: 'tool_result', toolName: 'bash', callId: 'c2', content: 'b' },
        { type: 'tool_use', toolName: 'bash', callId: 'c3' },
        { type: 'tool_result', toolName: 'bash', callId: 'c3', content: 'c' },
        { type: 'result', status: 'success' }
      ]
      const runner = new MockAgentRunner(steps)
      const request = {
        ...mockRequest,
        policy: {
          maxTurns: 2,
          firstTokenTimeoutMs: 5000,
          idleTimeoutMs: 30000,
          allowedTools: [],
          requireProgressComment: true
        }
      }
      const events: AgentRunEvent[] = []

      for await (const event of withPolicy(runner, request)) {
        events.push(event)
      }

      // Why: after 2 turns (2 tool_use), it should inject a failed result.
      const resultEvents = events.filter((e) => e.type === 'result') as {
        type: 'result'
        status: string
        reason?: string
      }[]
      const forcedFailure = resultEvents.find((e) => e.reason?.includes('max turns'))
      expect(forcedFailure).toBeDefined()
      expect(forcedFailure?.status).toBe('failed')
    })

    it('idleTimeout 到达时真正中断（不等到 sleep 结束）', async () => {
      const runner = new StuckAgentRunner()
      const request = {
        ...mockRequest,
        // Why: very short idleTimeout so the test finishes quickly.
        policy: {
          maxTurns: 10,
          firstTokenTimeoutMs: 500,
          idleTimeoutMs: 200,
          allowedTools: [],
          requireProgressComment: true
        }
      }

      const startTime = Date.now()
      const events: AgentRunEvent[] = []

      for await (const event of withPolicy(runner, request)) {
        events.push(event)
      }

      const elapsed = Date.now() - startTime
      // Why: StuckAgentRunner sleeps for idleTimeoutMs + 1000ms.
      // With idleTimeout = 200ms, it should interrupt around 200ms, NOT 1200ms.
      expect(elapsed).toBeLessThan(800)
      // Why: the thinking event should be yielded before timeout.
      expect(events[0].type).toBe('thinking')
      // Why: should end with a failed result due to timeout.
      const resultEvent = events.find((e) => e.type === 'result') as {
        type: 'result'
        status: string
        reason?: string
      }
      expect(resultEvent.status).toBe('failed')
      expect(resultEvent.reason).toContain('timeout')
    })

    it('allowedTools 白名单外工具产出 warning', async () => {
      const steps: AgentRunEvent[] = [
        { type: 'tool_use', toolName: 'dangerous-tool', callId: 'c1' },
        { type: 'tool_result', toolName: 'dangerous-tool', callId: 'c1', content: 'ok' },
        { type: 'result', status: 'success' }
      ]
      const runner = new MockAgentRunner(steps)
      const request = {
        ...mockRequest,
        policy: {
          maxTurns: 10,
          firstTokenTimeoutMs: 5000,
          idleTimeoutMs: 30000,
          allowedTools: ['bash', 'read'],
          requireProgressComment: true
        }
      }
      const events: AgentRunEvent[] = []

      for await (const event of withPolicy(runner, request)) {
        events.push(event)
      }

      // Why: dangerous-tool is not in allowedTools, should trigger warning.
      const warning = events.find(
        (e) => e.type === 'text' && 'text' in e && e.text.includes('policy warning')
      )
      expect(warning).toBeDefined()
    })
  })

  // ── stream-event-normalizer ────────────────────────────────────────────────

  describe('stream-event-normalizer', () => {
    it('配对 tool_use / tool_result', async () => {
      const steps: AgentRunEvent[] = [
        { type: 'tool_use', toolName: 'bash', callId: 'c1' },
        { type: 'tool_result', toolName: 'bash', callId: 'c1', content: 'ok' },
        { type: 'result', status: 'success' }
      ]
      const runner = new MockAgentRunner(steps)

      const result = await collectNormalizedEvents(
        runner.run({
          ...mockRequest,
          context: {} as HarnessExecutionContext
        })
      )

      // Why: all events emitted + metrics = 4 total (3 steps + metrics).
      expect(result.metrics.toolUseCount).toBe(1)
      expect(result.metrics.toolResultCount).toBe(1)
      expect(result.orphans).toHaveLength(0)
      expect(result.metrics.warningCount).toBe(0)
    })

    it('存在孤儿工具调用时告警', async () => {
      const steps: AgentRunEvent[] = [
        { type: 'tool_use', toolName: 'bash', callId: 'orphan-1' },
        { type: 'tool_use', toolName: 'bash', callId: 'orphan-2' },
        { type: 'result', status: 'failed', reason: 'timeout' }
      ]
      const runner = new MockAgentRunner(steps)

      const result = await collectNormalizedEvents(
        runner.run({
          ...mockRequest,
          context: {} as HarnessExecutionContext
        })
      )

      // Why: 2 orphans should be detected at stream end.
      expect(result.orphans).toHaveLength(2)
      expect(result.orphans).toContain('orphan-1')
      expect(result.orphans).toContain('orphan-2')
      expect(result.metrics.warningCount).toBe(1)
    })

    it('混合配对和孤儿场景', async () => {
      const steps: AgentRunEvent[] = [
        { type: 'tool_use', toolName: 'bash', callId: 'paired' },
        { type: 'tool_result', toolName: 'bash', callId: 'paired', content: 'done' },
        { type: 'tool_use', toolName: 'bash', callId: 'orphan' },
        { type: 'result', status: 'success' }
      ]
      const runner = new MockAgentRunner(steps)

      const result = await collectNormalizedEvents(
        runner.run({
          ...mockRequest,
          context: {} as HarnessExecutionContext
        })
      )

      expect(result.metrics.toolUseCount).toBe(2)
      expect(result.metrics.toolResultCount).toBe(1)
      expect(result.orphans).toEqual(['orphan'])
    })

    it('失败路径也产出 result 事件', async () => {
      const runner = new FailingAgentRunner()

      const result = await collectNormalizedEvents(
        runner.run({
          ...mockRequest,
          context: {} as HarnessExecutionContext
        })
      )

      const resultEvent = result.events.find((e) => e.type === 'result') as {
        type: 'result'
        status: string
      }
      expect(resultEvent.status).toBe('failed')
      // Why: error tool_result is tracked correctly.
      const toolResults = result.events.filter((e) => e.type === 'tool_result') as {
        isError?: boolean
      }[]
      expect(toolResults[0].isError).toBe(true)
    })

    it('产出 metrics 事件', async () => {
      const runner = new MockAgentRunner()

      const result = await collectNormalizedEvents(
        runner.run({
          ...mockRequest,
          context: {} as HarnessExecutionContext
        })
      )

      // Why: metrics are always the last event.
      const lastEvent = result.events.at(-1) as { type: 'metrics'; totalEvents: number }
      expect(lastEvent.type).toBe('metrics')
      expect(lastEvent.totalEvents).toBe(result.events.length)
    })
  })
})
