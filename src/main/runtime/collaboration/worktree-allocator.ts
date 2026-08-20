import { getIssueStore } from './issue-store'
import { getIssueGitRefStore } from './issue-git-ref-store'
import { getIssueWorktreeStore } from './issue-worktree-store'
import { getIssueLifecycle } from './issue-lifecycle'
import type { IssueGitRef, IssueWorktree } from '../../../shared/team-types'

// Why: Orca Runtime seam — D2 allocator depends on this interface, not the real
// createManagedWorktree. Production default throws "not wired (D4)"; tests inject fake.
export type CreateWorktreeHandler = (input: {
  issueId: string
  memberId: string
  worktreeName: string
}) => Promise<{ worktreeId: string; hostId: string }>

export type AllocateWorktreeOpts = {
  terminalId?: string
  activeRefName?: string
}

export type AllocateWorktreeResult = {
  worktree: IssueWorktree
  ref: IssueGitRef
}

export type WorktreeAllocator = {
  allocateWorktree: (
    issueId: string,
    memberId: string,
    opts?: AllocateWorktreeOpts
  ) => Promise<AllocateWorktreeResult>
  listForIssue: (issueId: string) => IssueWorktree[]
  listForMember: (memberId: string) => IssueWorktree[]
}

export type CreateWorktreeAllocatorDeps = {
  issueStore?: ReturnType<typeof getIssueStore>
  gitRefStore?: ReturnType<typeof getIssueGitRefStore>
  worktreeStore?: ReturnType<typeof getIssueWorktreeStore>
  lifecycle?: ReturnType<typeof getIssueLifecycle>
  createWorktree?: CreateWorktreeHandler
}

// Why: default seam throws "not wired" — prevents silent fake runs before D4 wires real handler
async function defaultCreateWorktree(): Promise<{ worktreeId: string; hostId: string }> {
  throw new Error('worktree runtime not wired (D4)')
}

export function createWorktreeAllocator(deps: CreateWorktreeAllocatorDeps = {}): WorktreeAllocator {
  const issueStore = deps.issueStore ?? getIssueStore()
  const gitRefStore = deps.gitRefStore ?? getIssueGitRefStore()
  const worktreeStore = deps.worktreeStore ?? getIssueWorktreeStore()
  const lifecycle = deps.lifecycle ?? getIssueLifecycle()
  const createWorktree = deps.createWorktree ?? defaultCreateWorktree

  return {
    async allocateWorktree(
      issueId: string,
      memberId: string,
      opts?: AllocateWorktreeOpts
    ): Promise<AllocateWorktreeResult> {
      // Step 1: validate issue exists
      const issue = issueStore.get(issueId)
      if (!issue) {
        throw new Error(`Issue not found: ${issueId}`)
      }

      // Step 2: validate member belongs to issue's project team
      lifecycle.assertMemberInProject(issueId, memberId)

      // Step 3: idempotent — return existing if already allocated
      const existing = worktreeStore.getByIssueAndMember(issueId, memberId)
      if (existing) {
        const ref = gitRefStore.ensureWorktreeRef(issueId, memberId)
        return { worktree: existing, ref }
      }

      // Step 4: create worktree via seam
      const { worktreeId, hostId } = await createWorktree({
        issueId,
        memberId,
        worktreeName: `wt/${memberId}`
      })

      // Step 5: ensure per-member git ref (B7 corrected to per-member idempotent)
      const ref = gitRefStore.ensureWorktreeRef(issueId, memberId)

      // Step 6: register in issue_worktrees table
      const worktree = worktreeStore.register({
        issueId,
        memberId,
        worktreeId,
        hostId,
        terminalId: opts?.terminalId,
        activeRefName: opts?.activeRefName,
        status: 'active'
      })

      // Step 7: record lifecycle event
      lifecycle.recordLifecycleEvent(issue, 'worktree.allocated', {
        metadata: { memberId, worktreeId, hostId }
      })

      return { worktree, ref }
    },

    listForIssue(issueId: string): IssueWorktree[] {
      return worktreeStore.listByIssue(issueId)
    },

    listForMember(memberId: string): IssueWorktree[] {
      return worktreeStore.listByMember(memberId)
    }
  }
}

let allocatorInstance: WorktreeAllocator | null = null

export function getWorktreeAllocator(): WorktreeAllocator {
  if (!allocatorInstance) {
    allocatorInstance = createWorktreeAllocator()
  }
  return allocatorInstance
}

export function __resetWorktreeAllocatorForTests(): void {
  allocatorInstance = null
}
