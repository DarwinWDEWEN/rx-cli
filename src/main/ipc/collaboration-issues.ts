import { ipcMain } from 'electron'
import { z } from 'zod'
import { getIssueStore } from '../runtime/collaboration/issue-store'

// Why: Zod schemas define the IPC contract for issue operations.

const createIssueSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  ownerId: z.string().min(1)
})

const updateIssueSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.enum(['open', 'done']).optional(),
  worklineState: z.string().optional(),
  ownerId: z.string().min(1).optional()
})

const idArgsSchema = z.object({ id: z.string().min(1) })
const projectIdArgsSchema = z.object({ projectId: z.string().min(1) })

const getByWorklineKeySchema = z.object({
  projectId: z.string().min(1),
  worklineKey: z.string().min(1)
})

export function registerCollaborationIssueHandlers(): void {
  ipcMain.handle('issue:listByProject', (_event, args: unknown) => {
    const { projectId } = projectIdArgsSchema.parse(args)
    return getIssueStore().listByProject(projectId)
  })

  ipcMain.handle('issue:get', (_event, args: unknown) => {
    const { id } = idArgsSchema.parse(args)
    const issue = getIssueStore().get(id)
    if (!issue) {
      throw new Error(`Issue not found: ${id}`)
    }
    return issue
  })

  ipcMain.handle('issue:getByWorklineKey', (_event, args: unknown) => {
    const input = getByWorklineKeySchema.parse(args)
    const issue = getIssueStore().getByWorklineKey(input.projectId, input.worklineKey)
    if (!issue) {
      throw new Error(
        `Issue not found: project=${input.projectId}, worklineKey=${input.worklineKey}`
      )
    }
    return issue
  })

  ipcMain.handle('issue:create', (_event, args: unknown) => {
    const input = createIssueSchema.parse(args)
    return getIssueStore().create(input)
  })

  ipcMain.handle('issue:update', (_event, args: unknown) => {
    const input = updateIssueSchema.parse(args)
    return getIssueStore().update(input)
  })

  ipcMain.handle('issue:nextIssueNumber', (_event, args: unknown) => {
    const { projectId } = projectIdArgsSchema.parse(args)
    return getIssueStore().nextIssueNumber(projectId)
  })
}
