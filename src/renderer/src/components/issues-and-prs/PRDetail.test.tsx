// @vitest-environment happy-dom

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PullRequest } from '../../../../shared/team-types'

const mockTeamList = vi.fn<() => Promise<{ id: string; name: string }[]>>()
const mockPrUpdate =
  vi.fn<
    (args: {
      id: string
      status?: string
      title?: string
      description?: string
    }) => Promise<PullRequest>
  >()

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'pr-1',
    projectId: 'proj-1',
    issueId: undefined,
    number: 1,
    title: 'Test PR',
    description: 'PR description here',
    status: 'open',
    sourceBranch: 'feature/test',
    targetBranch: 'main',
    authorId: 'member-1',
    reviewers: [],
    approvals: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides
  }
}

async function renderPRDetail(pr: PullRequest | null, onUpdate = vi.fn()) {
  const { PRDetail } = await import('./PRDetail')
  return render(<PRDetail pr={pr} onUpdate={onUpdate} />)
}

describe('PRDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api = {
      collaboration: {
        pr: { update: mockPrUpdate },
        team: { list: mockTeamList }
      }
    }
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders empty prompt when no PR selected', async () => {
    await renderPRDetail(null)
    expect(screen.getByText(/Select a pull request to view details/)).not.toBeNull()
  })

  it('renders PR title and number', async () => {
    mockTeamList.mockResolvedValue([{ id: 'member-1', name: 'Alice' }])
    await renderPRDetail(makePr({ number: 42, title: 'Fix the bug' }))

    expect(screen.getByText('#42')).not.toBeNull()
    expect(screen.getByText('Fix the bug')).not.toBeNull()
  })

  it('renders author name from team list', async () => {
    mockTeamList.mockResolvedValue([{ id: 'member-1', name: 'Alice' }])
    await renderPRDetail(makePr({ authorId: 'member-1' }))

    await waitFor(() => {
      expect(screen.getByText('Alice')).not.toBeNull()
    })
  })

  it('renders unknown member when author not found', async () => {
    mockTeamList.mockResolvedValue([])
    await renderPRDetail(makePr({ authorId: 'unknown-id' }))

    await waitFor(() => {
      expect(screen.getByText('Unknown member')).not.toBeNull()
    })
  })

  it('renders branch info', async () => {
    mockTeamList.mockResolvedValue([])
    await renderPRDetail(makePr({ sourceBranch: 'feat/x', targetBranch: 'main' }))

    expect(screen.getByText('feat/x')).not.toBeNull()
    expect(screen.getByText('main')).not.toBeNull()
  })

  it('renders created and updated dates', async () => {
    mockTeamList.mockResolvedValue([])
    await renderPRDetail(
      makePr({
        createdAt: '2026-03-15T10:00:00.000Z',
        updatedAt: '2026-03-20T14:30:00.000Z'
      })
    )

    expect(screen.getByText(/Created/)).not.toBeNull()
    expect(screen.getByText(/Updated/)).not.toBeNull()
  })

  it('renders description text', async () => {
    mockTeamList.mockResolvedValue([])
    await renderPRDetail(makePr({ description: 'A detailed description' }))

    expect(screen.getByText('A detailed description')).not.toBeNull()
  })

  it('renders placeholder when description is empty', async () => {
    mockTeamList.mockResolvedValue([])
    await renderPRDetail(makePr({ description: '' }))

    expect(screen.getByText('No description provided')).not.toBeNull()
  })

  it('renders reviewers', async () => {
    mockTeamList.mockResolvedValue([
      { id: 'reviewer-1', name: 'Bob' },
      { id: 'reviewer-2', name: 'Carol' }
    ])
    await renderPRDetail(makePr({ reviewers: ['reviewer-1', 'reviewer-2'] }))

    await waitFor(() => {
      expect(screen.getByText('Bob')).not.toBeNull()
      expect(screen.getByText('Carol')).not.toBeNull()
    })
  })

  it('renders no reviewers message when empty', async () => {
    mockTeamList.mockResolvedValue([])
    await renderPRDetail(makePr({ reviewers: [] }))

    expect(screen.getByText('No reviewers')).not.toBeNull()
  })

  it('renders approvals', async () => {
    mockTeamList.mockResolvedValue([{ id: 'approver-1', name: 'Dave' }])
    await renderPRDetail(makePr({ approvals: ['approver-1'] }))

    await waitFor(() => {
      expect(screen.getByText(/Dave/)).not.toBeNull()
    })
  })

  it('calls update when status changed', async () => {
    mockTeamList.mockResolvedValue([])
    const pr = makePr({ status: 'open' })
    const updatedPr = { ...pr, status: 'merged' as const }
    mockPrUpdate.mockResolvedValue(updatedPr)
    const onUpdate = vi.fn()

    await renderPRDetail(pr, onUpdate)

    // Open the status select
    const selectTrigger = screen.getByRole('combobox')
    selectTrigger.click()

    // Select 'merged' option
    const mergedOption = await screen.findByText('merged')
    mergedOption.click()

    await waitFor(() => {
      expect(mockPrUpdate).toHaveBeenCalledWith({ id: 'pr-1', status: 'merged' })
    })

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(updatedPr)
    })
  })

  it('shows error toast when update fails', async () => {
    mockTeamList.mockResolvedValue([])
    mockPrUpdate.mockRejectedValue(new Error('Network error'))
    const { toast } = await import('sonner')

    await renderPRDetail(makePr({ status: 'open' }))

    const selectTrigger = screen.getByRole('combobox')
    selectTrigger.click()

    const mergedOption = await screen.findByText('merged')
    mergedOption.click()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Could not update pull request')
    })
  })

  it('renders merged badge for merged status', async () => {
    mockTeamList.mockResolvedValue([])
    await renderPRDetail(makePr({ status: 'merged' }))

    const badge = document.querySelector('[style*="--primary"]')
    expect(badge).not.toBeNull()
    expect(badge!.textContent).toBe('merged')
  })
})
