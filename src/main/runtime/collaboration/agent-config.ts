import { getTeamStore } from './team-store'
import type { TeamMemberRecord } from '../../../shared/team-types'

// Why: agent availability depends on three signals — active status, model configured,
// and agentConfig containing the `runtime` key (which identifies HOW to launch the agent).
// Single source of truth: DDL defaults (is_active=1, agent_model='') are the floor;
// agentConfig.runtime override is the ceiling. No duplication of DDL defaults here.
export type AgentRuntimeConfig = {
  runtime: string
  model?: string
  extraArgs?: string[]
}

export function isAgentAvailable(memberId: string): boolean {
  const member = getTeamStore().get(memberId)
  if (!member) {
    return false
  }
  if (!member.isActive) {
    return false
  }
  if (!member.agentModel && !member.agentConfig?.model) {
    return false
  }
  return true
}

// Why: resolution priority — agentConfig.model override > agentModel column.
// Returns empty string when no model configured (caller decides fallback).
export function resolveAgentModel(memberId: string): string {
  const member = getTeamStore().get(memberId)
  if (!member) {
    return ''
  }
  const override = member.agentConfig?.model
  if (typeof override === 'string' && override.length > 0) {
    return override
  }
  return member.agentModel
}

// Why: prompt synthesis — agentConfig.prompt override > defaultPrompt.
// This keeps default_prompt as the floor while allowing per-agent customization.
export function getEffectivePrompt(memberId: string): string {
  const member = getTeamStore().get(memberId)
  if (!member) {
    return ''
  }
  const override = member.agentConfig?.prompt
  if (typeof override === 'string' && override.length > 0) {
    return override
  }
  return member.defaultPrompt
}

// Why: typed accessor for runtime config — extracts structured config from
// the loose agentConfig Record without forcing callers to know key names.
export function getAgentRuntimeConfig(memberId: string): AgentRuntimeConfig | null {
  const member = getTeamStore().get(memberId)
  if (!member) {
    return null
  }
  const runtime = member.agentConfig?.runtime
  if (typeof runtime !== 'string' || runtime.length === 0) {
    return null
  }
  return {
    runtime,
    model: typeof member.agentConfig?.model === 'string' ? member.agentConfig.model : undefined,
    extraArgs: Array.isArray(member.agentConfig?.extra_args)
      ? member.agentConfig.extra_args.filter((v): v is string => typeof v === 'string')
      : undefined
  }
}

// Why: list all agent-ready members for assignment (D series will use this).
export function listAvailableAgents(): TeamMemberRecord[] {
  return getTeamStore()
    .list()
    .filter((m) => {
      if (!m.isActive) {
        return false
      }
      return Boolean(m.agentModel) || Boolean(m.agentConfig?.model)
    })
}
