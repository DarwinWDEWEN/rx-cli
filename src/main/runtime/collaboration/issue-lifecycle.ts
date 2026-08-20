import { getIssueStore } from './issue-store'
import { getIssueGitRefStore } from './issue-git-ref-store'
import { getActivityLogStore } from './activity-log-store'
import { getProjectStore } from './project-store'
import type { Issue } from '../../../shared/team-types'

// Why: D1 lifecycle engine — orchestrates workline init, owner ref registration,
// and activity-log event recording. No real git/terminal/worktree calls (D2/D4 scope).
// All deps injectable for test isolation.

type Actor = {
  id: string
  name: string
  type?: string
}

export type InitIssueLineResult = {
  issue: Issue
  ownerRef: ReturnType<ReturnType<typeof getIssueGitRefStore>['ensureOwnerRef']>
}

export type IssueLifecycle = {
  initIssueLine: (issueId: string, opts?: { actor?: Actor }) => InitIssueLineResult
  recordLifecycleEvent: (
    issue: Issue,
    action: string,
    opts?: { actor?: Actor; metadata?: Record<string, unknown> }
  ) => void
  assertMemberInProject: (issueId: string, memberId: string) => void
}

export type CreateIssueLifecycleDeps = {
  issueStore?: ReturnType<typeof getIssueStore>
  gitRefStore?: ReturnType<typeof getIssueGitRefStore>
  activityLogStore?: ReturnType<typeof getActivityLogStore>
  projectStore?: ReturnType<typeof getProjectStore>
}

// Why: workline states that indicate the issue has already progressed past intake.
// Idempotent init should not reset these.
const ACTIVE_WORKLINE_STATES = ['planning', 'in_progress', 'review', 'blocked']

export function createIssueLifecycle(deps: CreateIssueLifecycleDeps = {}): IssueLifecycle {
  const issueStore = deps.issueStore ?? getIssueStore()
  const gitRefStore = deps.gitRefStore ?? getIssueGitRefStore()
  const activityLogStore = deps.activityLogStore ?? getActivityLogStore()
  const projectStore = deps.projectStore ?? getProjectStore()

  return {
    initIssueLine(issueId: string, opts?: { actor?: Actor }): InitIssueLineResult {
      // Why: validate issue exists
      const issue = issueStore.get(issueId)
      if (!issue) {
        throw new Error(`Issue not found: ${issueId}`)
      }

      // Why: idempotent — only advance if still in intake/unknown state
      let updatedIssue = issue
      if (!ACTIVE_WORKLINE_STATES.includes(issue.worklineState)) {
        updatedIssue = issueStore.update({ id: issueId, worklineState: 'planning' })
      }

      // Why: register owner ref (B7 ensureOwnerRef is idempotent)
      const ownerRef = gitRefStore.ensureOwnerRef(issueId, issue.ownerId)

      // Why: record lifecycle event in activity log
      const actor = opts?.actor ?? {
        id: issue.ownerId,
        name: issue.ownerId, // Why: name not on Issue type; ID is fallback
        type: 'user'
      }
      activityLogStore.log({
        projectId: issue.projectId,
        actorType: actor.type ?? 'user',
        actorId: actor.id,
        actorName: actor.name,
        action: 'issue.line.initialized',
        targetType: 'issue',
        targetId: issueId,
        metadata: {
          worklineKey: issue.worklineKey,
          worklineState: updatedIssue.worklineState
        }
      })

      return { issue: updatedIssue, ownerRef }
    },

    recordLifecycleEvent(
      issue: Issue,
      action: string,
      opts?: { actor?: Actor; metadata?: Record<string, unknown> }
    ): void {
      const actor = opts?.actor ?? {
        id: issue.ownerId,
        name: issue.ownerId,
        type: 'user'
      }
      activityLogStore.log({
        projectId: issue.projectId,
        actorType: actor.type ?? 'user',
        actorId: actor.id,
        actorName: actor.name,
        action,
        targetType: 'issue',
        targetId: issue.id,
        metadata: opts?.metadata ?? {}
      })
    },

    // Why: validate member belongs to issue's project team — reusable by D2/D3
    assertMemberInProject(issueId: string, memberId: string): void {
      const issue = issueStore.get(issueId)
      if (!issue) {
        throw new Error(`Issue not found: ${issueId}`)
      }
      const members = projectStore.listMembers(issue.projectId)
      if (!members.some((m) => m.memberId === memberId)) {
        throw new Error(`Member ${memberId} is not in project ${issue.projectId}`)
      }
    }
  }
}

let lifecycleInstance: IssueLifecycle | null = null

export function getIssueLifecycle(): IssueLifecycle {
  if (!lifecycleInstance) {
    lifecycleInstance = createIssueLifecycle()
  }
  return lifecycleInstance
}

export function __resetIssueLifecycleForTests(): void {
  lifecycleInstance = null
}
