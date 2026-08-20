import { getTeamStore } from './team-store'
import type { SkillBinding } from '../../../shared/team-types'

// Why: skills column stores JSON array of SkillBinding objects.
// Parse defensively — DB may have legacy/empty/invalid data from early testing.
export function parseSkillBindings(memberId: string): SkillBinding[] {
  const member = getTeamStore().get(memberId)
  if (!member) {
    return []
  }
  const raw = member.skills
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter(isValidSkillBinding)
}

function isValidSkillBinding(value: unknown): value is SkillBinding {
  if (!value || typeof value !== 'object') {
    return false
  }
  const obj = value as Record<string, unknown>
  return typeof obj.skillId === 'string' && typeof obj.skillName === 'string'
}

// Why: check if member has a specific skill by ID (ignores enabled flag — existence is enough).
export function hasSkill(memberId: string, skillId: string): boolean {
  const bindings = parseSkillBindings(memberId)
  return bindings.some((b) => b.skillId === skillId)
}

// Why: list skills filtered by enabled status — callers deciding what to offer.
export function listEnabledSkills(memberId: string): SkillBinding[] {
  return parseSkillBindings(memberId).filter((b) => b.enabled !== false)
}

// Why: skill lookup by ID — returns the full binding (with config) for downstream use.
export function getSkillBinding(memberId: string, skillId: string): SkillBinding | null {
  const bindings = parseSkillBindings(memberId)
  return bindings.find((b) => b.skillId === skillId) ?? null
}

// Why: check if member has at least one enabled skill from a required set.
// Used by worktree assignment logic in D series to validate capability match.
export function hasAnySkill(memberId: string, skillIds: string[]): boolean {
  const enabledIds = new Set(listEnabledSkills(memberId).map((b) => b.skillId))
  return skillIds.some((id) => enabledIds.has(id))
}

// Why: group skills by a config category key — supports skill-based routing.
export function listSkillsByCategory(memberId: string, category: string): SkillBinding[] {
  return listEnabledSkills(memberId).filter((b) => b.config?.category === category)
}
