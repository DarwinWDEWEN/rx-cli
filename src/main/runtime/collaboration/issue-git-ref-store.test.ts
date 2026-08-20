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

const tmpRoot = join(tmpdir(), `collab-iref-test-${Date.now()}`)

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

  const teamStore = createTeamStore()
  const projectStore = createProjectStore({ teamStore })

  const testDir = join(tmpRoot, `iref-${randomSuffix()}`)
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

  const { getIssueGitRefStore: freshGetStore } = await import('./issue-git-ref-store')
  return { store: freshGetStore(), issue, owner }
}

describe('issue git ref store', () => {
  let context: Awaited<ReturnType<typeof setupTestIssue>>

  beforeEach(async () => {
    context = await setupTestIssue()
  })

  afterEach(() => {
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

  it('creates a git ref with all fields', () => {
    const { store, issue, owner } = context
    const ref = store.create({
      issueId: issue.id,
      refName: 'feature/test',
      refRole: 'owner',
      memberId: owner.id,
      purpose: 'test-purpose'
    })

    expect(ref.id).toMatch(/^iref_/)
    expect(ref.issueId).toBe(issue.id)
    expect(ref.refName).toBe('feature/test')
    expect(ref.refRole).toBe('owner')
    expect(ref.memberId).toBe(owner.id)
    expect(ref.purpose).toBe('test-purpose')
    expect(ref.status).toBe('active')
    expect(ref.createdAt).toBeTruthy()
    expect(ref.updatedAt).toBeTruthy()
  })

  it('throws when issue not found', () => {
    const { store } = context
    expect(() =>
      store.create({
        issueId: 'iss_missing',
        refName: 'feature/test',
        refRole: 'owner'
      })
    ).toThrow('Issue not found')
  })

  it('throws when refName already exists for same issue', () => {
    const { store, issue } = context
    store.create({
      issueId: issue.id,
      refName: 'feature/test',
      refRole: 'owner'
    })

    expect(() =>
      store.create({
        issueId: issue.id,
        refName: 'feature/test',
        refRole: 'member'
      })
    ).toThrow('already exists')
  })

  it('listByIssue returns all refs for an issue', () => {
    const { store, issue, owner } = context
    store.create({ issueId: issue.id, refName: 'feature/a', refRole: 'owner', memberId: owner.id })
    store.create({ issueId: issue.id, refName: 'feature/b', refRole: 'member', memberId: owner.id })
    store.create({ issueId: issue.id, refName: 'feature/c', refRole: 'experiment' })

    const refs = store.listByIssue(issue.id)
    expect(refs).toHaveLength(3)
    expect(refs.map((r) => r.refName)).toContain('feature/a')
    expect(refs.map((r) => r.refName)).toContain('feature/b')
    expect(refs.map((r) => r.refName)).toContain('feature/c')
  })

  it('ensureOwnerRef is idempotent', () => {
    const { store, issue, owner } = context
    const ref1 = store.ensureOwnerRef(issue.id, owner.id)
    const ref2 = store.ensureOwnerRef(issue.id, owner.id)

    expect(ref1.id).toBe(ref2.id)
    expect(ref1.refRole).toBe('owner')
    expect(store.listByIssue(issue.id)).toHaveLength(1)
  })

  it('ensureWorktreeRef is idempotent', () => {
    const { store, issue, owner } = context
    const ref1 = store.ensureWorktreeRef(issue.id, owner.id)
    const ref2 = store.ensureWorktreeRef(issue.id, owner.id)

    expect(ref1.id).toBe(ref2.id)
    expect(ref1.refRole).toBe('member')
    expect(store.listByIssue(issue.id)).toHaveLength(1)
  })

  it('getPreferred returns most recent ref for role', () => {
    const { store, issue } = context
    store.create({ issueId: issue.id, refName: 'feature/old', refRole: 'owner' })
    const newer = store.create({ issueId: issue.id, refName: 'feature/new', refRole: 'owner' })

    const preferred = store.getPreferred(issue.id, 'owner')
    expect(preferred?.refName).toBe('feature/new')
    expect(preferred?.id).toBe(newer.id)
  })

  it('getPreferredPrSourceRef prefers owner ref', () => {
    const { store, issue, owner } = context
    store.create({
      issueId: issue.id,
      refName: 'worktree/member',
      refRole: 'member',
      memberId: owner.id
    })
    const ownerRef = store.create({
      issueId: issue.id,
      refName: 'owner/main',
      refRole: 'owner',
      memberId: owner.id
    })

    const prRef = store.getPreferredPrSourceRef(issue.id)
    expect(prRef?.id).toBe(ownerRef.id)
    expect(prRef?.refRole).toBe('owner')
  })

  it('returns null for non-existent ref', () => {
    const { store } = context
    expect(store.get('iref_missing')).toBeNull()
    expect(store.getPreferred('iss_missing')).toBeNull()
    expect(store.getPreferredPrSourceRef('iss_missing')).toBeNull()
  })

  it('returns empty array for issue with no refs', () => {
    const { store, issue } = context
    expect(store.listByIssue(issue.id)).toEqual([])
  })

  it('snake→camel field mapping is correct', () => {
    const { store, issue, owner } = context
    const ref = store.create({
      issueId: issue.id,
      refName: 'feature/test',
      refRole: 'owner',
      memberId: owner.id
    })

    // Verify camelCase fields
    expect(ref.issueId).toBeTruthy()
    expect(ref.refName).toBeTruthy()
    expect(ref.refRole).toBeTruthy()
    expect(ref.memberId).toBeTruthy()
    expect(ref.createdAt).toBeTruthy()
    expect(ref.updatedAt).toBeTruthy()

    // Verify snake_case fields are NOT present
    expect((ref as Record<string, unknown>).issue_id).toBeUndefined()
    expect((ref as Record<string, unknown>).ref_name).toBeUndefined()
    expect((ref as Record<string, unknown>).ref_role).toBeUndefined()
    expect((ref as Record<string, unknown>).member_id).toBeUndefined()
    expect((ref as Record<string, unknown>).created_at).toBeUndefined()
    expect((ref as Record<string, unknown>).updated_at).toBeUndefined()
  })
})
