import { randomBytes } from 'node:crypto'
import { getCollaborationDb } from './collaboration-database'
import type { IssueGitRef } from '../../../shared/team-types'
import { getIssueStore } from './issue-store'

// Why: ID prefix follows existing convention (team tm_, issue iss_, pr pr_, comment ic_)
function newId(): string {
  return `iref_${randomBytes(8).toString('hex')}`
}

// Why: raw DB row type — snake_case columns from SQLite
type IssueGitRefRow = {
  id: string
  issue_id: string
  ref_name: string
  ref_role: string
  member_id: string | null
  purpose: string
  status: string
  created_at: string
  updated_at: string
}

// Why: explicit snake→camel mapping mirrors issue-comment-store rowToIssueComment invariant
function rowToGitRef(row: IssueGitRefRow): IssueGitRef {
  return {
    id: row.id,
    issueId: row.issue_id,
    refName: row.ref_name,
    refRole: row.ref_role as IssueGitRef['refRole'],
    memberId: row.member_id ?? undefined,
    purpose: row.purpose,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export type CreateIssueGitRefInput = {
  issueId: string
  refName: string
  refRole: IssueGitRef['refRole']
  memberId?: string
  purpose?: string
}

export type IssueGitRefStore = {
  create: (input: CreateIssueGitRefInput) => IssueGitRef
  get: (id: string) => IssueGitRef | null
  listByIssue: (issueId: string) => IssueGitRef[]
  ensureOwnerRef: (issueId: string, memberId: string) => IssueGitRef
  ensureWorktreeRef: (issueId: string, memberId: string) => IssueGitRef
  getPreferred: (issueId: string, refRole?: IssueGitRef['refRole']) => IssueGitRef | null
  getPreferredPrSourceRef: (issueId: string) => IssueGitRef | null
}

let storeInstance: IssueGitRefStore | null = null

export function getIssueGitRefStore(): IssueGitRefStore {
  if (!storeInstance) {
    storeInstance = createIssueGitRefStore()
  }
  return storeInstance
}

export function __resetIssueGitRefStoreForTests(): void {
  storeInstance = null
}

function createIssueGitRefStore(): IssueGitRefStore {
  const db = getCollaborationDb()
  const issueStore = getIssueStore()

  // Why: prepared statements for performance and SQL injection prevention
  const stmts = {
    insert: db.prepare(`
      INSERT INTO issue_git_refs (id, issue_id, ref_name, ref_role, member_id, purpose, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare('SELECT * FROM issue_git_refs WHERE id = ?'),
    selectByIssue: db.prepare(
      'SELECT * FROM issue_git_refs WHERE issue_id = ? ORDER BY created_at ASC'
    ),
    selectByIssueAndRole: db.prepare(
      'SELECT * FROM issue_git_refs WHERE issue_id = ? AND ref_role = ? ORDER BY created_at DESC LIMIT 1'
    ),
    selectByIssueAndRefName: db.prepare(
      'SELECT * FROM issue_git_refs WHERE issue_id = ? AND ref_name = ? LIMIT 1'
    )
  }

  return {
    create(input: CreateIssueGitRefInput): IssueGitRef {
      // Why: validate issue exists before insert — FK alone gives a raw SQLITE_CONSTRAINT error
      const issue = issueStore.get(input.issueId)
      if (!issue) {
        throw new Error(`Issue not found: ${input.issueId}`)
      }

      // Why: check for duplicate ref_name on same issue (unique index exists, but explicit check gives clearer error)
      const existing = stmts.selectByIssueAndRefName.get(input.issueId, input.refName) as
        | IssueGitRefRow
        | undefined
      if (existing) {
        throw new Error(`Git ref "${input.refName}" already exists for issue ${input.issueId}`)
      }

      const now = new Date().toISOString()
      const id = newId()
      stmts.insert.run(
        id,
        input.issueId,
        input.refName,
        input.refRole,
        input.memberId ?? null,
        input.purpose ?? '',
        'active',
        now,
        now
      )
      return rowToGitRef(stmts.selectById.get(id) as IssueGitRefRow)
    },

    get(id: string): IssueGitRef | null {
      const row = stmts.selectById.get(id) as IssueGitRefRow | undefined
      return row ? rowToGitRef(row) : null
    },

    listByIssue(issueId: string): IssueGitRef[] {
      const rows = stmts.selectByIssue.all(issueId) as IssueGitRefRow[]
      return rows.map(rowToGitRef)
    },

    // Why: idempotent ensure — if ref exists, return it; otherwise create
    ensureOwnerRef(issueId: string, memberId: string): IssueGitRef {
      const existing = stmts.selectByIssueAndRole.get(issueId, 'owner') as
        | IssueGitRefRow
        | undefined
      if (existing) {
        return rowToGitRef(existing)
      }
      return this.create({
        issueId,
        refName: `owner/${memberId}`,
        refRole: 'owner',
        memberId,
        purpose: 'owner-worktree'
      })
    },

    // Why: per-member idempotent — query by (issue_id, ref_name) to guarantee
    // each member gets their own ref (refName=worktree/${memberId}), not the first member's
    ensureWorktreeRef(issueId: string, memberId: string): IssueGitRef {
      const refName = `worktree/${memberId}`
      const existing = stmts.selectByIssueAndRefName.get(issueId, refName) as
        | IssueGitRefRow
        | undefined
      if (existing) {
        return rowToGitRef(existing)
      }
      return this.create({
        issueId,
        refName,
        refRole: 'member',
        memberId,
        purpose: 'member-worktree'
      })
    },

    // Why: return the most recent ref for a role (or any role if not specified)
    getPreferred(issueId: string, refRole?: IssueGitRef['refRole']): IssueGitRef | null {
      if (refRole) {
        const row = stmts.selectByIssueAndRole.get(issueId, refRole) as IssueGitRefRow | undefined
        return row ? rowToGitRef(row) : null
      }
      const rows = stmts.selectByIssue.all(issueId) as IssueGitRefRow[]
      return rows.length > 0 ? rowToGitRef(rows[0]!) : null
    },

    // Why: prefer owner ref for PR source branch, fallback to any
    getPreferredPrSourceRef(issueId: string): IssueGitRef | null {
      const ownerRef = stmts.selectByIssueAndRole.get(issueId, 'owner') as
        | IssueGitRefRow
        | undefined
      if (ownerRef) {
        return rowToGitRef(ownerRef)
      }
      const anyRef = stmts.selectByIssue.get(issueId) as IssueGitRefRow | undefined
      return anyRef ? rowToGitRef(anyRef) : null
    }
  }
}
