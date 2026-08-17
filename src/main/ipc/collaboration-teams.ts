import { ipcMain } from 'electron'
import { z } from 'zod'
import { getTeamStore } from '../runtime/collaboration/team-store'

// Why: Zod schemas define the IPC contract. Renderer inputs are untrusted;
// validation rejects malformed calls before they reach the Store layer.
// AgentType = WellKnownAgentType | (string & {}), so z.string() is the
// runtime-compatible representation.

const skillBindingSchema = z.object({
  skillId: z.string().min(1),
  skillName: z.string().min(1),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional()
})

const createTeamMemberSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  avatarUrl: z.string().optional(),
  personality: z.string().default(''),
  responsibilities: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
  agentType: z.string().min(1),
  agentModel: z.string().min(1),
  agentConfig: z.record(z.string(), z.unknown()).default({}),
  skills: z.array(skillBindingSchema).default([]),
  defaultPrompt: z.string().default(''),
  isActive: z.boolean().default(true),
  hostType: z.string().default('local'),
  workspaceAccess: z.array(z.string()).default([]),
  customModelPackageDir: z.string().optional(),
  identity: z.string().optional()
})

const updateTeamMemberSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  avatarUrl: z.string().nullable().optional(),
  personality: z.string().optional(),
  responsibilities: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  agentType: z.string().min(1).optional(),
  agentModel: z.string().min(1).optional(),
  agentConfig: z.record(z.string(), z.unknown()).optional(),
  skills: z.array(skillBindingSchema).optional(),
  defaultPrompt: z.string().optional(),
  isActive: z.boolean().optional(),
  hostType: z.string().optional(),
  workspaceAccess: z.array(z.string()).optional(),
  customModelPackageDir: z.string().nullable().optional(),
  identity: z.string().nullable().optional()
})

const idArgsSchema = z.object({ id: z.string().min(1) })

export function registerCollaborationTeamHandlers(): void {
  ipcMain.handle('team:list', () => {
    return getTeamStore().list()
  })

  ipcMain.handle('team:get', (_event, args: unknown) => {
    const { id } = idArgsSchema.parse(args)
    const member = getTeamStore().get(id)
    if (!member) {
      throw new Error(`Team member not found: ${id}`)
    }
    return member
  })

  ipcMain.handle('team:create', (_event, args: unknown) => {
    const input = createTeamMemberSchema.parse(args)
    return getTeamStore().create(input)
  })

  ipcMain.handle('team:update', (_event, args: unknown) => {
    const input = updateTeamMemberSchema.parse(args)
    return getTeamStore().update(input)
  })

  ipcMain.handle('team:canDelete', (_event, args: unknown) => {
    const { id } = idArgsSchema.parse(args)
    return getTeamStore().canDelete(id)
  })

  ipcMain.handle('team:delete', (_event, args: unknown) => {
    const { id } = idArgsSchema.parse(args)
    getTeamStore().delete(id)
  })
}
