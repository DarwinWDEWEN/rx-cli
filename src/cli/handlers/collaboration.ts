import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import type { Issue, IssueComment } from '../../../shared/team-types'

// Why: format functions for human-readable output (non-JSON mode)
function formatCommentAdded(comment: IssueComment): string {
  return `Commented on issue ${comment.issueId}: ${comment.id}`
}

function formatIssueUpdated(issue: Issue): string {
  return `Updated issue ${issue.id}: #${issue.number} ${issue.title} [${issue.status}]`
}

function formatIssue(issue: Issue): string {
  return `#${issue.number} ${issue.title} [${issue.status}] (${issue.priority})`
}

function formatIssueList(issues: Issue[]): string {
  if (issues.length === 0) {
    return 'No issues found.'
  }
  return issues.map((issue) => formatIssue(issue)).join('\n')
}

export const COLLABORATION_HANDLERS: Record<string, CommandHandler> = {
  'issue comment': async ({ flags, client, json }) => {
    // Why: issueId is positional, --member and --body are required flags
    const issueId = flags.get('issueId')
    if (typeof issueId !== 'string' || issueId.length === 0) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Missing required <issueId> positional argument'
      )
    }

    const memberId = getRequiredStringFlag(flags, 'member')
    const body = getRequiredStringFlag(flags, 'body')

    const response = await client.call<IssueComment>('collaboration.issueComment', {
      issueId,
      memberId,
      body
    })
    printResult(response, json, formatCommentAdded)
  },

  'issue update': async ({ flags, client, json }) => {
    const issueId = flags.get('issueId')
    if (typeof issueId !== 'string' || issueId.length === 0) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Missing required <issueId> positional argument'
      )
    }

    const memberId = getRequiredStringFlag(flags, 'member')

    // Why: only pass provided flags to the RPC method — undefined means "no change"
    const title = getOptionalStringFlag(flags, 'title')
    const description = getOptionalStringFlag(flags, 'description')
    const priority = getOptionalStringFlag(flags, 'priority') as Issue['priority'] | undefined
    const status = getOptionalStringFlag(flags, 'status') as Issue['status'] | undefined
    const worklineState = getOptionalStringFlag(flags, 'workline-state')

    const response = await client.call<Issue>('collaboration.issueUpdate', {
      issueId,
      memberId,
      title,
      description,
      priority,
      status,
      worklineState
    })
    printResult(response, json, formatIssueUpdated)
  },

  'issue get': async ({ flags, client, json }) => {
    const issueId = flags.get('issueId')
    if (typeof issueId !== 'string' || issueId.length === 0) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Missing required <issueId> positional argument'
      )
    }

    const response = await client.call<Issue>('collaboration.issueGet', { issueId })
    printResult(response, json, formatIssue)
  },

  'issue list': async ({ flags, client, json }) => {
    const projectId = getOptionalStringFlag(flags, 'project')

    const response = await client.call<Issue[]>('collaboration.issueList', { projectId })
    printResult(response, json, formatIssueList)
  }
}
