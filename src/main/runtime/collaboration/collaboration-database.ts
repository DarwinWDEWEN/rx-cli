import { app } from 'electron'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import SyncDatabase from '../../sqlite/sync-database'

export const COLLAB_DB_NAME = 'collaboration.db'
const SCHEMA_VERSION = 5 // Why: v5 对齐 issue_comments.author_type 默认 'agent'（Agent 自动回写场景）

let overridePath: string | null = null

function getDbPath(): string {
  if (overridePath) {
    return overridePath
  }
  return join(app.getPath('userData'), COLLAB_DB_NAME)
}

function applyPragmas(db: SyncDatabase): void {
  // Why: WAL gives concurrent readers during writes; NORMAL balances durability
  // and speed for a single-tenant local DB; busy_timeout lets callers wait out
  // transient writers instead of throwing SQLITE_BUSY.
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA synchronous = NORMAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 5000;')
}

function currentVersion(db: SyncDatabase): number {
  // Why: PRAGMA user_version returns one row; simple mode unwraps the value.
  return (db.pragma('user_version', { simple: true }) as number) ?? 0
}

function setVersion(db: SyncDatabase, version: number): void {
  db.exec(`PRAGMA user_version = ${version};`)
}

// Why: foreign-key strategy is layered by data-ownership semantics:
//   - RESTRICT on business entities (issues/pulls/worktrees/refs/project-team → member):
//     DB-level backstop so a member that still owns active work can't be removed,
//     even by raw SQL that bypasses the store's canDelete().
//   - CASCADE on conversational/audit records (issue_comments/pr_comments/activity_log):
//     these are history, not owning references — removing a member removes their
//     comment footprint. (If "keep trace of deleted member" is ever needed, flip
//     to SET NULL + placeholder rendering.)
function createAllTables(db: SyncDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      avatar_url TEXT,
      personality TEXT NOT NULL DEFAULT '',
      responsibilities TEXT NOT NULL DEFAULT '[]',
      capabilities TEXT NOT NULL DEFAULT '[]',
      agent_type TEXT NOT NULL,
      agent_model TEXT NOT NULL,
      agent_config TEXT NOT NULL DEFAULT '{}',
      skills TEXT NOT NULL DEFAULT '[]',
      default_prompt TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      -- Orca 上层扩展字段（不在 TECH-DESIGN 协作域核心模型内）
      host_type TEXT NOT NULL DEFAULT 'local',
      workspace_access TEXT NOT NULL DEFAULT '[]',
      custom_model_package_dir TEXT,
      identity TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      workspace_id TEXT,
      host_id TEXT NOT NULL,
      host_type TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      default_branch TEXT NOT NULL DEFAULT 'main',
      git_initialized INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      -- Orca 上层扩展
      repo_url TEXT,
      owner TEXT,
      repo TEXT,
      workspace_type TEXT DEFAULT 'folder',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_host_repo
      ON projects(host_id, repo_path);

    CREATE TABLE IF NOT EXISTS project_team_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      role_in_project TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(member_id) REFERENCES team_members(id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_team_project_member
      ON project_team_members(project_id, member_id);

    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',  -- Why: TECH-DESIGN 默认 'open'（非 'active'）
      priority TEXT NOT NULL DEFAULT 'medium',
      owner_id TEXT NOT NULL,
      workline_key TEXT NOT NULL,
      workline_state TEXT NOT NULL DEFAULT 'intake',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(owner_id) REFERENCES team_members(id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_issues_workline
      ON issues(project_id, workline_key);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_issues_project_number
      ON issues(project_id, number);
    CREATE INDEX IF NOT EXISTS idx_issues_owner ON issues(owner_id);

    CREATE TABLE IF NOT EXISTS issue_comments (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_type TEXT NOT NULL DEFAULT 'agent',
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'project_team',
      created_at TEXT NOT NULL,
      FOREIGN KEY(issue_id) REFERENCES issues(id) ON DELETE CASCADE
      -- Why: author FK intentionally omitted — comments may outlive a member.
    );
    CREATE INDEX IF NOT EXISTS idx_issue_comments_issue ON issue_comments(issue_id);

    CREATE TABLE IF NOT EXISTS pull_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      source_branch TEXT NOT NULL,
      target_branch TEXT NOT NULL,
      author_id TEXT NOT NULL,
      reviewers TEXT NOT NULL DEFAULT '[]',
      approvals TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(author_id) REFERENCES team_members(id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prs_project_number
      ON pull_requests(project_id, number);
    CREATE INDEX IF NOT EXISTS idx_prs_issue ON pull_requests(issue_id);

    CREATE TABLE IF NOT EXISTS pr_comments (
      id TEXT PRIMARY KEY,
      pr_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_type TEXT NOT NULL DEFAULT 'user',
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      file_path TEXT,
      line_number INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY(pr_id) REFERENCES pull_requests(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pr_comments_pr ON pr_comments(pr_id);

    CREATE TABLE IF NOT EXISTS issue_worktrees (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      worktree_id TEXT NOT NULL,
      terminal_id TEXT,
      active_ref_name TEXT,
      host_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(issue_id) REFERENCES issues(id) ON DELETE CASCADE,
      FOREIGN KEY(member_id) REFERENCES team_members(id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_worktrees_member
      ON issue_worktrees(issue_id, member_id);

    CREATE TABLE IF NOT EXISTS issue_git_refs (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      ref_name TEXT NOT NULL,
      ref_role TEXT NOT NULL,
      member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
      purpose TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(issue_id) REFERENCES issues(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_git_refs_name
      ON issue_git_refs(issue_id, ref_name);

    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_log(project_id, created_at DESC);
  `)
}

function migrate(db: SyncDatabase): void {
  const v = currentVersion(db)
  if (v >= SCHEMA_VERSION) {
    return
  }

  // Why: wrap the whole upgrade in a transaction so a failed step leaves the file
  // at its previous version rather than half-applied.
  db.exec('BEGIN;')
  try {
    if (v < 1) {
      // Fresh open — nothing to backfill, just build the schema.
      createAllTables(db)
    }
    if (v < 2) {
      // Why: v1→v2 is the TECH-DESIGN convergence. Since the schema was never
      // shipped, we drop-and-recreate rather than backfill columns.
      db.exec(`
        DROP TABLE IF EXISTS activity_log;
        DROP TABLE IF EXISTS issue_git_refs;
        DROP TABLE IF EXISTS issue_worktrees;
        DROP TABLE IF EXISTS pr_comments;
        DROP TABLE IF EXISTS pull_requests;
        DROP TABLE IF EXISTS issue_comments;
        DROP TABLE IF EXISTS issues;
        DROP TABLE IF EXISTS project_team_members;
        DROP TABLE IF EXISTS projects;
        DROP TABLE IF EXISTS team_members;
      `)
      createAllTables(db)
    }
    if (v < 3) {
      // Why: v2→v3 keeps schema identical; bump records issues.status default
      // is 'open' (TECH-DESIGN alignment). No data migration needed.
      createAllTables(db)
    }
    if (v < 4) {
      // Why: v3→v4 aligns projects.git_initialized DEFAULT 1→0 so a raw INSERT
      // can't fabricate a git-initialized project. Pre-release schema, so
      // drop-and-recreate (same approach as v1→v2) instead of backfilling.
      db.exec(`
        DROP TABLE IF EXISTS activity_log;
        DROP TABLE IF EXISTS issue_git_refs;
        DROP TABLE IF EXISTS issue_worktrees;
        DROP TABLE IF EXISTS pr_comments;
        DROP TABLE IF EXISTS pull_requests;
        DROP TABLE IF EXISTS issue_comments;
        DROP TABLE IF EXISTS issues;
        DROP TABLE IF EXISTS project_team_members;
        DROP TABLE IF EXISTS projects;
        DROP TABLE IF EXISTS team_members;
      `)
      createAllTables(db)
    }
    if (v < 5) {
      // Why: v4→v5 aligns issue_comments.author_type DEFAULT 'user'→'agent' so a
      // raw INSERT without author_type gets the Agent-auto-write semantics.
      // Pre-release schema, drop-and-recreate (same approach as v1→v2, v3→v4).
      db.exec(`
        DROP TABLE IF EXISTS activity_log;
        DROP TABLE IF EXISTS issue_git_refs;
        DROP TABLE IF EXISTS issue_worktrees;
        DROP TABLE IF EXISTS pr_comments;
        DROP TABLE IF EXISTS pull_requests;
        DROP TABLE IF EXISTS issue_comments;
        DROP TABLE IF EXISTS issues;
        DROP TABLE IF EXISTS project_team_members;
        DROP TABLE IF EXISTS projects;
        DROP TABLE IF EXISTS team_members;
      `)
      createAllTables(db)
    }
    setVersion(db, SCHEMA_VERSION)
    db.exec('COMMIT;')
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}

export type CollaborationDatabase = SyncDatabase

let instance: SyncDatabase | null = null

export function getCollaborationDb(): SyncDatabase {
  if (instance) {
    return instance
  }

  const dbPath = getDbPath()
  const db = new SyncDatabase(dbPath)
  applyPragmas(db)
  migrate(db)

  // Why: align with orchestration-db hardening — cover live WAL/SHM sidecars too.
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      chmodSync(path, 0o600)
    } catch {
      // Non-POSIX, Windows (DACL-managed), or not-yet-created sidecar — best-effort.
    }
  }

  instance = db
  return db
}

// Test-only: drop the cached singleton so a fresh path can be installed.
export function __resetCollaborationDbForTests(): void {
  if (instance) {
    try {
      instance.close()
    } catch {
      // already closed
    }
  }
  instance = null
  overridePath = null
}

// Test-only: install a path before first access (e.g. ':memory:' or a temp dir).
export function __setCollaborationDbPathForTests(path: string): void {
  overridePath = path
}
