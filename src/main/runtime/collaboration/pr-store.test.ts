import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') }
}))

const { createProjectStore, __resetProjectStoreForTests } = await import('./project-store')
const { createTeamStore, __resetTeamStoreForTests } = await import('./team-store')
const { __resetPrStoreForTests } = await import('./pr-store')
const { __resetCollaborationDbForTests, __setCollaborationDbPathForTests } =
  await import('./collaboration-database')

const tmpRoot = join(tmpdir(), `collab-pr-test-${Date.now()}`)

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

async function setupTestProject() {
  __resetCollaborationDbForTests()
  __setCollaborationDbPathForTests(':memory:')
  __resetProjectStoreForTests()
  __resetTeamStoreForTests()
  __resetPrStoreForTests()

  const teamStore = createTeamStore()
  const projectStore = createProjectStore({ teamStore })

  const testDir = join(tmpRoot, `pr-${randomSuffix()}`)
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

  // Why: re-import pr-store after reset to bind to fresh in-memory db
  const { getPrStore: freshGetPrStore } = await import('./pr-store')
  return { prStore: freshGetPrStore(), projectId: project.id, ownerId: owner.id }
}

describe('pr store', () => {
  let context: Awaited<ReturnType<typeof setupTestProject>>

  beforeEach(async () => {
    context = await setupTestProject()
  })

  afterEach(() => {
    __resetPrStoreForTests()
    __resetProjectStoreForTests()
    __resetTeamStoreForTests()
    __resetCollaborationDbForTests()
    try {
      rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  })

  it('lists PRs ordered by created_at and number', () => {
    const { prStore, projectId, ownerId } = context
    prStore.create({
      projectId,
      title: 'First PR',
      sourceBranch: 'feature/1',
      targetBranch: 'main',
      authorId: ownerId
    })
    prStore.create({
      projectId,
      title: 'Second PR',
      sourceBranch: 'feature/2',
      targetBranch: 'main',
      authorId: ownerId
    })

    const list = prStore.listByProject(projectId)
    expect(list).toHaveLength(2)
    expect(list[0]!.title).toBe('First PR')
    expect(list[1]!.title).toBe('Second PR')
    expect(list[0]!.number).toBe(1)
    expect(list[1]!.number).toBe(2)
  })

  it('returns empty list for project with no PRs', () => {
    const { prStore, projectId } = context
    expect(prStore.listByProject(projectId)).toEqual([])
  })

  it('returns null for unknown PR', () => {
    const { prStore } = context
    expect(prStore.get('pr_missing')).toBeNull()
  })

  it('creates PR with auto-incrementing number and open status', () => {
    const { prStore, projectId, ownerId } = context
    const pr1 = prStore.create({
      projectId,
      title: 'PR One',
      sourceBranch: 'feat/a',
      targetBranch: 'main',
      authorId: ownerId
    })
    const pr2 = prStore.create({
      projectId,
      title: 'PR Two',
      sourceBranch: 'feat/b',
      targetBranch: 'main',
      authorId: ownerId
    })

    expect(pr1.number).toBe(1)
    expect(pr2.number).toBe(2)
    expect(pr1.status).toBe('open')
    expect(pr1.id).toMatch(/^pr_/)
  })

  it('creates PR with reviewers and approvals', () => {
    const { prStore, projectId, ownerId } = context
    const pr = prStore.create({
      projectId,
      title: 'PR with reviewers',
      sourceBranch: 'feat/review',
      targetBranch: 'main',
      authorId: ownerId,
      reviewers: ['reviewer-1', 'reviewer-2'],
      approvals: ['approver-1']
    })

    expect(pr.reviewers).toEqual(['reviewer-1', 'reviewer-2'])
    expect(pr.approvals).toEqual(['approver-1'])
  })

  it('update whitelists status/title/description and refreshes updatedAt', async () => {
    const { prStore, projectId, ownerId } = context
    const pr = prStore.create({
      projectId,
      title: 'Original',
      description: 'Old desc',
      sourceBranch: 'feat/x',
      targetBranch: 'main',
      authorId: ownerId
    })

    // Why: small delay to ensure updatedAt changes (same-millisecond protection)
    const waitMs = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const updated = await waitMs(2).then(() =>
      prStore.update({
        id: pr.id,
        status: 'merged',
        title: 'Updated',
        description: 'New desc'
      })
    )

    expect(updated.status).toBe('merged')
    expect(updated.title).toBe('Updated')
    expect(updated.description).toBe('New desc')
    expect(updated.updatedAt).not.toBe(pr.updatedAt)
  })

  it('throws when updating unknown PR', () => {
    const { prStore } = context
    expect(() => prStore.update({ id: 'pr_missing', status: 'merged' })).toThrow('PR not found')
  })

  it('nextPrNumber returns correct next value', () => {
    const { prStore, projectId, ownerId } = context
    expect(prStore.nextPrNumber(projectId)).toBe(1)

    prStore.create({
      projectId,
      title: 'PR',
      sourceBranch: 'feat/n',
      targetBranch: 'main',
      authorId: ownerId
    })

    expect(prStore.nextPrNumber(projectId)).toBe(2)
  })

  // Why: verify rowToPr mapping — snake_case DB columns → camelCase fields, JSON arrays parsed
  it('listByProject returns camelCase fields with parsed reviewers/approvals arrays', () => {
    const { prStore, projectId, ownerId } = context
    prStore.create({
      projectId,
      title: 'Mapped PR',
      sourceBranch: 'feat/mapped',
      targetBranch: 'main',
      authorId: ownerId,
      reviewers: ['reviewer-a', 'reviewer-b'],
      approvals: ['approver-x']
    })

    const list = prStore.listByProject(projectId)
    expect(list).toHaveLength(1)

    const pr = list[0]!
    // Why: verify snake→camel mapping
    expect(pr.sourceBranch).toBe('feat/mapped')
    expect(pr.targetBranch).toBe('main')
    expect(pr.authorId).toBe(ownerId)
    expect(pr.createdAt).toBeTruthy()
    expect(pr.updatedAt).toBeTruthy()

    // Why: verify reviewers/approvals are parsed arrays, not JSON strings
    expect(Array.isArray(pr.reviewers)).toBe(true)
    expect(pr.reviewers).toEqual(['reviewer-a', 'reviewer-b'])
    expect(Array.isArray(pr.approvals)).toBe(true)
    expect(pr.approvals).toEqual(['approver-x'])
  })
})
