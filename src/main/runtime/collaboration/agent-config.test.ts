import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') }
}))

const { __resetCollaborationDbForTests, __setCollaborationDbPathForTests } =
  await import('./collaboration-database')
const { createTeamStore, __resetTeamStoreForTests } = await import('./team-store')
const { createProjectStore, __resetProjectStoreForTests } = await import('./project-store')
const {
  isAgentAvailable,
  resolveAgentModel,
  getEffectivePrompt,
  getAgentRuntimeConfig,
  listAvailableAgents
} = await import('./agent-config')

async function setup() {
  __resetCollaborationDbForTests()
  __setCollaborationDbPathForTests(':memory:')
  __resetTeamStoreForTests()
  __resetProjectStoreForTests()

  const teamStore = createTeamStore()
  createProjectStore({ teamStore })
  return teamStore
}

function makeMember(
  teamStore: Awaited<ReturnType<typeof setup>>,
  overrides: Record<string, unknown> = {}
) {
  return teamStore.create({
    name: 'Agent',
    role: 'dev',
    personality: '',
    responsibilities: [],
    capabilities: [],
    agentType: 'claude',
    agentModel: 'claude-sonnet',
    agentConfig: {},
    skills: [],
    defaultPrompt: 'default prompt',
    isActive: true,
    hostType: 'local',
    workspaceAccess: [],
    ...overrides
  })
}

describe('agent-config semantics', () => {
  let teamStore: Awaited<ReturnType<typeof setup>>

  beforeEach(async () => {
    teamStore = await setup()
  })

  afterEach(() => {
    __resetProjectStoreForTests()
    __resetTeamStoreForTests()
    __resetCollaborationDbForTests()
  })

  describe('isAgentAvailable', () => {
    it('returns true for active member with model', () => {
      const m = makeMember(teamStore)
      expect(isAgentAvailable(m.id)).toBe(true)
    })

    it('returns false for inactive member', () => {
      const m = makeMember(teamStore, { isActive: false })
      expect(isAgentAvailable(m.id)).toBe(false)
    })

    it('returns false when no model configured', () => {
      const m = makeMember(teamStore, { agentModel: '', agentConfig: {} })
      expect(isAgentAvailable(m.id)).toBe(false)
    })

    it('returns true when model in agentConfig even if agentModel empty', () => {
      const m = makeMember(teamStore, { agentModel: '', agentConfig: { model: 'gpt-4' } })
      expect(isAgentAvailable(m.id)).toBe(true)
    })

    it('returns false for non-existent member', () => {
      expect(isAgentAvailable('tm_missing')).toBe(false)
    })
  })

  describe('resolveAgentModel', () => {
    it('returns agentModel when no override', () => {
      const m = makeMember(teamStore, { agentModel: 'claude-opus' })
      expect(resolveAgentModel(m.id)).toBe('claude-opus')
    })

    it('returns agentConfig.model override when present', () => {
      const m = makeMember(teamStore, {
        agentModel: 'claude-sonnet',
        agentConfig: { model: 'gpt-4' }
      })
      expect(resolveAgentModel(m.id)).toBe('gpt-4')
    })

    it('ignores non-string model override', () => {
      const m = makeMember(teamStore, { agentModel: 'claude-opus', agentConfig: { model: 123 } })
      expect(resolveAgentModel(m.id)).toBe('claude-opus')
    })

    it('returns empty string for non-existent member', () => {
      expect(resolveAgentModel('tm_missing')).toBe('')
    })
  })

  describe('getEffectivePrompt', () => {
    it('returns defaultPrompt when no override', () => {
      const m = makeMember(teamStore, { defaultPrompt: 'base prompt' })
      expect(getEffectivePrompt(m.id)).toBe('base prompt')
    })

    it('returns agentConfig.prompt override when present', () => {
      const m = makeMember(teamStore, {
        defaultPrompt: 'base',
        agentConfig: { prompt: 'override prompt' }
      })
      expect(getEffectivePrompt(m.id)).toBe('override prompt')
    })

    it('returns empty string for non-existent member', () => {
      expect(getEffectivePrompt('tm_missing')).toBe('')
    })
  })

  describe('getAgentRuntimeConfig', () => {
    it('returns null when no runtime in agentConfig', () => {
      const m = makeMember(teamStore, { agentConfig: {} })
      expect(getAgentRuntimeConfig(m.id)).toBeNull()
    })

    it('returns runtime config when runtime present', () => {
      const m = makeMember(teamStore, {
        agentConfig: { runtime: 'tmux', model: 'claude-opus', extra_args: ['--flag'] }
      })
      const cfg = getAgentRuntimeConfig(m.id)
      expect(cfg).toEqual({ runtime: 'tmux', model: 'claude-opus', extraArgs: ['--flag'] })
    })

    it('filters non-string extra_args', () => {
      const m = makeMember(teamStore, {
        agentConfig: { runtime: 'tmux', extra_args: ['--ok', 123, null, '--also-ok'] }
      })
      const cfg = getAgentRuntimeConfig(m.id)
      expect(cfg?.extraArgs).toEqual(['--ok', '--also-ok'])
    })

    it('returns null for non-existent member', () => {
      expect(getAgentRuntimeConfig('tm_missing')).toBeNull()
    })
  })

  describe('listAvailableAgents', () => {
    it('returns only active members with model', () => {
      makeMember(teamStore, { name: 'Agent A', agentModel: 'claude-opus' })
      makeMember(teamStore, { name: 'Agent B', agentModel: 'gpt-4' })
      makeMember(teamStore, { name: 'Inactive', isActive: false })
      makeMember(teamStore, { name: 'NoModel', agentModel: '', agentConfig: {} })

      const agents = listAvailableAgents()
      expect(agents).toHaveLength(2)
      expect(agents.map((a) => a.name).sort()).toEqual(['Agent A', 'Agent B'])
    })

    it('includes agents with model in agentConfig', () => {
      makeMember(teamStore, {
        name: 'ConfigModel',
        agentModel: '',
        agentConfig: { model: 'gemini' }
      })
      const agents = listAvailableAgents()
      expect(agents).toHaveLength(1)
      expect(agents[0].name).toBe('ConfigModel')
    })

    it('returns empty when no agents available', () => {
      makeMember(teamStore, { agentModel: '', agentConfig: {} })
      expect(listAvailableAgents()).toEqual([])
    })
  })
})
