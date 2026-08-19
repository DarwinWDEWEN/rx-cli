import { randomBytes } from 'node:crypto'
import { getCollaborationDb } from './collaboration-database'
import type { PullRequest, PullRequestStatus } from '../../../shared/team-types'

// Why: mirror issue-store ID format for consistency
function newPrId(): string {
  return `pr_${randomBytes(8).toString('hex')}`
}

// Why: raw DB row type — snake_case columns from SQLite
type PrRow = {
  id: string
  project_id: string
  issue_id: string | null
  number: number
  title: string
  description: string
  status: string
  source_branch: string
  target_branch: string
  author_id: string
  reviewers: string
  approvals: string
  created_at: string
  updated_at: string
}

// Why: explicit snake→camel mapping mirrors issue-store rowToIssue invariant
function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function rowToPr(row: PrRow): PullRequest {
  return {
    id: row.id,
    projectId: row.project_id,
    issueId: (row.issue_id ?? undefined) as string | undefined,
    number: row.number,
    title: row.title,
    description: row.description,
    status: row.status as PullRequestStatus,
    sourceBranch: row.source_branch,
    targetBranch: row.target_branch,
    authorId: row.author_id,
    reviewers: parseJsonArray(row.reviewers),
    approvals: parseJsonArray(row.approvals),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// Why: PR store mirrors issue-store pattern — single source of truth for PR data
let prStoreInstance: PrStore | null = null

export function getPrStore(): PrStore {
  if (!prStoreInstance) {
    prStoreInstance = new PrStore()
  }
  return prStoreInstance
}

// Why: reset for test isolation
export function __resetPrStoreForTests(): void {
  prStoreInstance = null
}

const VALID_STATUSES: PullRequestStatus[] = ['open', 'merged', 'closed']

export class PrStore {
  listByProject(projectId: string): PullRequest[] {
    const db = getCollaborationDb()
    const rows = db
      .prepare(
        `SELECT id, project_id, issue_id, number, title, description, status,
                source_branch, target_branch, author_id, reviewers, approvals,
                created_at, updated_at
         FROM pull_requests
         WHERE project_id = ?
         ORDER BY created_at ASC, number ASC`
      )
      .all(projectId) as PrRow[]
    return rows.map(rowToPr)
  }

  get(id: string): PullRequest | null {
    const db = getCollaborationDb()
    const row = db
      .prepare(
        `SELECT id, project_id, issue_id, number, title, description, status,
                source_branch, target_branch, author_id, reviewers, approvals,
                created_at, updated_at
         FROM pull_requests
         WHERE id = ?`
      )
      .get(id) as PrRow | undefined
    return row ? rowToPr(row) : null
  }

  // Why: create is test-only — no IPC exposure in C9
  // Fields with defaults are optional in the input
  create(
    input: Pick<PullRequest, 'projectId' | 'title' | 'sourceBranch' | 'targetBranch' | 'authorId'> &
      Partial<
        Pick<PullRequest, 'description' | 'status' | 'reviewers' | 'approvals' | 'issueId'>
      > & {
        number?: number
      }
  ): PullRequest {
    const db = getCollaborationDb()
    const id = newPrId()
    const now = new Date().toISOString()
    const number = input.number ?? this.nextPrNumber(input.projectId)

    db.prepare(
      `INSERT INTO pull_requests
       (id, project_id, issue_id, number, title, description, status,
        source_branch, target_branch, author_id, reviewers, approvals,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.projectId,
      input.issueId ?? null,
      number,
      input.title,
      input.description ?? '',
      input.status ?? 'open',
      input.sourceBranch,
      input.targetBranch,
      input.authorId,
      JSON.stringify(input.reviewers ?? []),
      JSON.stringify(input.approvals ?? []),
      now,
      now
    )

    return {
      id,
      projectId: input.projectId,
      issueId: input.issueId ?? undefined,
      number,
      title: input.title,
      description: input.description ?? '',
      status: input.status ?? 'open',
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      authorId: input.authorId,
      reviewers: input.reviewers ?? [],
      approvals: input.approvals ?? [],
      createdAt: now,
      updatedAt: now
    }
  }

  update(args: {
    id: string
    status?: PullRequestStatus
    title?: string
    description?: string
  }): PullRequest {
    const existing = this.get(args.id)
    if (!existing) {
      throw new Error(`PR not found: ${args.id}`)
    }

    // Why: whitelist updatable fields — status/title/description only
    const next: PullRequest = {
      ...existing,
      status: args.status ?? existing.status,
      title: args.title ?? existing.title,
      description: args.description ?? existing.description,
      updatedAt: new Date().toISOString()
    }

    if (args.status && !VALID_STATUSES.includes(args.status)) {
      throw new Error(`Invalid PR status: ${args.status}`)
    }

    const db = getCollaborationDb()
    db.prepare(
      `UPDATE pull_requests
       SET status = ?, title = ?, description = ?, updated_at = ?
       WHERE id = ?`
    ).run(next.status, next.title, next.description, next.updatedAt, args.id)

    return next
  }

  nextPrNumber(projectId: string): number {
    const db = getCollaborationDb()
    const row = db
      .prepare('SELECT MAX(number) as max_num FROM pull_requests WHERE project_id = ?')
      .get(projectId) as { max_num: number | null }
    return (row.max_num ?? 0) + 1
  }
}
