import { ipcMain } from 'electron'
import { z } from 'zod'
import { getPrStore } from '../runtime/collaboration/pr-store'

// Why: Zod schemas define the IPC contract for PR operations, mirroring issue pattern

const prIdArgsSchema = z.object({ id: z.string().min(1) })
const prProjectIdArgsSchema = z.object({ projectId: z.string().min(1) })

const prUpdateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['open', 'merged', 'closed']).optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional()
})

export function registerCollaborationPrHandlers(): void {
  ipcMain.handle('pr:listByProject', (_event, args: unknown) => {
    const { projectId } = prProjectIdArgsSchema.parse(args)
    return getPrStore().listByProject(projectId)
  })

  ipcMain.handle('pr:get', (_event, args: unknown) => {
    const { id } = prIdArgsSchema.parse(args)
    const pr = getPrStore().get(id)
    if (!pr) {
      throw new Error(`PR not found: ${id}`)
    }
    return pr
  })

  ipcMain.handle('pr:update', (_event, args: unknown) => {
    const input = prUpdateSchema.parse(args)
    return getPrStore().update(input)
  })

  ipcMain.handle('pr:nextPrNumber', (_event, args: unknown) => {
    const { projectId } = prProjectIdArgsSchema.parse(args)
    return getPrStore().nextPrNumber(projectId)
  })
}
