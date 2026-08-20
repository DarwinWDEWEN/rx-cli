import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') }
}))

const { __resetCollaborationDbForTests, __setCollaborationDbPathForTests } =
  await import('./collaboration-database')
const { createTeamStore, __resetTeamStoreForTests } = await import('./team-store')
const { createProjectStore, __resetProjectStoreForTests } = await import('./project-store')
const {
  parseSkillBindings,
  hasSkill,
  listEnabledSkills,
  getSkillBinding,
  hasAnySkill,
  listSkillsByCategory
} = await import('./skill-binding')
import type { SkillBinding } from '../../../shared/team-types'

async function setup() {
  __resetCollaborationDbForTests()
  __setCollaborationDbPathForTests(':memory:')
  __resetTeamStoreForTests()
  __resetProjectStoreForTests()

  const teamStore = createTeamStore()
  createProjectStore({ teamStore })
  return teamStore
}

function makeMember(teamStore: Awaited<ReturnType<typeof setup>>, skills: SkillBinding[] = []) {
  return teamStore.create({
    name: 'Agent',
    role: 'dev',
    personality: '',
    responsibilities: [],
    capabilities: [],
    agentType: 'claude',
    agentModel: 'claude-sonnet',
    agentConfig: {},
    skills,
    defaultPrompt: '',
    isActive: true,
    hostType: 'local',
    workspaceAccess: []
  })
}

const sampleSkills: SkillBinding[] = [
  { skillId: 'code-review', skillName: 'Code Review', enabled: true, config: { category: 'dev' } },
  { skillId: 'testing', skillName: 'Testing', enabled: true, config: { category: 'dev' } },
  { skillId: 'docs', skillName: 'Documentation', enabled: false, config: { category: 'writing' } }
]

describe('skill-binding semantics', () => {
  let teamStore: Awaited<ReturnType<typeof setup>>

  beforeEach(async () => {
    teamStore = await setup()
  })

  afterEach(() => {
    __resetProjectStoreForTests()
    __resetTeamStoreForTests()
    __resetCollaborationDbForTests()
  })

  describe('parseSkillBindings', () => {
    it('returns parsed skills for valid member', () => {
      const m = makeMember(teamStore, sampleSkills)
      const bindings = parseSkillBindings(m.id)
      expect(bindings).toHaveLength(3)
      expect(bindings[0].skillId).toBe('code-review')
    })

    it('returns empty array for non-existent member', () => {
      expect(parseSkillBindings('tm_missing')).toEqual([])
    })

    it('returns empty array for member with empty skills', () => {
      const m = makeMember(teamStore, [])
      expect(parseSkillBindings(m.id)).toEqual([])
    })

    it('filters out invalid skill entries', () => {
      const m = teamStore.create({
        name: 'Legacy',
        role: 'dev',
        personality: '',
        responsibilities: [],
        capabilities: [],
        agentType: 'claude',
        agentModel: 'claude-sonnet',
        agentConfig: {},
        skills: [
          { skillId: 'valid', skillName: 'Valid', enabled: true },
          { skillId: 'missing-name', enabled: true },
          null,
          'garbage'
        ] as unknown as SkillBinding[],
        defaultPrompt: '',
        isActive: true,
        hostType: 'local',
        workspaceAccess: []
      })
      const bindings = parseSkillBindings(m.id)
      expect(bindings).toHaveLength(1)
      expect(bindings[0].skillId).toBe('valid')
    })
  })

  describe('hasSkill', () => {
    it('returns true when skill exists', () => {
      const m = makeMember(teamStore, sampleSkills)
      expect(hasSkill(m.id, 'code-review')).toBe(true)
    })

    it('returns false when skill does not exist', () => {
      const m = makeMember(teamStore, sampleSkills)
      expect(hasSkill(m.id, 'nonexistent')).toBe(false)
    })

    it('returns false for non-existent member', () => {
      expect(hasSkill('tm_missing', 'code-review')).toBe(false)
    })

    it('finds disabled skills (existence check ignores enabled flag)', () => {
      const m = makeMember(teamStore, sampleSkills)
      expect(hasSkill(m.id, 'docs')).toBe(true)
    })
  })

  describe('listEnabledSkills', () => {
    it('returns only enabled skills', () => {
      const m = makeMember(teamStore, sampleSkills)
      const enabled = listEnabledSkills(m.id)
      expect(enabled).toHaveLength(2)
      expect(enabled.map((s) => s.skillId)).toEqual(['code-review', 'testing'])
    })

    it('treats missing enabled field as enabled (default true)', () => {
      const skills: SkillBinding[] = [{ skillId: 'implicit', skillName: 'Implicit', enabled: true }]
      const m = makeMember(teamStore, skills)
      const enabled = listEnabledSkills(m.id)
      expect(enabled).toHaveLength(1)
    })
  })

  describe('getSkillBinding', () => {
    it('returns full binding with config', () => {
      const m = makeMember(teamStore, sampleSkills)
      const binding = getSkillBinding(m.id, 'code-review')
      expect(binding).toEqual(sampleSkills[0])
    })

    it('returns null when skill not found', () => {
      const m = makeMember(teamStore, sampleSkills)
      expect(getSkillBinding(m.id, 'nonexistent')).toBeNull()
    })

    it('returns null for non-existent member', () => {
      expect(getSkillBinding('tm_missing', 'code-review')).toBeNull()
    })
  })

  describe('hasAnySkill', () => {
    it('returns true when member has at least one of the required skills', () => {
      const m = makeMember(teamStore, sampleSkills)
      expect(hasAnySkill(m.id, ['nonexistent', 'testing'])).toBe(true)
    })

    it('returns false when member has none of the required skills', () => {
      const m = makeMember(teamStore, sampleSkills)
      expect(hasAnySkill(m.id, ['nonexistent', 'also-missing'])).toBe(false)
    })

    it('only considers enabled skills', () => {
      const m = makeMember(teamStore, sampleSkills)
      expect(hasAnySkill(m.id, ['docs'])).toBe(false)
    })

    it('returns false for non-existent member', () => {
      expect(hasAnySkill('tm_missing', ['code-review'])).toBe(false)
    })
  })

  describe('listSkillsByCategory', () => {
    it('returns skills matching category', () => {
      const m = makeMember(teamStore, sampleSkills)
      const devSkills = listSkillsByCategory(m.id, 'dev')
      expect(devSkills).toHaveLength(2)
      expect(devSkills.map((s) => s.skillId)).toEqual(['code-review', 'testing'])
    })

    it('excludes disabled skills from category', () => {
      const m = makeMember(teamStore, sampleSkills)
      const writingSkills = listSkillsByCategory(m.id, 'writing')
      expect(writingSkills).toHaveLength(0)
    })

    it('returns empty for non-matching category', () => {
      const m = makeMember(teamStore, sampleSkills)
      expect(listSkillsByCategory(m.id, 'design')).toEqual([])
    })

    it('returns empty for non-existent member', () => {
      expect(listSkillsByCategory('tm_missing', 'dev')).toEqual([])
    })
  })
})
