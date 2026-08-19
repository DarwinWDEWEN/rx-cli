import { describe, expect, it } from 'vitest'
import { deriveProjectHost } from './derive-project-host'

describe('deriveProjectHost', () => {
  it('returns local for null/undefined input', () => {
    expect(deriveProjectHost(null)).toEqual({ hostId: 'local', hostType: 'local' })
    expect(deriveProjectHost(undefined)).toEqual({ hostId: 'local', hostType: 'local' })
  })

  it('returns local for "local" input', () => {
    expect(deriveProjectHost('local')).toEqual({ hostId: 'local', hostType: 'local' })
  })

  it('derives runtime host from "runtime:env-123"', () => {
    expect(deriveProjectHost('runtime:env-123')).toEqual({
      hostId: 'runtime:env-123',
      hostType: 'runtime'
    })
  })

  it('derives ssh host from "ssh:target-456"', () => {
    expect(deriveProjectHost('ssh:target-456')).toEqual({
      hostId: 'ssh:target-456',
      hostType: 'ssh'
    })
  })

  it('returns local for invalid input', () => {
    expect(deriveProjectHost('invalid:format:extra')).toEqual({
      hostId: 'local',
      hostType: 'local'
    })
  })
})
