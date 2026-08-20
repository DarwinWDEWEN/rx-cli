import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') }
}))

const { __resetCollaborationDbForTests, __setCollaborationDbPathForTests } =
  await import('./collaboration-database')
const { createTeamStore, __resetTeamStoreForTests } = await import('./team-store')
const { createProjectStore, __resetProjectStoreForTests } = await import('./project-store')
const { createIssueStore, __resetIssueStoreForTests } = await import('./issue-store')
const { __resetIssueGitRefStoreForTests } = await import('./issue-git-ref-store')
const { __resetActivityLogStoreForTests } = await import('./activity-log-store')
const { __resetIssueLifecycleForTests } = await import('./issue-lifecycle')
const { getActivityLogStore } = await import('./activity-log-store')

const tmpRoot = join(tmpdir(), `collab-lc-test-${Date.now()}`)

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

async function setupTestIssue() {
  __resetCollaborationDbForTests()
  __setCollaborationDbPathForTests(':memory:')
  __resetTeamStoreForTests()
  __resetProjectStoreForTests()
  __resetIssueStoreForTests()
  __resetIssueGitRefStoreForTests()
  __resetActivityLogStoreForTests()
  __resetIssueLifecycleForTests()

  const teamStore = createTeamStore()
  const projectStore = createProjectStore({ teamStore })

  const testDir = join(tmpRoot, `lc-${randomSuffix()}`)
  mkdirSync(testDir, { recursive: true })

  const owner = teamStore.create({
    name: 'Alice',
    role: 'lead',
    personality: '',
    responsibilities: [],
    capabilities: [],
    agentType: 'claude',
    agentModel: 'claude-sonnet',
    agentConfig: {},
    skills: [],
    defaultPrompt: '',
    isActive: true,
    hostType: 'local',
    workspaceAccess: []
  })

  const project = projectStore.register({
    name: 'Test Project',
    hostId: 'local',
    hostType: 'local',
    repoPath: testDir
  })
  projectStore.inviteMember(project.id, owner.id, 'owner')

  const issueStore = createIssueStore({ projectStore, teamStore })
  const issue = issueStore.create({
    projectId: project.id,
    title: 'Test Issue',
    ownerId: owner.id
  })

  const { getIssueLifecycle: freshGet } = await import('./issue-lifecycle')
  return { lifecycle: freshGet(), issue, owner, project, projectStore, teamStore }
}

describe('issue lifecycle', () => {
  let ctx: Awaited<ReturnType<typeof setupTestIssue>>

  beforeEach(async () => {
    ctx = await setupTestIssue()
  })

  afterEach(() => {
    __resetIssueLifecycleForTests()
    __resetActivityLogStoreForTests()
    __resetIssueGitRefStoreForTests()
    __resetIssueStoreForTests()
    __resetProjectStoreForTests()
    __resetTeamStoreForTests()
    __resetCollaborationDbForTests()
    try {
      rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  })

  it('initIssueLine sets workline_state to planning', () => {
    const { lifecycle, issue } = ctx
    const result = lifecycle.initIssueLine(issue.id)
    expect(result.issue.worklineState).toBe('planning')
  })

  it('initIssueLine registers owner ref', () => {
    const { lifecycle, issue } = ctx
    const result = lifecycle.initIssueLine(issue.id)
    expect(result.ownerRef.issueId).toBe(issue.id)
    expect(result.ownerRef.refRole).toBe('owner')
    expect(result.ownerRef.memberId).toBe(issue.ownerId)
  })

  it('initIssueLine writes activity-log event', () => {
    const { lifecycle, issue } = ctx
    lifecycle.initIssueLine(issue.id)

    const logs = getActivityLogStore().listByProject(issue.projectId)
    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('issue.line.initialized')
    expect(logs[0].targetId).toBe(issue.id)
    expect(logs[0].metadata).toMatchObject({
      worklineKey: issue.worklineKey,
      worklineState: 'planning'
    })
  })

  it('initIssueLine is idempotent — second call does not change state', () => {
    const { lifecycle, issue } = ctx
    const first = lifecycle.initIssueLine(issue.id)
    const second = lifecycle.initIssueLine(issue.id)

    expect(first.issue.worklineState).toBe('planning')
    expect(second.issue.worklineState).toBe('planning')
    expect(first.ownerRef.id).toBe(second.ownerRef.id)
  })

  it('initIssueLine is idempotent — owner ref not duplicated', async () => {
    const { lifecycle, issue } = ctx
    lifecycle.initIssueLine(issue.id)
    lifecycle.initIssueLine(issue.id)

    // Only one owner ref should exist
    const { getIssueGitRefStore } = await import('./issue-git-ref-store')
    const refs = getIssueGitRefStore().listByIssue(issue.id)
    expect(refs).toHaveLength(1)
  })

  it('initIssueLine throws for non-existent issue', () => {
    const { lifecycle } = ctx
    expect(() => lifecycle.initIssueLine('iss_missing')).toThrow('Issue not found')
  })

  it('assertMemberInProject passes for project member', () => {
    const { lifecycle, issue, owner } = ctx
    expect(() => lifecycle.assertMemberInProject(issue.id, owner.id)).not.toThrow()
  })

  it('assertMemberInProject throws for non-project member', () => {
    const { lifecycle, issue, teamStore } = ctx
    const outsider = teamStore.create({
      name: 'Outsider',
      role: 'dev',
      personality: '',
      responsibilities: [],
      capabilities: [],
      agentType: 'claude',
      agentModel: 'claude-sonnet',
      agentConfig: {},
      skills: [],
      defaultPrompt: '',
      isActive: true,
      hostType: 'local',
      workspaceAccess: []
    })

    expect(() => lifecycle.assertMemberInProject(issue.id, outsider.id)).toThrow('not in project')
  })

  it('assertMemberInProject throws for non-existent issue', () => {
    const { lifecycle, owner } = ctx
    expect(() => lifecycle.assertMemberInProject('iss_missing', owner.id)).toThrow(
      'Issue not found'
    )
  })

  it('recordLifecycleEvent writes to activity log', () => {
    const { lifecycle, issue } = ctx
    lifecycle.recordLifecycleEvent(issue, 'issue.status.changed', {
      actor: { id: 'user-1', name: 'Alice', type: 'user' },
      metadata: { from: 'open', to: 'done' }
    })

    const logs = getActivityLogStore().listByProject(issue.projectId)
    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('issue.status.changed')
    expect(logs[0].actorId).toBe('user-1')
    expect(logs[0].metadata).toEqual({ from: 'open', to: 'done' })
  })

  it('initIssueLine with custom actor uses actor info in log', () => {
    const { lifecycle, issue } = ctx
    lifecycle.initIssueLine(issue.id, {
      actor: { id: 'agent-1', name: 'Claude', type: 'agent' }
    })

    const logs = getActivityLogStore().listByProject(issue.projectId)
    expect(logs[0].actorType).toBe('agent')
    expect(logs[0].actorId).toBe('agent-1')
    expect(logs[0].actorName).toBe('Claude')
  })
})
