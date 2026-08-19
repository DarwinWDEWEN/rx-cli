import { ipcMain } from 'electron'
import { z } from 'zod'
import { getProjectStore } from '../runtime/collaboration/project-store'

// Why: Zod schemas define the IPC contract for project operations.

const registerProjectSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(''),
    workspaceId: z.string().optional(),
    hostId: z.string().min(1),
    hostType: z.string().min(1),
    repoPath: z.string().min(1),
    defaultBranch: z.string().default('main')
    // Why: gitInitialized is intentionally NOT accepted here. Register is pure
    // metadata persistence; git state must be written via project:markGitInitialized
    // after the UI/runtime layer probes the actual repo.
  })
  .strict() // Why: reject unknown keys (e.g., gitInitialized) instead of silently stripping them.

const updateProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.string().optional(),
  defaultBranch: z.string().optional()
})

const idArgsSchema = z.object({ id: z.string().min(1) })

const markGitInitializedSchema = z.object({
  id: z.string().min(1),
  initialized: z.boolean().default(true)
})

const inviteMemberSchema = z.object({
  projectId: z.string().min(1),
  memberId: z.string().min(1),
  roleInProject: z.enum(['owner', 'member']).default('member')
})

const removeMemberSchema = z.object({
  projectId: z.string().min(1),
  memberId: z.string().min(1)
})

const changeOwnerSchema = z.object({
  projectId: z.string().min(1),
  newOwnerMemberId: z.string().min(1)
})

const projectIdArgsSchema = z.object({ projectId: z.string().min(1) })

export function registerCollaborationProjectHandlers(): void {
  ipcMain.handle('project:list', () => {
    return getProjectStore().list()
  })

  ipcMain.handle('project:get', (_event, args: unknown) => {
    const { id } = idArgsSchema.parse(args)
    const project = getProjectStore().get(id)
    if (!project) {
      throw new Error(`Project not found: ${id}`)
    }
    return project
  })

  ipcMain.handle('project:register', (_event, args: unknown) => {
    const input = registerProjectSchema.parse(args)
    return getProjectStore().register(input)
  })

  ipcMain.handle('project:update', (_event, args: unknown) => {
    const input = updateProjectSchema.parse(args)
    const { id, ...updates } = input
    return getProjectStore().update(id, updates)
  })

  ipcMain.handle('project:listMembers', (_event, args: unknown) => {
    const { projectId } = projectIdArgsSchema.parse(args)
    return getProjectStore().listMembers(projectId)
  })

  ipcMain.handle('project:inviteMember', (_event, args: unknown) => {
    const input = inviteMemberSchema.parse(args)
    return getProjectStore().inviteMember(input.projectId, input.memberId, input.roleInProject)
  })

  ipcMain.handle('project:removeMember', (_event, args: unknown) => {
    const input = removeMemberSchema.parse(args)
    getProjectStore().removeMember(input.projectId, input.memberId)
  })

  ipcMain.handle('project:markGitInitialized', (_event, args: unknown) => {
    const input = markGitInitializedSchema.parse(args)
    getProjectStore().markGitInitialized(input.id, input.initialized)
  })

  ipcMain.handle('project:changeOwner', (_event, args: unknown) => {
    const input = changeOwnerSchema.parse(args)
    getProjectStore().changeOwner(input.projectId, input.newOwnerMemberId)
  })
}
