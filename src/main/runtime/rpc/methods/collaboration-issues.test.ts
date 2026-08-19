import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') }
}))

const dbMod = await import('../../collaboration/collaboration-database')
const { createTeamStore, __resetTeamStoreForTests } = await import('../../collaboration/team-store')
const { createProjectStore, __resetProjectStoreForTests } =
  await import('../../collaboration/project-store')
const { createIssueStore, __resetIssueStoreForTests } =
  await import('../../collaboration/issue-store')
const { createIssueCommentStore, __resetIssueCommentStoreForTests } =
  await import('../../collaboration/issue-comment-store')
const { __resetCollaborationDbForTests, __setCollaborationDbPathForTests } = dbMod

import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import { COLLABORATION_ISSUES_METHODS } from './collaboration-issues'
import type { OrcaRuntimeService } from '../../orca-runtime'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

describe('collaboration issues RPC methods', () => {
  let teamStore: ReturnType<typeof createTeamStore>
  let projectStore: ReturnType<typeof createProjectStore>
  let issueStore: ReturnType<typeof createIssueStore>
  let commentStore: ReturnType<typeof createIssueCommentStore>
  let tmpRoot: string

  function makeMember(name = 'Alice'): string {
    return teamStore.create({
      name,
      role: 'lead',
      agentType: 'claude',
      agentModel: 'claude-sonnet'
    }).id
  }

  function makeProject(): string {
    return projectStore.register({
      name: 'Test Project',
      hostId: 'local',
      hostType: 'local',
      repoPath: '/tmp/test-repo'
    }).id
  }

  function makeIssue(projectId: string, ownerId: string): string {
    // Why: issueStore.create requires owner to be a member of the project team.
    // Check if already a member to avoid duplicate invite errors.
    const existingMembers = projectStore.listMembers(projectId)
    if (!existingMembers.some((m) => m.memberId === ownerId)) {
      projectStore.inviteMember(projectId, ownerId, 'developer')
    }
    return issueStore.create({
      projectId,
      title: 'Fix bug',
      ownerId
    }).id
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
    tmpRoot = join(tmpdir(), `collab-rpc-test-${Date.now()}`)
    mkdirSync(tmpRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('collaboration.issueComment: creates comment with resolved authorName', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime'
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: COLLABORATION_ISSUES_METHODS })

    const memberId = makeMember('Bob')
    const projectId = makeProject()
    const issueId = makeIssue(projectId, memberId)

    const result = await dispatcher.dispatch(
      makeRequest('collaboration.issueComment', {
        issueId,
        memberId,
        body: 'Implementation is ready for review.'
      })
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.result).toMatchObject({
        issueId,
        authorId: memberId,
        authorType: 'agent',
        authorName: 'Bob',
        body: 'Implementation is ready for review.',
        visibility: 'project_team'
      })
    }

    // Why: verify comment was actually persisted
    const comments = commentStore.listByIssue(issueId)
    expect(comments).toHaveLength(1)
    expect(comments[0]!.authorName).toBe('Bob')
  })

  it('collaboration.issueComment: throws when member not found', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime'
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: COLLABORATION_ISSUES_METHODS })

    const result = await dispatcher.dispatch(
      makeRequest('collaboration.issueComment', {
        issueId: 'iss_nonexistent',
        memberId: 'tm_nonexistent',
        body: 'Test comment'
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('Team member not found')
    }
  })

  it('collaboration.issueUpdate: updates issue status and title', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime'
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: COLLABORATION_ISSUES_METHODS })

    const memberId = makeMember()
    const projectId = makeProject()
    const issueId = makeIssue(projectId, memberId)

    const result = await dispatcher.dispatch(
      makeRequest('collaboration.issueUpdate', {
        issueId,
        memberId,
        status: 'done',
        title: 'Updated title'
      })
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.result).toMatchObject({
        id: issueId,
        status: 'done',
        title: 'Updated title'
      })
    }

    // Why: verify update was actually persisted
    const updated = issueStore.get(issueId)
    expect(updated!.status).toBe('done')
    expect(updated!.title).toBe('Updated title')
  })

  it('collaboration.issueUpdate: throws when member not found', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime'
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: COLLABORATION_ISSUES_METHODS })

    const result = await dispatcher.dispatch(
      makeRequest('collaboration.issueUpdate', {
        issueId: 'iss_nonexistent',
        memberId: 'tm_nonexistent',
        status: 'done'
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('Team member not found')
    }
  })

  it('collaboration.issueUpdate: rejects when caller is not a project member', async () => {
    // Why: construct a scenario where the caller is a valid team member but NOT
    // a member of the project that owns the issue. This cannot be covered by
    // makeIssue (which invites the caller to the project).
    const runtime = {
      getRuntimeId: () => 'test-runtime'
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: COLLABORATION_ISSUES_METHODS })

    // Create two separate members and a project
    const ownerId = makeMember('Owner')
    const outsiderId = makeMember('Outsider')
    const projectA = makeProject()

    // Create issue in projectA with ownerId (ownerId is invited to projectA by makeIssue)
    const issueId = makeIssue(projectA, ownerId)

    // outsiderId is a valid team member but NOT in projectA
    const result = await dispatcher.dispatch(
      makeRequest('collaboration.issueUpdate', {
        issueId,
        memberId: outsiderId,
        status: 'done'
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('is not a member of project')
    }
  })

  it('collaboration.issueGet: returns issue by ID', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime'
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: COLLABORATION_ISSUES_METHODS })

    const memberId = makeMember()
    const projectId = makeProject()
    const issueId = makeIssue(projectId, memberId)

    const result = await dispatcher.dispatch(makeRequest('collaboration.issueGet', { issueId }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.result).toMatchObject({
        id: issueId,
        title: 'Fix bug',
        status: 'open'
      })
    }
  })

  it('collaboration.issueGet: throws when issue not found', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime'
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: COLLABORATION_ISSUES_METHODS })

    const result = await dispatcher.dispatch(
      makeRequest('collaboration.issueGet', { issueId: 'iss_nonexistent' })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('Issue not found')
    }
  })

  it('collaboration.issueList: lists issues by project', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime'
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: COLLABORATION_ISSUES_METHODS })

    const memberId = makeMember()
    const projectId = makeProject()
    const issueId1 = makeIssue(projectId, memberId)
    const issueId2 = makeIssue(projectId, memberId)

    const result = await dispatcher.dispatch(makeRequest('collaboration.issueList', { projectId }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      const issues = result.result as { id: string }[]
      expect(issues).toHaveLength(2)
      const ids = issues.map((i) => i.id)
      expect(ids).toContain(issueId1)
      expect(ids).toContain(issueId2)
    }
  })

  it('collaboration.issueList: lists all issues when no projectId', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime'
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: COLLABORATION_ISSUES_METHODS })

    const memberId = makeMember()
    const projectId = makeProject()
    makeIssue(projectId, memberId)

    const result = await dispatcher.dispatch(makeRequest('collaboration.issueList', {}))

    expect(result.ok).toBe(true)
    if (result.ok) {
      const issues = result.result as { id: string }[]
      expect(issues.length).toBeGreaterThanOrEqual(1)
    }
  })
})
