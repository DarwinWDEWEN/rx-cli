import { useAppStore } from '@/store'
import { findWorktreeById } from '../../../store/slices/worktree-helpers'
import { getRepoExecutionHostId } from '../../../../../shared/execution-host'

// Why: derive the active workspace's path and host info for project onboarding.
// Prefers active worktree → active repo → null (no active workspace).
export function useActiveWorkspaceSource(): {
  path: string | null
  hostId: string | null
  hostType: string | null
} {
  // Why: subscribe to relevant store slices to get the active workspace info
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const repos = useAppStore((s) => s.repos)

  // Why: prefer worktree path (most specific workspace type)
  if (activeWorktreeId) {
    const worktree = findWorktreeById(worktreesByRepo, activeWorktreeId)
    if (worktree?.path) {
      return {
        path: worktree.path,
        hostId: worktree.hostId ?? null,
        hostType: worktree.hostId ? deriveHostType(worktree.hostId) : null
      }
    }
  }

  // Why: fall back to active repo path
  if (activeRepoId) {
    const repo = repos.find((r) => r.id === activeRepoId)
    if (repo?.path) {
      const executionHostId = getRepoExecutionHostId(repo)
      return {
        path: repo.path,
        hostId: executionHostId,
        hostType: deriveHostType(executionHostId)
      }
    }
  }

  // Why: no active workspace found
  return { path: null, hostId: null, hostType: null }
}

// Why: derive hostType from executionHostId (prefix before ':')
function deriveHostType(executionHostId: string | null): string | null {
  if (!executionHostId || executionHostId === 'local') {
    return 'local'
  }
  const colonIndex = executionHostId.indexOf(':')
  return colonIndex > 0 ? executionHostId.slice(0, colonIndex) : executionHostId
}
