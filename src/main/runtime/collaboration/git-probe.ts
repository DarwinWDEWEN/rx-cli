import { gitExecFileSync } from '../../git/runner'
import { isGitRepo } from '../../git/repo'

// Why: git probe/init lives in runtime/IPC layer, not store (PROGRESS §5 #4).
// Store only persists git state via markGitInitialized; this module probes the
// actual repo and optionally runs `git init` for the onboarding flow.

/**
 * Probe whether a path is a git repository.
 * Reuses the existing isGitRepo from main/git/repo.ts (authoritative for work trees,
 * linked worktrees, submodules, and bare repos).
 */
export function probeGit(path: string): { isGitRepo: boolean } {
  return { isGitRepo: isGitRepo(path) }
}

/**
 * Initialize a git repository at the given path.
 * If the path is already a git repo, this is a no-op (idempotent).
 * Returns whether the path is a git repo after the operation.
 */
export function initGitRepo(path: string): { initialized: boolean } {
  if (isGitRepo(path)) {
    return { initialized: true }
  }

  // Why: `git init` creates a new repository. Uses gitExecFileSync for synchronous
  // execution suitable for the onboarding flow.
  gitExecFileSync(['init'], { cwd: path })
  return { initialized: true }
}
