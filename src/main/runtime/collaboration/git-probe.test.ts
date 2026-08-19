import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Why: mock electron to avoid import errors in test environment
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') }
}))

// Why: mock git/runner to avoid actual git execution in tests
const gitExecFileSyncMock = vi.fn()
vi.mock('../../git/runner', () => ({
  gitExecFileSync: (...args: unknown[]) => gitExecFileSyncMock(...args)
}))

// Why: mock isGitRepo to control test scenarios
const isGitRepoMock = vi.fn()
vi.mock('../../git/repo', () => ({
  isGitRepo: (...args: unknown[]) => isGitRepoMock(...args)
}))

const { initGitRepo, probeGit } = await import('./git-probe')

describe('git-probe', () => {
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = join(
      tmpdir(),
      `git-probe-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    )
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('probeGit', () => {
    it('returns isGitRepo=true when path is a git repo', () => {
      isGitRepoMock.mockReturnValue(true)

      const result = probeGit(tmpDir)

      expect(result).toEqual({ isGitRepo: true })
      expect(isGitRepoMock).toHaveBeenCalledWith(tmpDir)
    })

    it('returns isGitRepo=false when path is not a git repo', () => {
      isGitRepoMock.mockReturnValue(false)

      const result = probeGit(tmpDir)

      expect(result).toEqual({ isGitRepo: false })
      expect(isGitRepoMock).toHaveBeenCalledWith(tmpDir)
    })
  })

  describe('initGitRepo', () => {
    it('does not run git init if path is already a git repo', () => {
      isGitRepoMock.mockReturnValue(true)

      const result = initGitRepo(tmpDir)

      expect(result).toEqual({ initialized: true })
      expect(gitExecFileSyncMock).not.toHaveBeenCalled()
    })

    it('runs git init if path is not a git repo', () => {
      // Why: first call returns false (not a repo), second returns true (after init)
      isGitRepoMock.mockReturnValueOnce(false).mockReturnValueOnce(true)
      gitExecFileSyncMock.mockReturnValue('')

      const result = initGitRepo(tmpDir)

      expect(result).toEqual({ initialized: true })
      expect(gitExecFileSyncMock).toHaveBeenCalledWith(['init'], { cwd: tmpDir })
    })
  })
})
