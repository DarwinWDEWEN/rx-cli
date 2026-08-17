import { randomBytes } from 'node:crypto'
import { getCollaborationDb, type CollaborationDatabase } from './collaboration-database'
import type { Issue, IssuePriority, IssueStatus } from '../../../shared/team-types'
import { getProjectStore } from './project-store'
import { getTeamStore } from './team-store'

type IssueRow = {
  id: string
  project_id: string
  number: number
  title: string
  description: string
  status: string
  priority: string
  owner_id: string
  workline_key: string
  workline_state: string
  created_at: string
  updated_at: string
}

function rowToIssue(row: IssueRow): Issue {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    title: row.title,
    description: row.description,
    status: row.status as IssueStatus,
    priority: row.priority as IssuePriority,
    ownerId: row.owner_id,
    worklineKey: row.workline_key,
    worklineState: row.workline_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function newId(): string {
  return `iss_${randomBytes(8).toString('hex')}`
}

export type CreateIssueInput = {
  projectId: string
  title: string
  description?: string
  priority?: IssuePriority
  ownerId: string
}

export type UpdateIssueInput = {
  id: string
  title?: string
  description?: string
  priority?: IssuePriority
  status?: IssueStatus
  worklineState?: string
  ownerId?: string
}

export type IssueStore = {
  create: (input: CreateIssueInput) => Issue
  get: (id: string) => Issue | undefined
  getByWorklineKey: (projectId: string, worklineKey: string) => Issue | undefined
  listByProject: (projectId: string) => Issue[]
  update: (input: UpdateIssueInput) => Issue
  nextIssueNumber: (projectId: string) => number
}

function prepareStatements(db: CollaborationDatabase) {
  return {
    insert: db.prepare(`
      INSERT INTO issues (
        id, project_id, number, title, description, status, priority,
        owner_id, workline_key, workline_state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM issues WHERE id = ?`),
    selectByWorkline: db.prepare(`SELECT * FROM issues WHERE project_id = ? AND workline_key = ?`),
    selectByProject: db.prepare(`SELECT * FROM issues WHERE project_id = ? ORDER BY number ASC`),
    maxNumber: db.prepare(`SELECT MAX(number) AS max_num FROM issues WHERE project_id = ?`),
    update: db.prepare(`
      UPDATE issues
      SET title = ?, description = ?, priority = ?, status = ?,
          workline_state = ?, owner_id = ?, updated_at = ?
      WHERE id = ?
    `)
  }
}

// Why: cross-store validation helper. Both create and update need to ensure the
// owner is a member of the project team (not just any company team member).
function assertOwnerInProject(
  projectId: string,
  ownerId: string,
  projectStore: ReturnType<typeof getProjectStore>
): void {
  const members = projectStore.listMembers(projectId)
  if (!members.some((m) => m.memberId === ownerId)) {
    throw new Error(`Owner ${ownerId} is not a member of project ${projectId}`)
  }
}

export type CreateIssueStoreDeps = {
  projectStore?: ReturnType<typeof getProjectStore>
  teamStore?: ReturnType<typeof getTeamStore>
}

export function createIssueStore(deps: CreateIssueStoreDeps = {}): IssueStore {
  const db = getCollaborationDb()
  const stmts = prepareStatements(db)
  const projectStore = deps.projectStore ?? getProjectStore()
  const teamStore = deps.teamStore ?? getTeamStore()

  function nextIssueNumber(projectId: string): number {
    const row = stmts.maxNumber.get(projectId) as { max_num: number | null }
    return (row.max_num ?? 0) + 1
  }

  return {
    create(input) {
      // Why: validate project + owner exist before insert — FK alone gives a raw
      // SQLITE_CONSTRAINT error that doesn't say which side failed.
      const project = projectStore.get(input.projectId)
      if (!project) {
        throw new Error(`Project not found: ${input.projectId}`)
      }
      const owner = teamStore.get(input.ownerId)
      if (!owner) {
        throw new Error(`Owner (team member) not found: ${input.ownerId}`)
      }

      // Why: owner must belong to the project team (company team ≠ project team)
      assertOwnerInProject(input.projectId, input.ownerId, projectStore)

      const now = new Date().toISOString()
      const id = newId()
      const number = nextIssueNumber(input.projectId)
      // Why: worklineKey is a stable business identity, decoupled from git refs.
      // Format: issue-{number} — human-readable, URL-safe, unique per project.
      const worklineKey = `issue-${number}`

      stmts.insert.run(
        id,
        input.projectId,
        number,
        input.title,
        input.description ?? '',
        'open', // Why: TECH-DESIGN default
        input.priority ?? 'medium',
        input.ownerId,
        worklineKey,
        'intake', // Why: TECH-DESIGN workline_state default
        now,
        now
      )
      return rowToIssue(stmts.selectById.get(id) as IssueRow)
    },

    get(id) {
      const row = stmts.selectById.get(id) as IssueRow | undefined
      return row ? rowToIssue(row) : undefined
    },

    getByWorklineKey(projectId, worklineKey) {
      const row = stmts.selectByWorkline.get(projectId, worklineKey) as IssueRow | undefined
      return row ? rowToIssue(row) : undefined
    },

    listByProject(projectId) {
      const rows = stmts.selectByProject.all(projectId) as IssueRow[]
      return rows.map(rowToIssue)
    },

    update(input) {
      const existing = stmts.selectById.get(input.id) as IssueRow | undefined
      if (!existing) {
        throw new Error(`Issue not found: ${input.id}`)
      }

      // Why: invariant — owner must always belong to the project team.
      // Validate new owner when provided; otherwise re-validate existing owner
      // (member may have been removed from project team since issue was created).
      const resolvedOwnerId = input.ownerId ?? existing.owner_id
      if (input.ownerId) {
        const newOwner = teamStore.get(input.ownerId)
        if (!newOwner) {
          throw new Error(`New owner not found: ${input.ownerId}`)
        }
      }
      assertOwnerInProject(existing.project_id, resolvedOwnerId, projectStore)

      const now = new Date().toISOString()
      stmts.update.run(
        input.title ?? existing.title,
        input.description ?? existing.description,
        input.priority ?? existing.priority,
        input.status ?? existing.status,
        input.worklineState ?? existing.workline_state,
        resolvedOwnerId,
        now,
        input.id
      )
      return rowToIssue(stmts.selectById.get(input.id) as IssueRow)
    },

    nextIssueNumber
  }
}

let storeInstance: IssueStore | null = null

export function getIssueStore(): IssueStore {
  if (!storeInstance) {
    storeInstance = createIssueStore()
  }
  return storeInstance
}

export function __resetIssueStoreForTests(): void {
  storeInstance = null
}
