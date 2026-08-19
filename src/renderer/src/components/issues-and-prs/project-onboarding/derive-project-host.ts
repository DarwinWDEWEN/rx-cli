import { parseExecutionHostId } from '../../../../../shared/execution-host'

// Why: collaboration project.register requires hostId and hostType, but the
// collaboration domain has no host concept of its own. We derive both from
// the active workspace's executionHostId.

export type DerivedProjectHost = {
  hostId: string
  hostType: string
}

/**
 * Derive hostId and hostType from an executionHostId.
 *
 * Rules:
 * - hostId = executionHostId as-is (e.g., 'local', 'runtime:env-123', 'ssh:target-456')
 * - hostType = prefix before ':' (e.g., 'local', 'runtime', 'ssh')
 * - For 'local' (no ':'), hostType = 'local'
 *
 * @param executionHostId - the workspace's executionHostId
 * @returns derived hostId and hostType
 */
export function deriveProjectHost(executionHostId: string | null | undefined): DerivedProjectHost {
  // Why: default to 'local' when no executionHostId is available (folder workspace
  // or no active workspace). This ensures the onboarding flow can always proceed.
  if (!executionHostId || executionHostId === 'local') {
    return { hostId: 'local', hostType: 'local' }
  }

  const parsed = parseExecutionHostId(executionHostId)
  if (!parsed) {
    return { hostId: 'local', hostType: 'local' }
  }

  // Why: hostType is the kind prefix (local/runtime/ssh), hostId is the full id
  return {
    hostId: parsed.id,
    hostType: parsed.kind
  }
}
