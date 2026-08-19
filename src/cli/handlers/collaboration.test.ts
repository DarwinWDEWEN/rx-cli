import { beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()

vi.mock('../runtime-client', async () => {
  class RuntimeClient {
    readonly isRemote: boolean
    call = callMock
    getCliStatus = vi.fn()
    openOrca = vi.fn()

    constructor(
      _userDataPath?: string,
      _requestTimeoutMs?: number,
      remotePairingCode = process.env.ORCA_PAIRING_CODE ?? null,
      environmentSelector = process.env.ORCA_ENVIRONMENT ?? null
    ) {
      this.isRemote = Boolean(remotePairingCode || environmentSelector)
    }
  }

  // Why: re-export the REAL error classes; format.ts narrows with `instanceof`
  // against ./runtime/types, so a look-alike would collapse every CLI error
  // code into the generic `runtime_error` shape.
  const { RuntimeClientError, RuntimeRpcFailureError } = await import('../runtime/types.js')

  return {
    RuntimeClient,
    RuntimeClientError,
    RuntimeRpcFailureError
  }
})

import { main } from '../index'
import { okFixture, queueFixtures } from '../test-fixtures'

describe('orca issue CLI handlers', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.restoreAllMocks()
    callMock.mockReset()
    process.env = { ...originalEnv }
    delete process.env.ORCA_WORKTREE_ID
    delete process.env.ORCA_TERMINAL_HANDLE
    delete process.env.ORCA_PAIRING_CODE
    delete process.env.ORCA_ENVIRONMENT
    process.exitCode = undefined
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('issue comment: calls collaboration.issueComment with correct params', async () => {
    queueFixtures(
      callMock,
      okFixture('req_1', {
        id: 'ic_abc123',
        issueId: 'iss_abc123',
        authorId: 'tm_def456',
        authorType: 'agent',
        authorName: 'Alice',
        body: 'Implementation is ready for review.',
        visibility: 'project_team',
        createdAt: '2026-08-17T12:00:00.000Z'
      })
    )

    await main(
      [
        'issue',
        'comment',
        'iss_abc123',
        '--member',
        'tm_def456',
        '--body',
        'Implementation is ready for review.'
      ],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenCalledWith('collaboration.issueComment', {
      issueId: 'iss_abc123',
      memberId: 'tm_def456',
      body: 'Implementation is ready for review.'
    })
  })

  it('issue comment: throws when --body is missing', async () => {
    await main(['issue', 'comment', 'iss_abc123', '--member', 'tm_def456'], '/tmp/repo')

    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('issue comment: outputs human-readable text in non-JSON mode', async () => {
    queueFixtures(
      callMock,
      okFixture('req_1', {
        id: 'ic_abc123',
        issueId: 'iss_abc123',
        authorId: 'tm_def456',
        authorName: 'Alice',
        body: 'Test comment',
        createdAt: '2026-08-17T12:00:00.000Z'
      })
    )

    const logSpy = vi.spyOn(console, 'log')

    await main(
      ['issue', 'comment', 'iss_abc123', '--member', 'tm_def456', '--body', 'Test comment'],
      '/tmp/repo'
    )

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Commented on issue iss_abc123: ic_abc123')
    )
  })

  it('issue update: calls collaboration.issueUpdate with provided fields only', async () => {
    queueFixtures(
      callMock,
      okFixture('req_1', {
        id: 'iss_abc123',
        projectId: 'proj_abc123',
        number: 1,
        title: 'Updated title',
        status: 'done',
        priority: 'high'
      })
    )

    await main(
      [
        'issue',
        'update',
        'iss_abc123',
        '--member',
        'tm_def456',
        '--status',
        'done',
        '--title',
        'Updated title'
      ],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenCalledWith('collaboration.issueUpdate', {
      issueId: 'iss_abc123',
      memberId: 'tm_def456',
      title: 'Updated title',
      description: undefined,
      priority: undefined,
      status: 'done',
      worklineState: undefined
    })
  })

  it('issue update: throws when --member is missing', async () => {
    await main(['issue', 'update', 'iss_abc123', '--status', 'done'], '/tmp/repo')

    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('issue get: calls collaboration.issueGet with correct id', async () => {
    queueFixtures(
      callMock,
      okFixture('req_1', {
        id: 'iss_abc123',
        projectId: 'proj_abc123',
        number: 1,
        title: 'Fix bug',
        status: 'open',
        priority: 'medium'
      })
    )

    await main(['issue', 'get', 'iss_abc123'], '/tmp/repo')

    expect(callMock).toHaveBeenCalledWith('collaboration.issueGet', {
      issueId: 'iss_abc123'
    })
  })

  it('issue list: calls collaboration.issueList without projectId', async () => {
    queueFixtures(
      callMock,
      okFixture('req_1', [
        { id: 'iss_1', title: 'First issue' },
        { id: 'iss_2', title: 'Second issue' }
      ])
    )

    await main(['issue', 'list'], '/tmp/repo')

    expect(callMock).toHaveBeenCalledWith('collaboration.issueList', {
      projectId: undefined
    })
  })

  it('issue list: calls collaboration.issueList with projectId', async () => {
    queueFixtures(callMock, okFixture('req_1', [{ id: 'iss_1', title: 'First issue' }]))

    await main(['issue', 'list', '--project', 'proj_abc123'], '/tmp/repo')

    expect(callMock).toHaveBeenCalledWith('collaboration.issueList', {
      projectId: 'proj_abc123'
    })
  })
})
