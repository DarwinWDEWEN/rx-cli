import { randomBytes } from 'node:crypto'
import { getCollaborationDb } from './collaboration-database'
import type { ActivityLog } from '../../../shared/team-types'

// Why: follows existing ID prefix convention (team tm_, issue iss_, pr pr_, comment ic_, git ref iref_)
function newId(): string {
  return `al_${randomBytes(8).toString('hex')}`
}

// Why: raw DB row type — snake_case columns from SQLite
type ActivityLogRow = {
  id: string
  project_id: string | null
  actor_type: string
  actor_id: string
  actor_name: string
  action: string
  target_type: string | null
  target_id: string | null
  metadata: string
  created_at: string
}

// Why: explicit snake→camel mapping — metadata JSON deserialized to Record
function rowToActivity(row: ActivityLogRow): ActivityLog {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    actorType: row.actor_type,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    targetType: row.target_type ?? undefined,
    targetId: row.target_id ?? undefined,
    metadata: deserializeRecord(row.metadata),
    createdAt: row.created_at
  }
}

function deserializeRecord(text: string): Record<string, unknown> {
  if (!text) {
    return {}
  }
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function serializeRecord(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {})
}

export type ActivityLogInput = {
  projectId?: string
  actorType: string
  actorId: string
  actorName: string
  action: string
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
}

export type ActivityLogStore = {
  log: (input: ActivityLogInput) => ActivityLog
  get: (id: string) => ActivityLog | null
  listByProject: (projectId: string, opts?: { limit?: number }) => ActivityLog[]
}

let storeInstance: ActivityLogStore | null = null

export function getActivityLogStore(): ActivityLogStore {
  if (!storeInstance) {
    storeInstance = createActivityLogStore()
  }
  return storeInstance
}

export function __resetActivityLogStoreForTests(): void {
  storeInstance = null
}

function createActivityLogStore(): ActivityLogStore {
  const db = getCollaborationDb()

  const stmts = {
    insert: db.prepare(`
      INSERT INTO activity_log (id, project_id, actor_type, actor_id, actor_name, action, target_type, target_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare('SELECT * FROM activity_log WHERE id = ?'),
    selectByProject: db.prepare(
      'SELECT * FROM activity_log WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'
    ),
    selectByProjectAll: db.prepare(
      'SELECT * FROM activity_log WHERE project_id = ? ORDER BY created_at DESC'
    )
  }

  return {
    log(input: ActivityLogInput): ActivityLog {
      const now = new Date().toISOString()
      const id = newId()
      stmts.insert.run(
        id,
        input.projectId ?? null,
        input.actorType,
        input.actorId,
        input.actorName,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        serializeRecord(input.metadata),
        now
      )
      return rowToActivity(stmts.selectById.get(id) as ActivityLogRow)
    },

    get(id: string): ActivityLog | null {
      const row = stmts.selectById.get(id) as ActivityLogRow | undefined
      return row ? rowToActivity(row) : null
    },

    listByProject(projectId: string, opts?: { limit?: number }): ActivityLog[] {
      const rows = opts?.limit
        ? (stmts.selectByProject.all(projectId, opts.limit) as ActivityLogRow[])
        : (stmts.selectByProjectAll.all(projectId) as ActivityLogRow[])
      return rows.map(rowToActivity)
    }
  }
}
