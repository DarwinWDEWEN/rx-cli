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
const { __resetIssueWorktreeStoreForTests } = await import('./issue-worktree-store')
const { __resetActivityLogStoreForTests } = await import('./activity-log-store')
const { __resetIssueLifecycleForTests } = await import('./issue-lifecycle')
const { createWorktreeAllocator, __resetWorktreeAllocatorForTests } =
  await import('./worktree-allocator')
const { getIssueWorktreeStore } = await import('./issue-worktree-store')
const { getIssueGitRefStore } = await import('./issue-git-ref-store')
const { getActivityLogStore } = await import('./activity-log-store')
type CreateWorktreeHandler = (input: {
  issueId: string
  memberId: string
  worktreeName: string
}) => Promise<{ worktreeId: string; hostId: string }>

const tmpRoot = join(tmpdir(), `collab-wta-test-${Date.now()}`)

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
  __resetIssueWorktreeStoreForTests()
  __resetActivityLogStoreForTests()
  __resetIssueLifecycleForTests()
  __resetWorktreeAllocatorForTests()

  const teamStore = createTeamStore()
  const projectStore = createProjectStore({ teamStore })

  const testDir = join(tmpRoot, `wta-${randomSuffix()}`)
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

  return { issue, owner, project, projectStore, teamStore }
}

function makeFakeCreateWorktree(): CreateWorktreeHandler & { mock: ReturnType<typeof vi.fn> } {
  const mock = vi.fn(async (input: { issueId: string; memberId: string }) => ({
    worktreeId: `wt_${input.memberId}`,
    hostId: 'host-local'
  }))
  return mock as unknown as CreateWorktreeHandler & { mock: ReturnType<typeof vi.fn> }
}

describe('worktree allocator', () => {
  let ctx: Awaited<ReturnType<typeof setupTestIssue>>

  beforeEach(async () => {
    ctx = await setupTestIssue()
  })

  afterEach(() => {
    __resetWorktreeAllocatorForTests()
    __resetIssueLifecycleForTests()
    __resetActivityLogStoreForTests()
    __resetIssueWorktreeStoreForTests()
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

  it('allocateWorktree success — calls fake, registers worktree, creates ref', async () => {
    const { issue, owner } = ctx
    const fake = makeFakeCreateWorktree()
    const allocator = createWorktreeAllocator({ createWorktree: fake })

    const result = await allocator.allocateWorktree(issue.id, owner.id)

    // Fake called with correct input
    expect(fake).toHaveBeenCalledTimes(1)
    expect(fake).toHaveBeenCalledWith({
      issueId: issue.id,
      memberId: owner.id,
      worktreeName: `wt/${owner.id}`
    })

    // Worktree registered with camelCase fields
    expect(result.worktree.issueId).toBe(issue.id)
    expect(result.worktree.memberId).toBe(owner.id)
    expect(result.worktree.worktreeId).toBe(`wt_${owner.id}`)
    expect(result.worktree.hostId).toBe('host-local')
    expect(result.worktree.status).toBe('active')

    // Per-member ref created
    expect(result.ref.refRole).toBe('member')
    expect(result.ref.refName).toBe(`worktree/${owner.id}`)
    expect(result.ref.memberId).toBe(owner.id)

    // Verify DB state
    const worktrees = getIssueWorktreeStore().listByIssue(issue.id)
    expect(worktrees).toHaveLength(1)
    const refs = getIssueGitRefStore().listByIssue(issue.id)
    expect(refs).toHaveLength(1)
  })

  it('allocateWorktree writes activity-log event', async () => {
    const { issue, owner } = ctx
    const fake = makeFakeCreateWorktree()
    const allocator = createWorktreeAllocator({ createWorktree: fake })

    await allocator.allocateWorktree(issue.id, owner.id)

    const logs = getActivityLogStore().listByProject(issue.projectId)
    const allocLog = logs.find((l) => l.action === 'worktree.allocated')
    expect(allocLog).toBeTruthy()
    expect(allocLog?.metadata).toMatchObject({
      memberId: owner.id,
      worktreeId: `wt_${owner.id}`,
      hostId: 'host-local'
    })
  })

  it('allocateWorktree is idempotent — second call returns existing, fake not called again', async () => {
    const { issue, owner } = ctx
    const fake = makeFakeCreateWorktree()
    const allocator = createWorktreeAllocator({ createWorktree: fake })

    const first = await allocator.allocateWorktree(issue.id, owner.id)
    const second = await allocator.allocateWorktree(issue.id, owner.id)

    expect(first.worktree.id).toBe(second.worktree.id)
    expect(first.ref.id).toBe(second.ref.id)
    expect(fake).toHaveBeenCalledTimes(1)

    const worktrees = getIssueWorktreeStore().listByIssue(issue.id)
    expect(worktrees).toHaveLength(1)
  })

  it('throws for non-existent issue', async () => {
    const fake = makeFakeCreateWorktree()
    const allocator = createWorktreeAllocator({ createWorktree: fake })

    await expect(allocator.allocateWorktree('iss_missing', 'tm_any')).rejects.toThrow(
      'Issue not found'
    )
    expect(fake).not.toHaveBeenCalled()
  })

  it('throws when member not in project team', async () => {
    const { issue, teamStore } = ctx
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

    const fake = makeFakeCreateWorktree()
    const allocator = createWorktreeAllocator({ createWorktree: fake })

    await expect(allocator.allocateWorktree(issue.id, outsider.id)).rejects.toThrow(
      'not in project'
    )
    expect(fake).not.toHaveBeenCalled()
  })

  it('multi-member per-member: each gets own worktree and ref', async () => {
    const { issue, owner, projectStore, teamStore } = ctx
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

    const fake = makeFakeCreateWorktree()
    const allocator = createWorktreeAllocator({ createWorktree: fake })

    const result1 = await allocator.allocateWorktree(issue.id, owner.id)
    const result2 = await allocator.allocateWorktree(issue.id, other.id)

    // Different worktrees
    expect(result1.worktree.id).not.toBe(result2.worktree.id)
    expect(result1.worktree.memberId).toBe(owner.id)
    expect(result2.worktree.memberId).toBe(other.id)

    // Different refs
    expect(result1.ref.refName).toBe(`worktree/${owner.id}`)
    expect(result2.ref.refName).toBe(`worktree/${other.id}`)
    expect(result1.ref.id).not.toBe(result2.ref.id)

    // Fake called twice (once per member)
    expect(fake).toHaveBeenCalledTimes(2)

    // DB state
    const worktrees = getIssueWorktreeStore().listByIssue(issue.id)
    expect(worktrees).toHaveLength(2)
    const refs = getIssueGitRefStore().listByIssue(issue.id)
    expect(refs).toHaveLength(2)
  })

  it('listForIssue returns all worktrees for issue', async () => {
    const { issue, owner, projectStore, teamStore } = ctx
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

    const fake = makeFakeCreateWorktree()
    const allocator = createWorktreeAllocator({ createWorktree: fake })

    await allocator.allocateWorktree(issue.id, owner.id)
    await allocator.allocateWorktree(issue.id, other.id)

    const list = allocator.listForIssue(issue.id)
    expect(list).toHaveLength(2)
  })

  it('listForMember returns all worktrees for member', async () => {
    const { issue, owner } = ctx
    const fake = makeFakeCreateWorktree()
    const allocator = createWorktreeAllocator({ createWorktree: fake })

    await allocator.allocateWorktree(issue.id, owner.id)

    const list = allocator.listForMember(owner.id)
    expect(list).toHaveLength(1)
    expect(list[0].issueId).toBe(issue.id)
  })

  it('returns empty array for issue with no worktrees', () => {
    const { issue } = ctx
    const allocator = createWorktreeAllocator()
    expect(allocator.listForIssue(issue.id)).toEqual([])
  })

  it('default seam throws "not wired (D4)" when no fake injected', async () => {
    const { issue, owner } = ctx
    const allocator = createWorktreeAllocator()

    await expect(allocator.allocateWorktree(issue.id, owner.id)).rejects.toThrow(
      'worktree runtime not wired (D4)'
    )
  })

  it('worktree returned has camelCase fields — snake_case absent', async () => {
    const { issue, owner } = ctx
    const fake = makeFakeCreateWorktree()
    const allocator = createWorktreeAllocator({ createWorktree: fake })

    const { worktree } = await allocator.allocateWorktree(issue.id, owner.id)

    // camelCase present
    expect(worktree.issueId).toBeTruthy()
    expect(worktree.memberId).toBeTruthy()
    expect(worktree.worktreeId).toBeTruthy()
    expect(worktree.hostId).toBeTruthy()

    // snake_case absent
    expect((worktree as Record<string, unknown>).issue_id).toBeUndefined()
    expect((worktree as Record<string, unknown>).member_id).toBeUndefined()
    expect((worktree as Record<string, unknown>).worktree_id).toBeUndefined()
    expect((worktree as Record<string, unknown>).host_id).toBeUndefined()
  })
})
