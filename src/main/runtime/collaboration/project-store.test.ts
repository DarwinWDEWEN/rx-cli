import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') }
}))

const dbMod = await import('./collaboration-database')
const { createProjectStore, __resetProjectStoreForTests } = await import('./project-store')
const { createTeamStore, __resetTeamStoreForTests } = await import('./team-store')
const { __resetIssueStoreForTests } = await import('./issue-store')
const { __resetCollaborationDbForTests, __setCollaborationDbPathForTests } = dbMod

const tmpRoot = join(tmpdir(), `collab-proj-test-${Date.now()}`)

describe('project store', () => {
  let store: ReturnType<typeof createProjectStore>
  let teamStore: ReturnType<typeof createTeamStore>
  let testDir: string

  beforeEach(() => {
    __resetCollaborationDbForTests()
    __setCollaborationDbPathForTests(':memory:')
    __resetProjectStoreForTests()
    __resetTeamStoreForTests()
    __resetIssueStoreForTests()
    // Why: explicit deps ensure project -> team cross-store calls share instances.
    teamStore = createTeamStore()
    store = createProjectStore({ teamStore })
    testDir = join(tmpRoot, `p-${randomSuffix()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    __resetProjectStoreForTests()
    __resetTeamStoreForTests()
    __resetIssueStoreForTests()
    __resetCollaborationDbForTests()
    try {
      rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })

  function makeMember(name = 'Alice') {
    return teamStore.create({
      name,
      role: 'member',
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
  }

  it('registers a project with defaults', () => {
    const p = store.register({
      name: 'My Project',
      hostId: 'local',
      hostType: 'local',
      repoPath: testDir
    })
    expect(p.id).toMatch(/^proj_/)
    expect(p.gitInitialized).toBe(false)
    expect(p.defaultBranch).toBe('main')
    expect(p.status).toBe('active')
  })

  it('markGitInitialized persists git state without local probing', () => {
    const p = store.register({
      name: 'Proj',
      hostId: 'local',
      hostType: 'local',
      repoPath: '/nonexistent/ssh/path' // Why: would fail with old local isGitRepo
    })
    expect(p.gitInitialized).toBe(false)
    // Why: data layer accepts probe result from IPC/runtime layer
    store.markGitInitialized(p.id, true)
    expect(store.get(p.id)?.gitInitialized).toBe(true)
    store.markGitInitialized(p.id, false)
    expect(store.get(p.id)?.gitInitialized).toBe(false)
  })

  it('lists projects in creation order', () => {
    const a = store.register({
      name: 'A',
      hostId: 'local',
      hostType: 'local',
      repoPath: `${testDir}/a`
    })
    const b = store.register({
      name: 'B',
      hostId: 'local',
      hostType: 'local',
      repoPath: `${testDir}/b`
    })
    expect(store.list().map((p) => p.id)).toEqual([a.id, b.id])
  })

  it('update changes name and refreshes updatedAt', async () => {
    const p = store.register({ name: 'Old', hostId: 'local', hostType: 'local', repoPath: testDir })
    await new Promise((r) => setTimeout(r, 5))
    const updated = store.update(p.id, { name: 'New', defaultBranch: 'develop' })
    expect(updated.name).toBe('New')
    expect(updated.defaultBranch).toBe('develop')
    expect(updated.updatedAt).not.toBe(p.updatedAt)
  })

  it('inviteMember adds a team member to the project', () => {
    const p = store.register({
      name: 'Proj',
      hostId: 'local',
      hostType: 'local',
      repoPath: testDir
    })
    const m = makeMember()
    const membership = store.inviteMember(p.id, m.id, 'owner')
    expect(membership.projectId).toBe(p.id)
    expect(membership.memberId).toBe(m.id)
    expect(membership.roleInProject).toBe('owner')
    expect(store.listMembers(p.id)).toHaveLength(1)
  })

  it('inviteMember rejects duplicates', () => {
    const p = store.register({
      name: 'Proj',
      hostId: 'local',
      hostType: 'local',
      repoPath: testDir
    })
    const m = makeMember()
    store.inviteMember(p.id, m.id)
    expect(() => store.inviteMember(p.id, m.id)).toThrow(/already in project/)
  })

  it('inviteMember throws for unknown member', () => {
    const p = store.register({
      name: 'Proj',
      hostId: 'local',
      hostType: 'local',
      repoPath: testDir
    })
    expect(() => store.inviteMember(p.id, 'tm_missing')).toThrow(/Team member not found/)
  })

  // Why: PRD hard rule — cannot remove member with active worktree
  it('removeMember blocks removal when member has active worktree', () => {
    const db = dbMod.getCollaborationDb()
    const p = store.register({
      name: 'Proj',
      hostId: 'local',
      hostType: 'local',
      repoPath: testDir
    })
    const m = makeMember()
    store.inviteMember(p.id, m.id)

    // Create issue + active worktree for this member in this project
    db.prepare(
      `INSERT INTO issues (id, project_id, number, title, status, priority, owner_id, workline_key, workline_state, created_at, updated_at)
       VALUES ('i1', ?, 1, 'Bug', 'open', 'medium', ?, 'wl-1', 'intake', '2026-01-01', '2026-01-01')`
    ).run(p.id, m.id)
    db.prepare(
      `INSERT INTO issue_worktrees (id, issue_id, member_id, worktree_id, host_id, status, created_at, updated_at)
       VALUES ('wt1', 'i1', ?, 'wt-xyz', 'local', 'active', '2026-01-01', '2026-01-01')`
    ).run(m.id)

    expect(() => store.removeMember(p.id, m.id)).toThrow(/active worktree/)
    expect(store.listMembers(p.id)).toHaveLength(1) // still a member
  })

  it('removeMember succeeds after worktree is closed', () => {
    const db = dbMod.getCollaborationDb()
    const p = store.register({
      name: 'Proj',
      hostId: 'local',
      hostType: 'local',
      repoPath: testDir
    })
    const m = makeMember()
    store.inviteMember(p.id, m.id)

    // Why: issue is 'done' (not 'open') and worktree is 'closed' — both gates pass.
    db.prepare(
      `INSERT INTO issues (id, project_id, number, title, status, priority, owner_id, workline_key, workline_state, created_at, updated_at)
       VALUES ('i1', ?, 1, 'Bug', 'done', 'medium', ?, 'wl-1', 'intake', '2026-01-01', '2026-01-01')`
    ).run(p.id, m.id)
    db.prepare(
      `INSERT INTO issue_worktrees (id, issue_id, member_id, worktree_id, host_id, status, created_at, updated_at)
       VALUES ('wt1', 'i1', ?, 'wt-xyz', 'local', 'closed', '2026-01-01', '2026-01-01')`
    ).run(m.id)

    store.removeMember(p.id, m.id)
    expect(store.listMembers(p.id)).toHaveLength(0)
  })

  // Why: PRD hard rule — cannot remove member who still owns open issues
  it('removeMember blocks removal when member still owns open issues', () => {
    const db = dbMod.getCollaborationDb()
    const p = store.register({
      name: 'Proj',
      hostId: 'local',
      hostType: 'local',
      repoPath: testDir
    })
    const m = makeMember()
    store.inviteMember(p.id, m.id)

    db.prepare(
      `INSERT INTO issues (id, project_id, number, title, status, priority, owner_id, workline_key, workline_state, created_at, updated_at)
       VALUES ('i1', ?, 1, 'Bug', 'open', 'medium', ?, 'wl-1', 'intake', '2026-01-01', '2026-01-01')`
    ).run(p.id, m.id)

    expect(() => store.removeMember(p.id, m.id)).toThrow(/open issue/)
    expect(store.listMembers(p.id)).toHaveLength(1) // still a member
  })

  // Why: C7d — changeOwner atomically switches owner role
  it('changeOwner switches owner role correctly', () => {
    const p = store.register({
      name: 'Proj',
      hostId: 'local',
      hostType: 'local',
      repoPath: testDir
    })
    const alice = makeMember('Alice')
    const bob = makeMember('Bob')

    store.inviteMember(p.id, alice.id, 'owner')
    store.inviteMember(p.id, bob.id, 'member')

    store.changeOwner(p.id, bob.id)

    const members = store.listMembers(p.id)
    const aliceMember = members.find((m) => m.memberId === alice.id)
    const bobMember = members.find((m) => m.memberId === bob.id)
    expect(aliceMember?.roleInProject).toBe('member')
    expect(bobMember?.roleInProject).toBe('owner')
  })

  it('changeOwner invites new owner if not in project', () => {
    const p = store.register({
      name: 'Proj',
      hostId: 'local',
      hostType: 'local',
      repoPath: testDir
    })
    const alice = makeMember('Alice')
    const charlie = makeMember('Charlie')

    store.inviteMember(p.id, alice.id, 'owner')
    // Charlie is not in project yet
    store.changeOwner(p.id, charlie.id)

    const members = store.listMembers(p.id)
    expect(members).toHaveLength(2)
    const charlieMember = members.find((m) => m.memberId === charlie.id)
    expect(charlieMember?.roleInProject).toBe('owner')
  })

  it('changeOwner throws for unknown project', () => {
    const alice = makeMember('Alice')
    expect(() => store.changeOwner('proj_missing', alice.id)).toThrow(/Project not found/)
  })

  it('changeOwner throws for unknown team member', () => {
    const p = store.register({
      name: 'Proj',
      hostId: 'local',
      hostType: 'local',
      repoPath: testDir
    })
    expect(() => store.changeOwner(p.id, 'tm_missing')).toThrow(/Team member not found/)
  })

  it('changeOwner preserves old owner open issues', () => {
    const db = dbMod.getCollaborationDb()
    const p = store.register({
      name: 'Proj',
      hostId: 'local',
      hostType: 'local',
      repoPath: testDir
    })
    const alice = makeMember('Alice')
    const bob = makeMember('Bob')

    store.inviteMember(p.id, alice.id, 'owner')
    store.inviteMember(p.id, bob.id, 'member')

    // Alice has an open issue
    db.prepare(
      `INSERT INTO issues (id, project_id, number, title, status, priority, owner_id, workline_key, workline_state, created_at, updated_at)
       VALUES ('i1', ?, 1, 'Bug', 'open', 'medium', ?, 'wl-1', 'intake', '2026-01-01', '2026-01-01')`
    ).run(p.id, alice.id)

    store.changeOwner(p.id, bob.id)

    // Alice's issue should still belong to her
    const issue = db.prepare('SELECT owner_id FROM issues WHERE id = ?').get('i1') as {
      owner_id: string
    }
    expect(issue.owner_id).toBe(alice.id)
  })

  // Why: B1 — changeOwner insert must be in transaction (rollback on failure leaves no orphan)
  it('changeOwner rolls back insert when update fails', async () => {
    const p = store.register({
      name: 'Proj',
      hostId: 'local',
      hostType: 'local',
      repoPath: testDir
    })
    const alice = makeMember('Alice')
    const charlie = makeMember('Charlie')

    store.inviteMember(p.id, alice.id, 'owner')

    // Why: spy on SyncDatabase.prototype.exec to simulate COMMIT failure
    const { default: SyncDatabase } = await import('../../sqlite/sync-database')
    const origExec = SyncDatabase.prototype.exec
    let execCount = 0
    SyncDatabase.prototype.exec = function execSpy(
      this: typeof SyncDatabase.prototype,
      ...args: [string]
    ) {
      execCount++
      // Let BEGIN (1st) pass, fail on COMMIT (2nd) to trigger ROLLBACK
      if (execCount === 2) {
        throw new Error('simulated commit failure')
      }
      return origExec.apply(this, args)
    }

    try {
      expect(() => store.changeOwner(p.id, charlie.id)).toThrow(/simulated commit failure/)
    } finally {
      SyncDatabase.prototype.exec = origExec
    }

    // Why: Charlie should NOT be in the project team after rollback
    const members = store.listMembers(p.id)
    expect(members).toHaveLength(1) // only alice, no charlie
    expect(members.find((m) => m.memberId === charlie.id)).toBeUndefined()
  })
})

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}
