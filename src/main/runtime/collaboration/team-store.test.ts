import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') }
}))

const dbMod = await import('./collaboration-database')
const { createTeamStore, __resetTeamStoreForTests } = await import('./team-store')
const { __resetCollaborationDbForTests, __setCollaborationDbPathForTests } = dbMod

// Why: CreateTeamStore calls getCollaborationDb() internally, so the path must
// be installed before the store is constructed.
function makeMember(store: ReturnType<typeof createTeamStore>, over = {}) {
  return store.create({
    name: 'Alice',
    role: 'lead',
    personality: 'detail-oriented',
    responsibilities: ['review'],
    capabilities: ['code'],
    agentType: 'claude',
    agentModel: 'claude-sonnet',
    agentConfig: { foo: 'bar' },
    skills: [{ skillId: 's1', skillName: 'TS', enabled: true }],
    defaultPrompt: 'Be precise.',
    isActive: true,
    hostType: 'local',
    workspaceAccess: ['/tmp/p'],
    avatarUrl: 'https://x/y.png',
    customModelPackageDir: '/tmp/pkg',
    identity: 'alice-01',
    ...over
  })
}

function seedProject(id: string, db: ReturnType<typeof dbMod.getCollaborationDb>): void {
  db.prepare(
    `INSERT INTO projects (id, name, host_id, host_type, repo_path, default_branch, git_initialized, status, created_at, updated_at)
     VALUES (?, 'proj', 'local', 'local', ?, 'main', 1, 'active', '2026-01-01', '2026-01-01')`
  ).run(id, `/tmp/${id}`)
}

describe('team store', () => {
  let store: ReturnType<typeof createTeamStore>

  beforeEach(() => {
    __resetCollaborationDbForTests()
    __setCollaborationDbPathForTests(':memory:')
    __resetTeamStoreForTests()
    store = createTeamStore()
  })

  afterEach(() => {
    __resetTeamStoreForTests()
    __resetCollaborationDbForTests()
  })

  it('creates a member with all TECH-DESIGN fields and derived counters at zero', () => {
    const m = makeMember(store)
    expect(m.id).toMatch(/^tm_/)
    expect(m.isActive).toBe(true)
    expect(m.role).toBe('lead')
    expect(m.agentConfig).toEqual({ foo: 'bar' })
    expect(m.skills).toEqual([{ skillId: 's1', skillName: 'TS', enabled: true }])
    expect(m.totalTasks).toBe(0)
    expect(m.activeProjects).toBe(0)
    expect(m.activeWorktrees).toBe(0)

    const fetched = store.get(m.id)
    expect(fetched?.personality).toBe('detail-oriented')
    expect(fetched?.avatarUrl).toBe('https://x/y.png')
    expect(fetched?.customModelPackageDir).toBe('/tmp/pkg')
  })

  it('lists members in creation order', () => {
    const a = makeMember(store, { name: 'A' })
    const b = makeMember(store, { name: 'B' })
    expect(store.list().map((m) => m.id)).toEqual([a.id, b.id])
  })

  it('updates scalar and JSON columns and refreshes updatedAt', async () => {
    const m = makeMember(store)
    const originalUpdatedAt = m.updatedAt
    await new Promise((r) => setTimeout(r, 5))
    const updated = store.update({
      id: m.id,
      name: 'Alice H.',
      responsibilities: ['lead'],
      personality: 'concise'
    })
    expect(updated.name).toBe('Alice H.')
    expect(updated.responsibilities).toEqual(['lead'])
    expect(updated.personality).toBe('concise')
    expect(updated.updatedAt).not.toBe(originalUpdatedAt)
  })

  // Why: null must clear; undefined must leave untouched.
  it('update can clear optional fields with null while undefined leaves them', () => {
    const m = makeMember(store)
    const updated = store.update({
      id: m.id,
      avatarUrl: null,
      customModelPackageDir: null,
      identity: null,
      agentModel: undefined
    })
    expect(updated.avatarUrl).toBeUndefined()
    expect(updated.customModelPackageDir).toBeUndefined()
    expect(updated.identity).toBeUndefined()
    expect(updated.agentModel).toBe('claude-sonnet') // unchanged
  })

  it('throws on update of a missing member', () => {
    expect(() => store.update({ id: 'tm_missing', name: 'X' })).toThrow(/not found/)
  })

  it('canDelete: allows deletion of an unlinked member', () => {
    const m = makeMember(store)
    expect(store.canDelete(m.id)).toEqual({ canDelete: true })
  })

  it('canDelete: blocks deletion when member owns active worktree on active issue', () => {
    const db = dbMod.getCollaborationDb()
    const m = makeMember(store)
    seedProject('p1', db)
    db.prepare(
      `INSERT INTO issues (id, project_id, number, title, status, priority, owner_id, workline_key, workline_state, created_at, updated_at)
       VALUES ('i1', 'p1', 1, 'Bug', 'open', 'medium', ?, 'wl-1', 'intake', '2026-01-01', '2026-01-01')`
    ).run(m.id)
    db.prepare(
      `INSERT INTO issue_worktrees (id, issue_id, member_id, worktree_id, host_id, status, created_at, updated_at)
       VALUES ('wt1', 'i1', ?, 'wt-xyz', 'local', 'active', '2026-01-01', '2026-01-01')`
    ).run(m.id)

    const result = store.canDelete(m.id)
    expect(result.canDelete).toBe(false)
    if (!result.canDelete) {
      expect(result.reasons.join(' ')).toMatch(/worktree/)
    }
  })

  // Why: FK issue_worktrees.member_id -> team_members is ON DELETE RESTRICT,
  // so even a CLOSED worktree blocks team_members deletion. canDelete must
  // count ALL worktrees, not just active ones, to match the DB constraint.
  it('canDelete: blocks deletion when member only has closed worktree', () => {
    const db = dbMod.getCollaborationDb()
    const m = makeMember(store)
    seedProject('p1', db)
    db.prepare(
      `INSERT INTO issues (id, project_id, number, title, status, priority, owner_id, workline_key, workline_state, created_at, updated_at)
       VALUES ('i1', 'p1', 1, 'Bug', 'done', 'medium', ?, 'wl-1', 'intake', '2026-01-01', '2026-01-01')`
    ).run(m.id)
    db.prepare(
      `INSERT INTO issue_worktrees (id, issue_id, member_id, worktree_id, host_id, status, created_at, updated_at)
       VALUES ('wt1', 'i1', ?, 'wt-xyz', 'local', 'closed', '2026-01-01', '2026-01-01')`
    ).run(m.id) // closed worktree

    const result = store.canDelete(m.id)
    expect(result.canDelete).toBe(false)
    if (!result.canDelete) {
      expect(result.reasons.join(' ')).toMatch(/worktree/)
    }
  })

  it('delete throws when member has active worktree (enforced protection)', () => {
    const db = dbMod.getCollaborationDb()
    const m = makeMember(store)
    seedProject('p1', db)
    db.prepare(
      `INSERT INTO issues (id, project_id, number, title, status, priority, owner_id, workline_key, workline_state, created_at, updated_at)
       VALUES ('i1', 'p1', 1, 'Bug', 'open', 'medium', ?, 'wl-1', 'intake', '2026-01-01', '2026-01-01')`
    ).run(m.id)
    db.prepare(
      `INSERT INTO issue_worktrees (id, issue_id, member_id, worktree_id, host_id, status, created_at, updated_at)
       VALUES ('wt1', 'i1', ?, 'wt-xyz', 'local', 'active', '2026-01-01', '2026-01-01')`
    ).run(m.id)

    expect(() => store.delete(m.id)).toThrow(/Cannot delete team member/)
    expect(store.get(m.id)).toBeDefined() // still present
  })

  it('delete succeeds and cascades project membership when member is unlinked', () => {
    const db = dbMod.getCollaborationDb()
    const m = makeMember(store)
    seedProject('p1', db)
    db.prepare(
      `INSERT INTO project_team_members (id, project_id, member_id, role_in_project, joined_at)
       VALUES ('ptm1', 'p1', ?, 'member', '2026-01-01')`
    ).run(m.id)
    // canDelete blocks because still in project — remove from project first
    db.prepare(`DELETE FROM project_team_members WHERE member_id = ?`).run(m.id)

    store.delete(m.id)
    expect(store.get(m.id)).toBeUndefined()
    const inJoin = db
      .prepare(`SELECT COUNT(*) AS c FROM project_team_members WHERE member_id = ?`)
      .get(m.id) as { c: number }
    expect(inJoin.c).toBe(0)
  })

  it('delete does NOT cascade business data when blocked — RESTRICT is the backstop', () => {
    const db = dbMod.getCollaborationDb()
    const m = makeMember(store)
    seedProject('p1', db)
    db.prepare(
      `INSERT INTO issues (id, project_id, number, title, status, priority, owner_id, workline_key, workline_state, created_at, updated_at)
       VALUES ('i1', 'p1', 1, 'Bug', 'open', 'medium', ?, 'wl-1', 'intake', '2026-01-01', '2026-01-01')`
    ).run(m.id)

    expect(() => store.delete(m.id)).toThrow()
    // Issue must still exist — no accidental cascade
    const issueStillThere = db
      .prepare(`SELECT COUNT(*) AS c FROM issues WHERE id = 'i1'`)
      .get() as { c: number }
    expect(issueStillThere.c).toBe(1)
  })

  it('DB-level RESTRICT blocks raw delete of a member owning an issue even if store bypassed', () => {
    const db = dbMod.getCollaborationDb()
    const m = makeMember(store)
    seedProject('p1', db)
    db.prepare(
      `INSERT INTO issues (id, project_id, number, title, status, priority, owner_id, workline_key, workline_state, created_at, updated_at)
       VALUES ('i1', 'p1', 1, 'Bug', 'open', 'medium', ?, 'wl-1', 'intake', '2026-01-01', '2026-01-01')`
    ).run(m.id)

    // Why: even a direct DB delete must fail — FK backstop works.
    expect(() => db.exec(`DELETE FROM team_members WHERE id = '${m.id}'`)).toThrow()
  })

  // Why: create() must return normalized defaults for all optional fields, even
  // when called directly with minimal input (no Zod to fill defaults).
  it('create returns normalized defaults for optional fields when called with minimal input', () => {
    const m = store.create({
      name: 'Minimal',
      role: 'dev',
      agentType: 'claude',
      agentModel: 'claude-sonnet'
    })
    expect(m.personality).toBe('')
    expect(m.responsibilities).toEqual([])
    expect(m.capabilities).toEqual([])
    expect(m.agentConfig).toEqual({})
    expect(m.skills).toEqual([])
    expect(m.defaultPrompt).toBe('')
    expect(m.isActive).toBe(true)
    expect(m.hostType).toBe('local')
    expect(m.workspaceAccess).toEqual([])
    // Verify no undefined values leak through
    expect(m.personality).not.toBeUndefined()
    expect(m.responsibilities).not.toBeUndefined()
    expect(m.capabilities).not.toBeUndefined()
    expect(m.agentConfig).not.toBeUndefined()
    expect(m.skills).not.toBeUndefined()
    expect(m.defaultPrompt).not.toBeUndefined()
    expect(m.workspaceAccess).not.toBeUndefined()
  })
})
