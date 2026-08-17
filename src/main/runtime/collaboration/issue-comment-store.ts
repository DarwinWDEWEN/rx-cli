import { randomBytes } from 'node:crypto'
import { getCollaborationDb, type CollaborationDatabase } from './collaboration-database'
import type { IssueComment } from '../../../shared/team-types'
import { getIssueStore } from './issue-store'
import { getTeamStore } from './team-store'

type IssueCommentRow = {
  id: string
  issue_id: string
  author_id: string
  author_type: string
  author_name: string
  body: string
  visibility: string
  created_at: string
}

function rowToIssueComment(row: IssueCommentRow): IssueComment {
  return {
    id: row.id,
    issueId: row.issue_id,
    authorId: row.author_id,
    authorType: row.author_type as IssueComment['authorType'],
    authorName: row.author_name,
    body: row.body,
    visibility: row.visibility as IssueComment['visibility'],
    createdAt: row.created_at
  }
}

function newId(): string {
  return `ic_${randomBytes(8).toString('hex')}`
}

export type CreateIssueCommentInput = {
  issueId: string
  authorId: string
  authorType?: 'user' | 'agent'
  authorName: string
  body: string
  visibility?: 'project_team' | 'public'
}

export type IssueCommentStore = {
  create: (input: CreateIssueCommentInput) => IssueComment
  get: (id: string) => IssueComment | undefined
  listByIssue: (issueId: string) => IssueComment[]
}

function prepareStatements(db: CollaborationDatabase) {
  return {
    insert: db.prepare(`
      INSERT INTO issue_comments (
        id, issue_id, author_id, author_type, author_name, body, visibility, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM issue_comments WHERE id = ?`),
    selectByIssue: db.prepare(
      `SELECT * FROM issue_comments WHERE issue_id = ? ORDER BY created_at ASC`
    )
  }
}

export type CreateIssueCommentStoreDeps = {
  issueStore?: ReturnType<typeof getIssueStore>
  teamStore?: ReturnType<typeof getTeamStore>
}

export function createIssueCommentStore(deps: CreateIssueCommentStoreDeps = {}): IssueCommentStore {
  const db = getCollaborationDb()
  const stmts = prepareStatements(db)
  const issueStore = deps.issueStore ?? getIssueStore()
  const teamStore = deps.teamStore ?? getTeamStore()

  return {
    create(input) {
      // Why: validate issue + author exist before insert — FK alone gives a raw
      // SQLITE_CONSTRAINT error that doesn't say which side failed.
      const issue = issueStore.get(input.issueId)
      if (!issue) {
        throw new Error(`Issue not found: ${input.issueId}`)
      }

      // Why: author must be a real team member (global), but NOT necessarily in
      // the project team — per TECH-DESIGN L609, members can comment on issues.
      const author = teamStore.get(input.authorId)
      if (!author) {
        throw new Error(`Author (team member) not found: ${input.authorId}`)
      }

      const now = new Date().toISOString()
      const id = newId()
      stmts.insert.run(
        id,
        input.issueId,
        input.authorId,
        input.authorType ?? 'agent',
        input.authorName,
        input.body,
        input.visibility ?? 'project_team',
        now
      )
      return rowToIssueComment(stmts.selectById.get(id) as IssueCommentRow)
    },

    get(id) {
      const row = stmts.selectById.get(id) as IssueCommentRow | undefined
      return row ? rowToIssueComment(row) : undefined
    },

    listByIssue(issueId) {
      const rows = stmts.selectByIssue.all(issueId) as IssueCommentRow[]
      return rows.map(rowToIssueComment)
    }
  }
}

let storeInstance: IssueCommentStore | null = null

export function getIssueCommentStore(): IssueCommentStore {
  if (!storeInstance) {
    storeInstance = createIssueCommentStore()
  }
  return storeInstance
}

export function __resetIssueCommentStoreForTests(): void {
  storeInstance = null
}
