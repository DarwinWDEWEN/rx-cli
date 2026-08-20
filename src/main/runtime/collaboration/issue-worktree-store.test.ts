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
const { __resetIssueWorktreeStoreForTests } = await import('./issue-worktree-store')

const tmpRoot = join(tmpdir(), `collab-iw-test-${Date.now()}`)

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

async function setupTestIssue() {
  __resetCollaborationDbForTests()
  __setCollaborationDbPathForTests(':memory:')
  __resetTeamStoreForTests()
  __resetProjectStoreForTests()
  __resetIssueStoreForTests()
  __resetIssueWorktreeStoreForTests()

  const teamStore = createTeamStore()
  const projectStore = createProjectStore({ teamStore })

  const testDir = join(tmpRoot, `iw-${randomSuffix()}`)
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

  const { getIssueWorktreeStore: freshGet } = await import('./issue-worktree-store')
  return { store: freshGet(), issue, owner, project, teamStore, projectStore }
}

describe('issue worktree store', () => {
  let ctx: Awaited<ReturnType<typeof setupTestIssue>>

  beforeEach(async () => {
    ctx = await setupTestIssue()
  })

  afterEach(() => {
    __resetIssueWorktreeStoreForTests()
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

  it('registers a worktree with all fields', () => {
    const { store, issue, owner } = ctx
    const wt = store.register({
      issueId: issue.id,
      memberId: owner.id,
      worktreeId: 'wt-123',
      hostId: 'local',
      terminalId: 'term-456',
      activeRefName: 'feature/test'
    })

    expect(wt.id).toMatch(/^iw_/)
    expect(wt.issueId).toBe(issue.id)
    expect(wt.memberId).toBe(owner.id)
    expect(wt.worktreeId).toBe('wt-123')
    expect(wt.hostId).toBe('local')
    expect(wt.terminalId).toBe('term-456')
    expect(wt.activeRefName).toBe('feature/test')
    expect(wt.status).toBe('active')
    expect(wt.createdAt).toBeTruthy()
    expect(wt.updatedAt).toBeTruthy()
  })

  it('defaults status to active when not provided', () => {
    const { store, issue, owner } = ctx
    const wt = store.register({
      issueId: issue.id,
      memberId: owner.id,
      worktreeId: 'wt-123',
      hostId: 'local'
    })
    expect(wt.status).toBe('active')
  })

  it('throws when issue not found', () => {
    const { store, owner } = ctx
    expect(() =>
      store.register({
        issueId: 'iss_missing',
        memberId: owner.id,
        worktreeId: 'wt-123',
        hostId: 'local'
      })
    ).toThrow('Issue not found')
  })

  it('throws when member not found', () => {
    const { store, issue } = ctx
    expect(() =>
      store.register({
        issueId: issue.id,
        memberId: 'tm_missing',
        worktreeId: 'wt-123',
        hostId: 'local'
      })
    ).toThrow('Team member not found')
  })

  it('throws when worktree already exists for same issue+member', () => {
    const { store, issue, owner } = ctx
    store.register({
      issueId: issue.id,
      memberId: owner.id,
      worktreeId: 'wt-123',
      hostId: 'local'
    })

    expect(() =>
      store.register({
        issueId: issue.id,
        memberId: owner.id,
        worktreeId: 'wt-456',
        hostId: 'local'
      })
    ).toThrow('Worktree already exists')
  })

  it('listByIssue returns all worktrees for an issue', () => {
    const { store, issue, owner, projectStore, teamStore } = ctx
    const other = teamStore.create({
      name: 'Bob',
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
    projectStore.inviteMember(issue.projectId, other.id, 'member')

    store.register({ issueId: issue.id, memberId: owner.id, worktreeId: 'wt-1', hostId: 'local' })
    store.register({ issueId: issue.id, memberId: other.id, worktreeId: 'wt-2', hostId: 'local' })

    const wts = store.listByIssue(issue.id)
    expect(wts).toHaveLength(2)
    expect(wts.map((w) => w.memberId).sort()).toEqual([owner.id, other.id].sort())
  })

  it('listByMember returns all worktrees for a member', () => {
    const { store, issue, owner, projectStore, teamStore } = ctx
    const issueStore = createIssueStore({ projectStore, teamStore })
    const issue2 = issueStore.create({
      projectId: issue.projectId,
      title: 'Second Issue',
      ownerId: owner.id
    })

    store.register({ issueId: issue.id, memberId: owner.id, worktreeId: 'wt-1', hostId: 'local' })
    store.register({ issueId: issue2.id, memberId: owner.id, worktreeId: 'wt-2', hostId: 'local' })

    const wts = store.listByMember(owner.id)
    expect(wts).toHaveLength(2)
  })

  it('getByIssueAndMember returns the worktree or null', () => {
    const { store, issue, owner } = ctx
    const registered = store.register({
      issueId: issue.id,
      memberId: owner.id,
      worktreeId: 'wt-123',
      hostId: 'local'
    })

    const found = store.getByIssueAndMember(issue.id, owner.id)
    expect(found?.id).toBe(registered.id)

    const notFound = store.getByIssueAndMember(issue.id, 'tm_missing')
    expect(notFound).toBeNull()
  })

  it('get returns worktree by id or null', () => {
    const { store, issue, owner } = ctx
    const registered = store.register({
      issueId: issue.id,
      memberId: owner.id,
      worktreeId: 'wt-123',
      hostId: 'local'
    })

    expect(store.get(registered.id)?.worktreeId).toBe('wt-123')
    expect(store.get('iw_missing')).toBeNull()
  })

  it('update modifies status/terminalId/activeRefName', () => {
    const { store, issue, owner } = ctx
    const registered = store.register({
      issueId: issue.id,
      memberId: owner.id,
      worktreeId: 'wt-123',
      hostId: 'local'
    })

    const updated = store.update({
      id: registered.id,
      status: 'closed',
      terminalId: 'term-new',
      activeRefName: 'feature/updated'
    })

    expect(updated.status).toBe('closed')
    expect(updated.terminalId).toBe('term-new')
    expect(updated.activeRefName).toBe('feature/updated')
  })

  it('update throws for non-existent worktree', () => {
    const { store } = ctx
    expect(() => store.update({ id: 'iw_missing', status: 'closed' })).toThrow('Worktree not found')
  })

  it('returns empty array for issue with no worktrees', () => {
    const { store, issue } = ctx
    expect(store.listByIssue(issue.id)).toEqual([])
  })

  it('snake→camel field mapping is correct', () => {
    const { store, issue, owner } = ctx
    const wt = store.register({
      issueId: issue.id,
      memberId: owner.id,
      worktreeId: 'wt-123',
      hostId: 'local'
    })

    // camelCase fields present
    expect(wt.issueId).toBeTruthy()
    expect(wt.memberId).toBeTruthy()
    expect(wt.worktreeId).toBeTruthy()
    expect(wt.hostId).toBeTruthy()
    expect(wt.createdAt).toBeTruthy()
    expect(wt.updatedAt).toBeTruthy()

    // snake_case fields absent
    expect((wt as Record<string, unknown>).issue_id).toBeUndefined()
    expect((wt as Record<string, unknown>).member_id).toBeUndefined()
    expect((wt as Record<string, unknown>).worktree_id).toBeUndefined()
    expect((wt as Record<string, unknown>).host_id).toBeUndefined()
    expect((wt as Record<string, unknown>).terminal_id).toBeUndefined()
    expect((wt as Record<string, unknown>).active_ref_name).toBeUndefined()
    expect((wt as Record<string, unknown>).created_at).toBeUndefined()
    expect((wt as Record<string, unknown>).updated_at).toBeUndefined()
  })
})
