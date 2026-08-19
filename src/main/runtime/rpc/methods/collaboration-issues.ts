import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalString, requiredString } from '../schemas'
import { getIssueCommentStore } from '../../collaboration/issue-comment-store'
import { getIssueStore } from '../../collaboration/issue-store'
import { getTeamStore } from '../../collaboration/team-store'
import { getProjectStore } from '../../collaboration/project-store'

// Why: IssueStatus/IssuePriority are string literal unions in shared/team-types.ts.
// Zod enum validates at the RPC boundary so malformed values never reach the store.
const IssueStatus = z.enum(['open', 'done'])
const IssuePriority = z.enum(['low', 'medium', 'high', 'urgent'])

const IssueComment = z.object({
  issueId: requiredString('Issue ID is required'),
  memberId: requiredString('Member ID is required'),
  body: requiredString('Comment body is required')
})

const IssueUpdate = z.object({
  issueId: requiredString('Issue ID is required'),
  memberId: requiredString('Member ID is required'),
  title: OptionalString,
  description: OptionalString,
  priority: IssuePriority.optional(),
  status: IssueStatus.optional(),
  worklineState: OptionalString
})

const IssueGet = z.object({
  issueId: requiredString('Issue ID is required')
})

const IssueList = z
  .object({
    projectId: OptionalString
  })
  .optional()

export const COLLABORATION_ISSUES_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'collaboration.issueComment',
    params: IssueComment,
    handler: async (params) => {
      // Why: resolve authorName from memberId — CLI doesn't know member names,
      // only the main process can look them up via teamStore.
      const teamStore = getTeamStore()
      const member = teamStore.get(params.memberId)
      if (!member) {
        throw new Error(`Team member not found: ${params.memberId}`)
      }

      // Why: store validates issue existence + author membership — no double validation
      const commentStore = getIssueCommentStore()
      return commentStore.create({
        issueId: params.issueId,
        authorId: params.memberId,
        authorType: 'agent',
        authorName: member.name,
        body: params.body,
        visibility: 'project_team'
      })
    }
  }),
  defineMethod({
    name: 'collaboration.issueUpdate',
    params: IssueUpdate,
    handler: async (params) => {
      // Why: memberId validates the caller is a real team member before update.
      const teamStore = getTeamStore()
      const member = teamStore.get(params.memberId)
      if (!member) {
        throw new Error(`Team member not found: ${params.memberId}`)
      }

      // Why: verify the caller is a member of the project team before allowing updates.
      // IssueStore.update only validates owner ∈ project team, not the caller.
      const issueStore = getIssueStore()
      const issue = issueStore.get(params.issueId)
      if (!issue) {
        throw new Error(`Issue not found: ${params.issueId}`)
      }

      const projectStore = getProjectStore()
      const projectMembers = projectStore.listMembers(issue.projectId)
      if (!projectMembers.some((m) => m.memberId === params.memberId)) {
        throw new Error(`Member ${params.memberId} is not a member of project ${issue.projectId}`)
      }

      // Why: only pass provided fields to store.update — undefined means "no change"
      return issueStore.update({
        id: params.issueId,
        title: params.title,
        description: params.description,
        priority: params.priority,
        status: params.status,
        worklineState: params.worklineState
      })
    }
  }),
  defineMethod({
    name: 'collaboration.issueGet',
    params: IssueGet,
    handler: async (params) => {
      const issueStore = getIssueStore()
      const issue = issueStore.get(params.issueId)
      if (!issue) {
        throw new Error(`Issue not found: ${params.issueId}`)
      }
      return issue
    }
  }),
  defineMethod({
    name: 'collaboration.issueList',
    params: IssueList,
    handler: async (params) => {
      const issueStore = getIssueStore()
      // Why: if projectId provided, list by project; otherwise return all issues
      // across all projects (used for discovery).
      if (params?.projectId) {
        return issueStore.listByProject(params.projectId)
      }
      // Why: list all issues across all projects — used for CLI discovery.
      // This is acceptable for the minimal version; pagination can be added later.
      const projectStore = getProjectStore()
      const projects = projectStore.list()
      const allIssues = projects.flatMap((p) => issueStore.listByProject(p.id))
      return allIssues
    }
  })
]
