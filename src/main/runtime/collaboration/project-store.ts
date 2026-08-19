import { randomBytes } from 'node:crypto'
import { getCollaborationDb, type CollaborationDatabase } from './collaboration-database'
import type { Project, ProjectTeamMember } from '../../../shared/team-types'
import { getTeamStore } from './team-store'

type ProjectRow = {
  id: string
  name: string
  description: string
  workspace_id: string | null
  host_id: string
  host_type: string
  repo_path: string
  default_branch: string
  git_initialized: number
  status: string
  created_at: string
  updated_at: string
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    workspaceId: row.workspace_id ?? undefined,
    hostId: row.host_id,
    hostType: row.host_type,
    repoPath: row.repo_path,
    defaultBranch: row.default_branch,
    gitInitialized: row.git_initialized === 1,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

type ProjectTeamMemberRow = {
  id: string
  project_id: string
  member_id: string
  role_in_project: string
  joined_at: string
}

function rowToProjectTeamMember(row: ProjectTeamMemberRow): ProjectTeamMember {
  return {
    id: row.id,
    projectId: row.project_id,
    memberId: row.member_id,
    roleInProject: row.role_in_project,
    joinedAt: row.joined_at
  }
}

function newId(): string {
  return `proj_${randomBytes(8).toString('hex')}`
}

export type RegisterProjectInput = {
  name: string
  description?: string
  workspaceId?: string
  hostId: string
  hostType: string
  repoPath: string
  defaultBranch?: string
  // Why: gitInitialized is NOT a register input. New projects always start as
  // not-initialized; the UI/runtime layer probes git and calls markGitInitialized.
}

export type ProjectStore = {
  register: (input: RegisterProjectInput) => Project
  get: (id: string) => Project | undefined
  list: () => Project[]
  update: (
    id: string,
    updates: Partial<Pick<Project, 'name' | 'description' | 'status' | 'defaultBranch'>>
  ) => Project
  markGitInitialized: (id: string, initialized?: boolean) => void
  inviteMember: (projectId: string, memberId: string, roleInProject?: string) => ProjectTeamMember
  removeMember: (projectId: string, memberId: string) => void
  listMembers: (projectId: string) => ProjectTeamMember[]
  changeOwner: (projectId: string, newOwnerMemberId: string) => void
}

function prepareStatements(db: CollaborationDatabase) {
  return {
    insertProject: db.prepare(`
      INSERT INTO projects (
        id, name, description, workspace_id, host_id, host_type, repo_path,
        default_branch, git_initialized, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `),
    selectProject: db.prepare(`SELECT * FROM projects WHERE id = ?`),
    selectAllProjects: db.prepare(`SELECT * FROM projects ORDER BY created_at ASC`),
    updateProject: db.prepare(`
      UPDATE projects
      SET name = ?, description = ?, status = ?, default_branch = ?, updated_at = ?
      WHERE id = ?
    `),
    // Why: pure persistence — IPC/runtime layer probes actual git state and calls this.
    setGitInitialized: db.prepare(
      `UPDATE projects SET git_initialized = ?, updated_at = ? WHERE id = ?`
    ),
    insertTeamMember: db.prepare(`
      INSERT INTO project_team_members (id, project_id, member_id, role_in_project, joined_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    selectTeamMember: db.prepare(
      `SELECT * FROM project_team_members WHERE project_id = ? AND member_id = ?`
    ),
    selectAllTeamMembers: db.prepare(
      `SELECT * FROM project_team_members WHERE project_id = ? ORDER BY joined_at ASC`
    ),
    deleteTeamMember: db.prepare(
      `DELETE FROM project_team_members WHERE project_id = ? AND member_id = ?`
    ),
    // Why: block removing a member who still owns an open issue in this project
    countMemberOpenIssues: db.prepare(
      `SELECT COUNT(*) AS c FROM issues WHERE project_id = ? AND owner_id = ? AND status = 'open'`
    ),
    // Why: PRD hard rule — cannot remove a member with any active worktree
    countMemberActiveWorktrees: db.prepare(`
      SELECT COUNT(*) AS c FROM issue_worktrees iw
      JOIN issues i ON iw.issue_id = i.id
      WHERE i.project_id = ? AND iw.member_id = ? AND iw.status = 'active'
    `),
    // Why: changeOwner atomically switches role_in_project between members
    updateRoleInProject: db.prepare(
      `UPDATE project_team_members SET role_in_project = ? WHERE project_id = ? AND member_id = ?`
    ),
    // Why: find current owner for changeOwner operation
    selectCurrentOwner: db.prepare(
      `SELECT * FROM project_team_members WHERE project_id = ? AND role_in_project = 'owner'`
    )
  }
}

export type CreateProjectStoreDeps = {
  teamStore?: ReturnType<typeof getTeamStore>
}

export function createProjectStore(deps: CreateProjectStoreDeps = {}): ProjectStore {
  const db = getCollaborationDb()
  const stmts = prepareStatements(db)
  const teamStore = deps.teamStore ?? getTeamStore()

  return {
    register(input) {
      const now = new Date().toISOString()
      const id = newId()
      stmts.insertProject.run(
        id,
        input.name,
        input.description ?? '',
        input.workspaceId ?? null,
        input.hostId,
        input.hostType,
        input.repoPath,
        input.defaultBranch ?? 'main',
        0, // Why: new registrations always start as not-initialized; markGitInitialized sets it.
        now,
        now
      )
      return {
        id,
        name: input.name,
        description: input.description ?? '',
        workspaceId: input.workspaceId,
        hostId: input.hostId,
        hostType: input.hostType,
        repoPath: input.repoPath,
        defaultBranch: input.defaultBranch ?? 'main',
        gitInitialized: false, // Why: always false on register; markGitInitialized sets it.
        status: 'active',
        createdAt: now,
        updatedAt: now
      }
    },

    get(id) {
      const row = stmts.selectProject.get(id) as ProjectRow | undefined
      return row ? rowToProject(row) : undefined
    },

    list() {
      const rows = stmts.selectAllProjects.all() as ProjectRow[]
      return rows.map(rowToProject)
    },

    update(id, updates) {
      const existing = stmts.selectProject.get(id) as ProjectRow | undefined
      if (!existing) {
        throw new Error(`Project not found: ${id}`)
      }
      const now = new Date().toISOString()
      stmts.updateProject.run(
        updates.name ?? existing.name,
        updates.description ?? existing.description,
        updates.status ?? existing.status,
        updates.defaultBranch ?? existing.default_branch,
        now,
        id
      )
      const updated = stmts.selectProject.get(id) as ProjectRow
      return rowToProject(updated)
    },

    // Why: data layer only persists git state; the probe runs in IPC/runtime.
    markGitInitialized(id, initialized = true) {
      const existing = stmts.selectProject.get(id) as ProjectRow | undefined
      if (!existing) {
        throw new Error(`Project not found: ${id}`)
      }
      stmts.setGitInitialized.run(initialized ? 1 : 0, new Date().toISOString(), id)
    },

    inviteMember(projectId, memberId, roleInProject = 'member') {
      const project = stmts.selectProject.get(projectId) as ProjectRow | undefined
      if (!project) {
        throw new Error(`Project not found: ${projectId}`)
      }
      const member = teamStore.get(memberId)
      if (!member) {
        throw new Error(`Team member not found: ${memberId}`)
      }

      // Why: reject duplicate invitations explicitly instead of relying on the
      // UNIQUE constraint — gives a clearer error than a raw SQLITE_CONSTRAINT.
      const existing = stmts.selectTeamMember.get(projectId, memberId) as
        | ProjectTeamMember
        | undefined
      if (existing) {
        throw new Error(`Member ${memberId} already in project ${projectId}`)
      }

      const id = `ptm_${randomBytes(8).toString('hex')}`
      const now = new Date().toISOString()
      stmts.insertTeamMember.run(id, projectId, memberId, roleInProject, now)
      return { id, projectId, memberId, roleInProject, joinedAt: now }
    },

    removeMember(projectId, memberId) {
      const project = stmts.selectProject.get(projectId) as ProjectRow | undefined
      if (!project) {
        throw new Error(`Project not found: ${projectId}`)
      }

      // Why: PRD §3.6 / §2.2 — hard gate: cannot remove a member with active worktree
      const activeWorktrees = (
        stmts.countMemberActiveWorktrees.get(projectId, memberId) as {
          c: number
        }
      ).c
      if (activeWorktrees > 0) {
        throw new Error(
          `Cannot remove member: still has ${activeWorktrees} active worktree(s) in this project`
        )
      }

      // Why: also block removing a member who still owns open issues in this project
      const openIssues = (
        stmts.countMemberOpenIssues.get(projectId, memberId) as {
          c: number
        }
      ).c
      if (openIssues > 0) {
        throw new Error(
          `Cannot remove member: still owns ${openIssues} open issue(s) in this project`
        )
      }

      stmts.deleteTeamMember.run(projectId, memberId)
    },

    listMembers(projectId) {
      const rows = stmts.selectAllTeamMembers.all(projectId) as ProjectTeamMemberRow[]
      return rows.map(rowToProjectTeamMember)
    },

    changeOwner(projectId, newOwnerMemberId) {
      const project = stmts.selectProject.get(projectId) as ProjectRow | undefined
      if (!project) {
        throw new Error(`Project not found: ${projectId}`)
      }

      // Why: new owner must be a valid team member
      const newOwner = teamStore.get(newOwnerMemberId)
      if (!newOwner) {
        throw new Error(`Team member not found: ${newOwnerMemberId}`)
      }

      // Why: find current owner to downgrade to member
      const currentOwner = stmts.selectCurrentOwner.get(projectId) as
        | ProjectTeamMemberRow
        | undefined

      // Why: ensure new owner is in the project team; if not, invite them first
      const existingMembership = stmts.selectTeamMember.get(projectId, newOwnerMemberId) as
        | ProjectTeamMemberRow
        | undefined

      // Why: atomic role switch + conditional invite in single transaction
      try {
        db.exec('BEGIN;')
        if (!existingMembership) {
          const id = `ptm_${randomBytes(8).toString('hex')}`
          stmts.insertTeamMember.run(
            id,
            projectId,
            newOwnerMemberId,
            'member',
            new Date().toISOString()
          )
        }
        if (currentOwner) {
          stmts.updateRoleInProject.run('member', projectId, currentOwner.member_id)
        }
        stmts.updateRoleInProject.run('owner', projectId, newOwnerMemberId)
        db.exec('COMMIT;')
      } catch (err) {
        db.exec('ROLLBACK;')
        throw err
      }
    }
  }
}

let storeInstance: ProjectStore | null = null

export function getProjectStore(): ProjectStore {
  if (!storeInstance) {
    storeInstance = createProjectStore()
  }
  return storeInstance
}

export function __resetProjectStoreForTests(): void {
  storeInstance = null
}
