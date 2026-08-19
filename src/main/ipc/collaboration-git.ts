import { ipcMain } from 'electron'
import { z } from 'zod'
import { initGitRepo, probeGit } from '../runtime/collaboration/git-probe'

// Why: Zod schemas define the IPC contract for git probe/init operations.

const pathArgsSchema = z.object({
  path: z.string().min(1, 'Path is required')
})

export function registerCollaborationGitHandlers(): void {
  // Why: probe whether a path is a git repository (reuses main/git/repo.ts isGitRepo)
  ipcMain.handle('collaboration:probeGit', (_event, args: unknown) => {
    const { path } = pathArgsSchema.parse(args)
    return probeGit(path)
  })

  // Why: initialize a git repo at the given path (idempotent)
  ipcMain.handle('collaboration:initGitRepo', (_event, args: unknown) => {
    const { path } = pathArgsSchema.parse(args)
    return initGitRepo(path)
  })
}
