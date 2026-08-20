import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') }
}))

const dbMod = await import('../collaboration/collaboration-database')
const { createTeamStore, __resetTeamStoreForTests } = await import('../collaboration/team-store')
const { createProjectStore, __resetProjectStoreForTests } =
  await import('../collaboration/project-store')
const { createIssueStore, __resetIssueStoreForTests } = await import('../collaboration/issue-store')
const { createIssueCommentStore, __resetIssueCommentStoreForTests } =
  await import('../collaboration/issue-comment-store')
const { __resetCollaborationDbForTests, __setCollaborationDbPathForTests } = dbMod

import type {
  AgentRunEvent,
  HarnessExecutionContext,
  Issue,
  IssueWorktree,
  Project,
  TeamMemberRecord
} from '../../../shared/team-types'
import type { NormalizerResult } from './stream-event-normalizer'

const { summarizeRun, postRunComment } = await import('./owner-collaboration')
const { MockAgentRunner } = await import('./agent-runner')
const { collectNormalizedEvents } = await import('./stream-event-normalizer')

describe('owner-collaboration', () => {
  let teamStore: ReturnType<typeof createTeamStore>
  let projectStore: ReturnType<typeof createProjectStore>
  let issueStore: ReturnType<typeof createIssueStore>
  let commentStore: ReturnType<typeof createIssueCommentStore>

  function makeMember(over: Partial<TeamMemberRecord> = {}): TeamMemberRecord {
    return teamStore.create({
      name: 'Alice',
      role: 'lead',
      agentType: 'claude',
      agentModel: 'claude-sonnet',
      ...over
    })
  }

  function makeProject(): Project {
    return projectStore.register({
      name: 'Test Project',
      hostId: 'local',
      hostType: 'local',
      repoPath: '/tmp/test-repo'
    })
  }

  function makeIssue(projectId: string, ownerId: string): Issue {
    return issueStore.create({
      projectId,
      title: 'Fix bug',
      ownerId
    })
  }

  function makeWorktree(issueId: string, memberId: string): IssueWorktree {
    return {
      id: `wt_${memberId}`,
      issueId,
      memberId,
      worktreeId: `wt-${memberId}-xyz`,
      hostId: 'local',
      status: 'active',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01'
    }
  }

  function makeContext(over: Partial<HarnessExecutionContext> = {}): HarnessExecutionContext {
    return {
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
      isOwner: true,
      ...over
    }
  }

  function makeNormalizerResult(over: Partial<NormalizerResult> = {}): NormalizerResult {
    return {
      events: [],
      orphans: [],
      metrics: {
        totalEvents: 0,
        toolUseCount: 0,
        toolResultCount: 0,
        thinkingCount: 0,
        textCount: 0,
        warningCount: 0
      },
      ...over
    }
  }

  beforeEach(() => {
    __resetCollaborationDbForTests()
    __setCollaborationDbPathForTests(':memory:')
    __resetTeamStoreForTests()
    __resetProjectStoreForTests()
    __resetIssueStoreForTests()
    __resetIssueCommentStoreForTests()
    teamStore = createTeamStore()
    projectStore = createProjectStore({ teamStore })
    issueStore = createIssueStore({ projectStore, teamStore })
    commentStore = createIssueCommentStore({ issueStore, teamStore })
  })

  afterEach(() => {
    __resetIssueCommentStoreForTests()
    __resetTeamStoreForTests()
    __resetProjectStoreForTests()
    __resetIssueStoreForTests()
    __resetCollaborationDbForTests()
  })

  // ── summarizeRun ───────────────────────────────────────────────────────────

  describe('summarizeRun', () => {
    it('成功路径提炼总结', () => {
      const events: AgentRunEvent[] = [
        { type: 'thinking', text: '分析中...' },
        { type: 'text', text: '开始执行' },
        { type: 'tool_use', toolName: 'bash', callId: 'c1', input: 'echo ok' },
        { type: 'tool_result', toolName: 'bash', callId: 'c1', content: 'ok' },
        { type: 'result', status: 'success', summary: '任务完成' }
      ]

      const result = summarizeRun(events, makeNormalizerResult())

      expect(result.status).toBe('success')
      expect(result.summary).toBe('任务完成')
      expect(result.toolUseCount).toBe(1)
      expect(result.toolSuccessCount).toBe(1)
      expect(result.toolFailureCount).toBe(0)
      expect(result.orphanCount).toBe(0)
    })

    it('失败路径保留 reason', () => {
      const events: AgentRunEvent[] = [
        { type: 'tool_use', toolName: 'bash', callId: 'c1' },
        { type: 'tool_result', toolName: 'bash', callId: 'c1', content: 'error', isError: true },
        { type: 'result', status: 'failed', reason: '工具执行失败' }
      ]

      const result = summarizeRun(events, makeNormalizerResult())

      expect(result.status).toBe('failed')
      expect(result.summary).toBe('工具执行失败')
      expect(result.toolUseCount).toBe(1)
      expect(result.toolSuccessCount).toBe(0)
      expect(result.toolFailureCount).toBe(1)
    })

    it('空事件流处理', () => {
      const result = summarizeRun([], makeNormalizerResult())

      expect(result.status).toBe('failed')
      expect(result.summary).toBe('执行失败')
      expect(result.toolUseCount).toBe(0)
    })

    it('无 result 事件时回退到最后一段文本', () => {
      const events: AgentRunEvent[] = [{ type: 'text', text: '部分完成' }]

      const result = summarizeRun(events, makeNormalizerResult())

      expect(result.summary).toBe('部分完成')
    })

    it('统计孤儿工具调用', () => {
      const events: AgentRunEvent[] = [
        { type: 'tool_use', toolName: 'bash', callId: 'orphan-1' },
        { type: 'result', status: 'failed', reason: 'timeout' }
      ]

      const normalizerResult = makeNormalizerResult({
        orphans: ['orphan-1']
      })

      const result = summarizeRun(events, normalizerResult)

      expect(result.orphanCount).toBe(1)
    })
  })

  // ── 评论回写闭环 ───────────────────────────────────────────────────────────

  describe('postRunComment', () => {
    // Why: 创建真实 DB 实体供 postRunComment 使用（需要真实的 issueId）。
    function setupIssueWithMember() {
      const member = makeMember()
      const project = makeProject()
      projectStore.inviteMember(project.id, member.id, 'owner')
      const issue = makeIssue(project.id, member.id)
      const worktree = makeWorktree(issue.id, member.id)
      return { member, project, issue, worktree }
    }

    it('执行后回写评论，正文包含执行者与结果', async () => {
      const { member, project, issue } = setupIssueWithMember()

      // Why: worktreePath 使用真实路径（makeContext 默认值），不是 worktree 实体 ID。
      const ctx = makeContext({
        projectId: project.id,
        issueId: issue.id,
        memberId: member.id,
        memberName: member.name,
        role: member.role,
        isOwner: true
      })

      const runner = new MockAgentRunner()
      const normalizerResult = await collectNormalizedEvents(
        runner.run({
          agentType: 'claude',
          command: 'echo test',
          env: {},
          context: ctx,
          policy: {
            maxTurns: 10,
            firstTokenTimeoutMs: 5000,
            idleTimeoutMs: 30000,
            allowedTools: [],
            requireProgressComment: true
          },
          systemPrompt: 'test',
          userPrompt: 'test'
        })
      )

      const result = postRunComment(
        ctx,
        normalizerResult.events.filter(
          (e): e is AgentRunEvent => e.type !== 'metrics' && e.type !== 'warning'
        ),
        normalizerResult,
        { commentStore }
      )

      expect(result.commentId).toMatch(/^ic_/)
      expect(result.body).toContain('Alice')
      expect(result.body).toContain('lead')
      expect(result.body).toContain('成功')
      expect(result.body).toContain('[负责人]')
    })

    it('负责人 vs 成员标注正确', () => {
      const { member, project, issue } = setupIssueWithMember()
      // Why: 创建第二个成员作为非负责人。
      const dev = makeMember({ name: 'Dev', role: 'dev' })
      projectStore.inviteMember(project.id, dev.id, 'member')
      const devIssue = makeIssue(project.id, dev.id)

      const ownerCtx = makeContext({
        projectId: project.id,
        issueId: issue.id,
        memberId: member.id,
        memberName: member.name,
        role: member.role,
        isOwner: true
      })
      const memberCtx = makeContext({
        projectId: project.id,
        issueId: devIssue.id,
        memberId: dev.id,
        memberName: dev.name,
        role: dev.role,
        isOwner: false
      })

      const events: AgentRunEvent[] = [{ type: 'result', status: 'success', summary: 'done' }]
      const normalizerResult = makeNormalizerResult()

      const ownerResult = postRunComment(ownerCtx, events, normalizerResult, { commentStore })
      expect(ownerResult.body).toContain('[负责人]')

      const memberResult = postRunComment(memberCtx, events, normalizerResult, { commentStore })
      expect(memberResult.body).toContain('[成员]')
    })

    it('评论回写失败路径：Issue 已被删除', () => {
      const ctx = makeContext({ issueId: 'deleted-issue' })
      const events: AgentRunEvent[] = [{ type: 'result', status: 'success', summary: 'done' }]
      const normalizerResult = makeNormalizerResult()

      // Why: commentStore.create will throw because the issue doesn't exist.
      expect(() => postRunComment(ctx, events, normalizerResult, { commentStore })).toThrow(
        /Issue not found/
      )
    })

    it('失败执行产出失败标注', () => {
      const { member, project, issue } = setupIssueWithMember()

      const ctx = makeContext({
        projectId: project.id,
        issueId: issue.id,
        memberId: member.id,
        memberName: member.name,
        role: member.role,
        isOwner: true
      })

      const events: AgentRunEvent[] = [
        { type: 'tool_use', toolName: 'bash', callId: 'c1' },
        { type: 'tool_result', toolName: 'bash', callId: 'c1', content: 'err', isError: true },
        { type: 'result', status: 'failed', reason: '工具执行失败' }
      ]
      const normalizerResult = makeNormalizerResult({ orphans: ['c1'] })

      const result = postRunComment(ctx, events, normalizerResult, { commentStore })

      expect(result.body).toContain('失败')
      expect(result.body).toContain('工具执行失败')
      // Why: orphan warning should appear in comment body.
      expect(result.body).toContain('警告')
    })
  })
})
