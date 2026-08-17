import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Why: main-process DB module imports electron for the userData path; in tests we
// short-circuit that by injecting ':memory:' before any access.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') }
}))

const { getCollaborationDb, __resetCollaborationDbForTests, __setCollaborationDbPathForTests } =
  await import('./collaboration-database')

describe('collaboration database', () => {
  beforeEach(() => {
    __resetCollaborationDbForTests()
    __setCollaborationDbPathForTests(':memory:')
  })

  afterEach(() => {
    __resetCollaborationDbForTests()
  })

  it('creates the full schema on first open and sets user_version to 5', () => {
    const db = getCollaborationDb()
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      )
      .all() as { name: string }[]

    const tableNames = tables.map((t) => t.name).join(',')
    for (const expected of [
      'team_members',
      'projects',
      'project_team_members',
      'issues',
      'issue_comments',
      'pull_requests',
      'pr_comments',
      'issue_worktrees',
      'issue_git_refs',
      'activity_log'
    ]) {
      expect(tableNames).toContain(expected)
    }

    expect(db.pragma('user_version', { simple: true })).toBe(5)
  })

  // Why: v5 contract test — issue_comments.author_type 默认应为 'agent'。
  it('issue_comments author_type defaults to agent', () => {
    const db = getCollaborationDb()
    // Why: insert without author_type to verify DDL default.
    db.prepare(
      `INSERT INTO team_members (id, name, role, agent_type, agent_model, personality, responsibilities, capabilities, agent_config, skills, default_prompt, is_active, host_type, workspace_access, created_at, updated_at)
       VALUES ('m1', 'Test', 'dev', 'claude', 'model', '', '[]', '[]', '{}', '{}', '', 1, 'local', '[]', '2026-01-01', '2026-01-01')`
    ).run()
    db.prepare(
      `INSERT INTO projects (id, name, host_id, host_type, repo_path, default_branch, git_initialized, status, created_at, updated_at)
       VALUES ('p1', 'Test', 'local', 'local', '/tmp/t', 'main', 0, 'active', '2026-01-01', '2026-01-01')`
    ).run()
    db.prepare(
      `INSERT INTO issues (id, project_id, number, title, status, priority, owner_id, workline_key, workline_state, created_at, updated_at)
       VALUES ('i1', 'p1', 1, 'Bug', 'open', 'medium', 'm1', 'issue-1', 'intake', '2026-01-01', '2026-01-01')`
    ).run()
    // Why: 省略 author_type，验证 DDL 默认值。
    db.prepare(
      `INSERT INTO issue_comments (id, issue_id, author_id, author_name, body, created_at)
       VALUES ('ic1', 'i1', 'm1', 'Test', 'hello', '2026-01-01')`
    ).run()

    const row = db.prepare(`SELECT author_type FROM issue_comments WHERE id = 'ic1'`).get() as {
      author_type: string
    }
    expect(row.author_type).toBe('agent')
  })

  // Why: contract test — guards against schema drifting from TECH-DESIGN again.
  it('matches TECH-DESIGN key columns on team_members', () => {
    const db = getCollaborationDb()
    const cols = db.prepare(`PRAGMA table_info(team_members)`).all() as { name: string }[]
    const names = cols.map((c) => c.name)
    for (const required of [
      'id',
      'name',
      'role',
      'avatar_url',
      'personality',
      'responsibilities',
      'capabilities',
      'agent_type',
      'agent_model',
      'agent_config',
      'skills',
      'default_prompt',
      'is_active',
      'created_at',
      'updated_at'
    ]) {
      expect(names).toContain(required)
    }
    // is_human should NOT exist (was removed in v2)
    expect(names).not.toContain('is_human')
  })

  it('matches TECH-DESIGN key columns on issues (owner_id not assignee_id)', () => {
    const db = getCollaborationDb()
    const cols = db.prepare(`PRAGMA table_info(issues)`).all() as { name: string }[]
    const names = cols.map((c) => c.name)
    expect(names).toContain('owner_id')
    expect(names).toContain('number')
    expect(names).toContain('priority')
    expect(names).toContain('workline_state')
    expect(names).not.toContain('assignee_id')
  })

  it('matches TECH-DESIGN key columns on pull_requests (has project_id + number)', () => {
    const db = getCollaborationDb()
    const cols = db.prepare(`PRAGMA table_info(pull_requests)`).all() as { name: string }[]
    const names = cols.map((c) => c.name)
    expect(names).toContain('project_id')
    expect(names).toContain('number')
    expect(names).toContain('issue_id')
  })

  it('matches TECH-DESIGN key columns on issue_worktrees (worktree_id, active_ref_name, host_id)', () => {
    const db = getCollaborationDb()
    const cols = db.prepare(`PRAGMA table_info(issue_worktrees)`).all() as { name: string }[]
    const names = cols.map((c) => c.name)
    expect(names).toContain('worktree_id')
    expect(names).toContain('active_ref_name')
    expect(names).toContain('host_id')
    expect(names).not.toContain('base_path')
    expect(names).not.toContain('active_refs')
  })

  it('matches TECH-DESIGN key columns on issue_git_refs (ref_name, ref_role, purpose)', () => {
    const db = getCollaborationDb()
    const cols = db.prepare(`PRAGMA table_info(issue_git_refs)`).all() as { name: string }[]
    const names = cols.map((c) => c.name)
    expect(names).toContain('ref_name')
    expect(names).toContain('ref_role')
    expect(names).toContain('purpose')
    expect(names).not.toContain('ref')
    expect(names).not.toContain('ref_type')
    expect(names).not.toContain('parent_ref')
  })

  it('is idempotent — opening twice returns the same singleton and does not throw', () => {
    const first = getCollaborationDb()
    const second = getCollaborationDb()
    expect(first).toBe(second)
  })

  it('RESTRICT on issues.owner_id blocks deleting a member that owns an issue', () => {
    const db = getCollaborationDb()
    db.exec(
      `INSERT INTO team_members (id, name, role, personality, responsibilities, capabilities,
        agent_type, agent_model, agent_config, skills, default_prompt, is_active,
        host_type, workspace_access, created_at, updated_at)
       VALUES ('m1', 'Alice', '', '', '[]', '[]', 'claude', 'claude-sonnet', '{}', '[]', '', 1, 'local', '[]', '2026-01-01', '2026-01-01')`
    )
    db.exec(
      `INSERT INTO projects (id, name, host_id, host_type, repo_path, default_branch, git_initialized, status, created_at, updated_at)
       VALUES ('p1', 'proj', 'local', 'local', '/tmp/p', 'main', 1, 'active', '2026-01-01', '2026-01-01')`
    )
    db.exec(
      `INSERT INTO issues (id, project_id, number, title, status, priority, owner_id, workline_key, workline_state, created_at, updated_at)
       VALUES ('i1', 'p1', 1, 'Bug', 'open', 'medium', 'm1', 'wl-1', 'intake', '2026-01-01', '2026-01-01')`
    )
    // Why: RESTRICT FK must prevent deleting the member that owns an issue.
    expect(() => db.exec(`DELETE FROM team_members WHERE id = 'm1'`)).toThrow()
  })

  it('RESTRICT on issue_worktrees.member_id blocks deleting a member with an active worktree', () => {
    const db = getCollaborationDb()
    db.exec(
      `INSERT INTO team_members (id, name, role, personality, responsibilities, capabilities,
        agent_type, agent_model, agent_config, skills, default_prompt, is_active,
        host_type, workspace_access, created_at, updated_at)
       VALUES ('m1', 'Alice', '', '', '[]', '[]', 'claude', 'claude-sonnet', '{}', '[]', '', 1, 'local', '[]', '2026-01-01', '2026-01-01')`
    )
    db.exec(
      `INSERT INTO projects (id, name, host_id, host_type, repo_path, default_branch, git_initialized, status, created_at, updated_at)
       VALUES ('p1', 'proj', 'local', 'local', '/tmp/p', 'main', 1, 'active', '2026-01-01', '2026-01-01')`
    )
    db.exec(
      `INSERT INTO issues (id, project_id, number, title, status, priority, owner_id, workline_key, workline_state, created_at, updated_at)
       VALUES ('i1', 'p1', 1, 'Bug', 'open', 'medium', 'm1', 'wl-1', 'intake', '2026-01-01', '2026-01-01')`
    )
    db.exec(
      `INSERT INTO issue_worktrees (id, issue_id, member_id, worktree_id, host_id, status, created_at, updated_at)
       VALUES ('wt1', 'i1', 'm1', 'wt-xyz', 'local', 'active', '2026-01-01', '2026-01-01')`
    )
    expect(() => db.exec(`DELETE FROM team_members WHERE id = 'm1'`)).toThrow()
  })

  it('CASCADE on issue_comments removes comments when issue is deleted', () => {
    const db = getCollaborationDb()
    db.exec(
      `INSERT INTO team_members (id, name, role, personality, responsibilities, capabilities,
        agent_type, agent_model, agent_config, skills, default_prompt, is_active,
        host_type, workspace_access, created_at, updated_at)
       VALUES ('m1', 'Alice', '', '', '[]', '[]', 'claude', 'claude-sonnet', '{}', '[]', '', 1, 'local', '[]', '2026-01-01', '2026-01-01')`
    )
    db.exec(
      `INSERT INTO projects (id, name, host_id, host_type, repo_path, default_branch, git_initialized, status, created_at, updated_at)
       VALUES ('p1', 'proj', 'local', 'local', '/tmp/p', 'main', 1, 'active', '2026-01-01', '2026-01-01')`
    )
    db.exec(
      `INSERT INTO issues (id, project_id, number, title, status, priority, owner_id, workline_key, workline_state, created_at, updated_at)
       VALUES ('i1', 'p1', 1, 'Bug', 'open', 'medium', 'm1', 'wl-1', 'intake', '2026-01-01', '2026-01-01')`
    )
    db.exec(
      `INSERT INTO issue_comments (id, issue_id, author_id, author_type, author_name, body, visibility, created_at)
       VALUES ('c1', 'i1', 'm1', 'agent', 'Alice', 'note', 'project_team', '2026-01-01')`
    )
    db.exec(`DELETE FROM issues WHERE id = 'i1'`)
    const remaining = db
      .prepare(`SELECT COUNT(*) AS c FROM issue_comments WHERE issue_id = 'i1'`)
      .get() as { c: number }
    expect(remaining.c).toBe(0)
  })

  it('rejects duplicate project host_id+repo_path', () => {
    const db = getCollaborationDb()
    const insert = db.prepare(
      `INSERT INTO projects (id, name, host_id, host_type, repo_path, default_branch, git_initialized, status, created_at, updated_at)
       VALUES (?, 'proj', 'local', 'local', '/tmp/p', 'main', 1, 'active', '2026-01-01', '2026-01-01')`
    )
    insert.run('p1')
    expect(() => insert.run('p2')).toThrow()
  })

  it('defaults git_initialized to 0 when omitted so a raw INSERT cannot fabricate git state', () => {
    const db = getCollaborationDb()
    db.exec(
      `INSERT INTO projects (id, name, host_id, host_type, repo_path, status, created_at, updated_at)
       VALUES ('p1', 'proj', 'local', 'local', '/tmp/p', 'active', '2026-01-01', '2026-01-01')`
    )
    const row = db.prepare(`SELECT git_initialized FROM projects WHERE id = 'p1'`).get() as {
      git_initialized: number
    }
    expect(row.git_initialized).toBe(0)
  })

  it('rejects duplicate issue_git_refs issue_id+ref_name', () => {
    const db = getCollaborationDb()
    db.exec(
      `INSERT INTO team_members (id, name, role, personality, responsibilities, capabilities,
        agent_type, agent_model, agent_config, skills, default_prompt, is_active,
        host_type, workspace_access, created_at, updated_at)
       VALUES ('m1', 'Alice', '', '', '[]', '[]', 'claude', 'claude-sonnet', '{}', '[]', '', 1, 'local', '[]', '2026-01-01', '2026-01-01')`
    )
    db.exec(
      `INSERT INTO projects (id, name, host_id, host_type, repo_path, default_branch, git_initialized, status, created_at, updated_at)
       VALUES ('p1', 'proj', 'local', 'local', '/tmp/p', 'main', 1, 'active', '2026-01-01', '2026-01-01')`
    )
    db.exec(
      `INSERT INTO issues (id, project_id, number, title, status, priority, owner_id, workline_key, workline_state, created_at, updated_at)
       VALUES ('i1', 'p1', 1, 'Bug', 'open', 'medium', 'm1', 'wl-1', 'intake', '2026-01-01', '2026-01-01')`
    )
    const insert = db.prepare(
      `INSERT INTO issue_git_refs (id, issue_id, ref_name, ref_role, purpose, status, created_at, updated_at)
       VALUES (?, 'i1', 'feat-x', 'owner', '', 'active', '2026-01-01', '2026-01-01')`
    )
    insert.run('r1')
    expect(() => insert.run('r2')).toThrow()
  })
})
