import { randomBytes } from 'node:crypto'
import { getCollaborationDb } from './collaboration-database'
import type { IssueWorktree } from '../../../shared/team-types'
import { getIssueStore } from './issue-store'
import { getTeamStore } from './team-store'

// Why: follows existing ID prefix convention (iw_ for issue-worktree, distinct from iref_ for git refs)
function newId(): string {
  return `iw_${randomBytes(8).toString('hex')}`
}

// Why: raw DB row type — snake_case columns from SQLite
type IssueWorktreeRow = {
  id: string
  issue_id: string
  member_id: string
  worktree_id: string
  terminal_id: string | null
  active_ref_name: string | null
  host_id: string
  status: string
  created_at: string
  updated_at: string
}

// Why: explicit snake→camel mapping — R14/R15 invariant, no bare `as unknown as`
function rowToWorktree(row: IssueWorktreeRow): IssueWorktree {
  return {
    id: row.id,
    issueId: row.issue_id,
    memberId: row.member_id,
    worktreeId: row.worktree_id,
    terminalId: row.terminal_id ?? undefined,
    activeRefName: row.active_ref_name ?? undefined,
    hostId: row.host_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export type RegisterWorktreeInput = {
  issueId: string
  memberId: string
  worktreeId: string
  hostId: string
  terminalId?: string
  activeRefName?: string
  status?: string
}

export type UpdateWorktreeInput = {
  id: string
  status?: string
  terminalId?: string
  activeRefName?: string
}

export type IssueWorktreeStore = {
  register: (input: RegisterWorktreeInput) => IssueWorktree
  get: (id: string) => IssueWorktree | null
  listByIssue: (issueId: string) => IssueWorktree[]
  listByMember: (memberId: string) => IssueWorktree[]
  getByIssueAndMember: (issueId: string, memberId: string) => IssueWorktree | null
  update: (input: UpdateWorktreeInput) => IssueWorktree
}

let storeInstance: IssueWorktreeStore | null = null

export function getIssueWorktreeStore(): IssueWorktreeStore {
  if (!storeInstance) {
    storeInstance = createIssueWorktreeStore()
  }
  return storeInstance
}

export function __resetIssueWorktreeStoreForTests(): void {
  storeInstance = null
}

function createIssueWorktreeStore(): IssueWorktreeStore {
  const db = getCollaborationDb()
  const issueStore = getIssueStore()
  const teamStore = getTeamStore()

  const stmts = {
    insert: db.prepare(`
      INSERT INTO issue_worktrees (id, issue_id, member_id, worktree_id, terminal_id, active_ref_name, host_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare('SELECT * FROM issue_worktrees WHERE id = ?'),
    selectByIssue: db.prepare(
      'SELECT * FROM issue_worktrees WHERE issue_id = ? ORDER BY created_at ASC'
    ),
    selectByMember: db.prepare(
      'SELECT * FROM issue_worktrees WHERE member_id = ? ORDER BY created_at ASC'
    ),
    selectByIssueAndMember: db.prepare(
      'SELECT * FROM issue_worktrees WHERE issue_id = ? AND member_id = ? LIMIT 1'
    ),
    update: db.prepare(`
      UPDATE issue_worktrees
      SET status = ?, terminal_id = ?, active_ref_name = ?, updated_at = ?
      WHERE id = ?
    `)
  }

  return {
    register(input: RegisterWorktreeInput): IssueWorktree {
      // Why: validate issue exists before insert — FK gives raw SQLITE_CONSTRAINT
      const issue = issueStore.get(input.issueId)
      if (!issue) {
        throw new Error(`Issue not found: ${input.issueId}`)
      }

      // Why: validate member exists
      const member = teamStore.get(input.memberId)
      if (!member) {
        throw new Error(`Team member not found: ${input.memberId}`)
      }

      // Why: explicit pre-check for unique constraint — gives clearer error than SQLITE_CONSTRAINT
      const existing = stmts.selectByIssueAndMember.get(input.issueId, input.memberId) as
        | IssueWorktreeRow
        | undefined
      if (existing) {
        throw new Error(
          `Worktree already exists for member ${input.memberId} on issue ${input.issueId}`
        )
      }

      const now = new Date().toISOString()
      const id = newId()
      stmts.insert.run(
        id,
        input.issueId,
        input.memberId,
        input.worktreeId,
        input.terminalId ?? null,
        input.activeRefName ?? null,
        input.hostId,
        input.status ?? 'active',
        now,
        now
      )
      return rowToWorktree(stmts.selectById.get(id) as IssueWorktreeRow)
    },

    get(id: string): IssueWorktree | null {
      const row = stmts.selectById.get(id) as IssueWorktreeRow | undefined
      return row ? rowToWorktree(row) : null
    },

    listByIssue(issueId: string): IssueWorktree[] {
      const rows = stmts.selectByIssue.all(issueId) as IssueWorktreeRow[]
      return rows.map(rowToWorktree)
    },

    listByMember(memberId: string): IssueWorktree[] {
      const rows = stmts.selectByMember.all(memberId) as IssueWorktreeRow[]
      return rows.map(rowToWorktree)
    },

    getByIssueAndMember(issueId: string, memberId: string): IssueWorktree | null {
      const row = stmts.selectByIssueAndMember.get(issueId, memberId) as
        | IssueWorktreeRow
        | undefined
      return row ? rowToWorktree(row) : null
    },

    update(input: UpdateWorktreeInput): IssueWorktree {
      const existing = stmts.selectById.get(input.id) as IssueWorktreeRow | undefined
      if (!existing) {
        throw new Error(`Worktree not found: ${input.id}`)
      }

      const now = new Date().toISOString()
      stmts.update.run(
        input.status ?? existing.status,
        input.terminalId ?? existing.terminal_id,
        input.activeRefName ?? existing.active_ref_name,
        now,
        input.id
      )
      return rowToWorktree(stmts.selectById.get(input.id) as IssueWorktreeRow)
    }
  }
}
