import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') }
}))

const dbMod = await import('./collaboration-database')
const { createProjectStore, __resetProjectStoreForTests } = await import('./project-store')
const { createIssueStore, __resetIssueStoreForTests } = await import('./issue-store')
const { createTeamStore, __resetTeamStoreForTests } = await import('./team-store')
const { __resetCollaborationDbForTests, __setCollaborationDbPathForTests } = dbMod

const tmpRoot = join(tmpdir(), `collab-iss-test-${Date.now()}`)

describe('issue store', () => {
  let projectStore: ReturnType<typeof createProjectStore>
  let issueStore: ReturnType<typeof createIssueStore>
  let teamStore: ReturnType<typeof createTeamStore>
  let projectId: string
  let ownerId: string

  beforeEach(() => {
    __resetCollaborationDbForTests()
    __setCollaborationDbPathForTests(':memory:')
    __resetProjectStoreForTests()
    __resetIssueStoreForTests()
    __resetTeamStoreForTests()
    // Why: explicit deps ensure cross-store calls see the same instance,
    // regardless of how vitest resolves dynamic vs static imports.
    teamStore = createTeamStore()
    projectStore = createProjectStore({ teamStore })
    issueStore = createIssueStore({ projectStore, teamStore })

    const testDir = join(tmpRoot, `iss-${randomSuffix()}`)
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
    ownerId = owner.id

    const project = projectStore.register({
      name: 'Test Project',
      hostId: 'local',
      hostType: 'local',
      repoPath: testDir
    })
    projectId = project.id
    projectStore.inviteMember(projectId, ownerId, 'owner')
  })

  afterEach(() => {
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

  it('creates an issue with auto-generated number and worklineKey', () => {
    const issue = issueStore.create({
      projectId,
      title: 'Fix bug',
      ownerId
    })
    expect(issue.id).toMatch(/^iss_/)
    expect(issue.number).toBe(1)
    expect(issue.worklineKey).toBe('issue-1')
    expect(issue.status).toBe('open')
    expect(issue.priority).toBe('medium')
    expect(issue.worklineState).toBe('intake')
  })

  it('auto-increments issue numbers within a project', () => {
    const i1 = issueStore.create({ projectId, title: 'First', ownerId })
    const i2 = issueStore.create({ projectId, title: 'Second', ownerId })
    expect(i1.number).toBe(1)
    expect(i2.number).toBe(2)
    expect(i1.worklineKey).toBe('issue-1')
    expect(i2.worklineKey).toBe('issue-2')
  })

  it('numbers are per-project, not global', () => {
    const otherDir = join(tmpRoot, `other-${randomSuffix()}`)
    mkdirSync(otherDir, { recursive: true })
    const otherProject = projectStore.register({
      name: 'Other',
      hostId: 'local',
      hostType: 'local',
      repoPath: otherDir
    })
    // Why: owner must be a member of the second project too (owner validation)
    projectStore.inviteMember(otherProject.id, ownerId)
    const i1 = issueStore.create({ projectId, title: 'A', ownerId })
    const i2 = issueStore.create({ projectId: otherProject.id, title: 'B', ownerId })
    expect(i1.number).toBe(1)
    expect(i2.number).toBe(1) // separate sequence
  })

  it('throws when creating an issue for unknown project', () => {
    expect(() => issueStore.create({ projectId: 'proj_missing', title: 'X', ownerId })).toThrow(
      /Project not found/
    )
  })

  it('throws when creating an issue with unknown owner', () => {
    expect(() => issueStore.create({ projectId, title: 'X', ownerId: 'tm_missing' })).toThrow(
      /Owner.*not found/
    )
  })

  // Why: owner must belong to the project team, not just any company team member
  it('throws when owner is a team member but not in project team', () => {
    const outsider = teamStore.create({
      name: 'Outsider',
      role: 'member',
      personality: '',
      responsibilities: [],
      capabilities: [],
      agentType: 'codex',
      agentModel: 'codex-1',
      agentConfig: {},
      skills: [],
      defaultPrompt: '',
      isActive: true,
      hostType: 'local',
      workspaceAccess: []
    })
    expect(() => issueStore.create({ projectId, title: 'X', ownerId: outsider.id })).toThrow(
      /not a member of project/
    )
  })

  // Why: update to a non-project-member owner must also fail
  it('throws when updating owner to a non-project-member', () => {
    const issue = issueStore.create({ projectId, title: 'Original', ownerId })
    const outsider = teamStore.create({
      name: 'Outsider',
      role: 'member',
      personality: '',
      responsibilities: [],
      capabilities: [],
      agentType: 'codex',
      agentModel: 'codex-1',
      agentConfig: {},
      skills: [],
      defaultPrompt: '',
      isActive: true,
      hostType: 'local',
      workspaceAccess: []
    })
    expect(() => issueStore.update({ id: issue.id, ownerId: outsider.id })).toThrow(
      /not a member of project/
    )
  })

  // Why: update to a project-member owner must succeed
  it('update owner to another project member succeeds', () => {
    const issue = issueStore.create({ projectId, title: 'Original', ownerId })
    const otherMember = teamStore.create({
      name: 'Bob',
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
    projectStore.inviteMember(projectId, otherMember.id)
    const updated = issueStore.update({ id: issue.id, ownerId: otherMember.id })
    expect(updated.ownerId).toBe(otherMember.id)
  })

  // Why: invariant — owner must ALWAYS belong to the project team. If owner was
  // removed from project team, even a status-only update (no ownerId change) must fail.
  it('update fails when existing owner was removed from project team', () => {
    const issue = issueStore.create({ projectId, title: 'Original', ownerId })
    // Close the issue first so owner can be removed (removeMember blocks open issues)
    issueStore.update({ id: issue.id, status: 'done' })
    // Remove owner from project team
    projectStore.removeMember(projectId, ownerId)
    // Try to reopen issue without changing ownerId — should fail
    expect(() =>
      issueStore.update({ id: issue.id, status: 'open', worklineState: 'in_progress' })
    ).toThrow(/not a member of project/)
  })

  it('getByWorklineKey finds the issue', () => {
    const issue = issueStore.create({ projectId, title: 'Find me', ownerId })
    const found = issueStore.getByWorklineKey(projectId, issue.worklineKey)
    expect(found?.id).toBe(issue.id)
  })

  it('listByProject returns issues in number order', () => {
    issueStore.create({ projectId, title: 'A', ownerId })
    issueStore.create({ projectId, title: 'B', ownerId })
    issueStore.create({ projectId, title: 'C', ownerId })
    const list = issueStore.listByProject(projectId)
    expect(list.map((i) => i.number)).toEqual([1, 2, 3])
  })

  it('update changes title, status, and worklineState', () => {
    const issue = issueStore.create({ projectId, title: 'Old', ownerId })
    const updated = issueStore.update({
      id: issue.id,
      title: 'New',
      status: 'done',
      worklineState: 'in_progress'
    })
    expect(updated.title).toBe('New')
    expect(updated.status).toBe('done')
    expect(updated.worklineState).toBe('in_progress')
  })

  it('update rejects unknown new owner', () => {
    const issue = issueStore.create({ projectId, title: 'X', ownerId })
    expect(() => issueStore.update({ id: issue.id, ownerId: 'tm_missing' })).toThrow(
      /New owner not found/
    )
  })

  it('nextIssueNumber reflects current max', () => {
    expect(issueStore.nextIssueNumber(projectId)).toBe(1)
    issueStore.create({ projectId, title: 'A', ownerId })
    expect(issueStore.nextIssueNumber(projectId)).toBe(2)
  })

  it('worklineKey is unique per project (DB constraint)', () => {
    // Why: the UNIQUE(project_id, workline_key) index must hold.
    issueStore.create({ projectId, title: 'First', ownerId })
    // Force a duplicate by inserting via DB with same worklineKey
    const db = dbMod.getCollaborationDb()
    expect(() => {
      db.prepare(
        `INSERT INTO issues (id, project_id, number, title, status, priority, owner_id, workline_key, workline_state, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'open', 'medium', ?, ?, 'intake', '2026-01-01', '2026-01-01')`
      ).run('iss_dup', projectId, 99, 'Dup', ownerId, 'issue-1')
    }).toThrow()
  })
})

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}
