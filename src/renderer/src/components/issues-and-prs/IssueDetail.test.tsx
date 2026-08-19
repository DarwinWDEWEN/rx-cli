// @vitest-environment happy-dom

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '../../../../shared/team-types'

const mockTeamList = vi.fn<() => Promise<{ id: string; name: string }[]>>()
const mockIssueUpdate =
  vi.fn<(args: { id: string; status?: string; priority?: string }) => Promise<Issue>>()

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    projectId: 'proj-1',
    number: 1,
    title: 'Test Issue',
    description: 'Issue description here',
    status: 'open',
    priority: 'medium',
    ownerId: 'member-1',
    worklineKey: '',
    worklineState: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides
  }
}

async function renderIssueDetail(issue: Issue | null, onUpdate = vi.fn()) {
  const { IssueDetail } = await import('./IssueDetail')
  return render(<IssueDetail issue={issue} onUpdate={onUpdate} />)
}

describe('IssueDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api = {
      collaboration: {
        issue: { update: mockIssueUpdate },
        team: { list: mockTeamList }
      }
    }
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders empty prompt when no issue selected', async () => {
    await renderIssueDetail(null)
    expect(screen.getByText(/Select an issue to view details/)).not.toBeNull()
  })

  it('renders issue title and number', async () => {
    mockTeamList.mockResolvedValue([{ id: 'member-1', name: 'Alice' }])
    await renderIssueDetail(makeIssue({ number: 42, title: 'Fix the bug' }))

    expect(screen.getByText('#42')).not.toBeNull()
    expect(screen.getByText('Fix the bug')).not.toBeNull()
  })

  it('renders owner name from team list', async () => {
    mockTeamList.mockResolvedValue([{ id: 'member-1', name: 'Alice' }])
    await renderIssueDetail(makeIssue({ ownerId: 'member-1' }))

    await waitFor(() => {
      expect(screen.getByText('Alice')).not.toBeNull()
    })
  })

  it('renders unassigned when owner not found', async () => {
    mockTeamList.mockResolvedValue([])
    await renderIssueDetail(makeIssue({ ownerId: 'unknown-id' }))

    await waitFor(() => {
      expect(screen.getByText('Unassigned')).not.toBeNull()
    })
  })

  it('renders description text', async () => {
    mockTeamList.mockResolvedValue([])
    await renderIssueDetail(makeIssue({ description: 'A detailed description' }))

    expect(screen.getByText('A detailed description')).not.toBeNull()
  })

  it('renders placeholder when description is empty', async () => {
    mockTeamList.mockResolvedValue([])
    await renderIssueDetail(makeIssue({ description: '' }))

    expect(screen.getByText('No description provided')).not.toBeNull()
  })

  it('renders created and updated dates', async () => {
    mockTeamList.mockResolvedValue([])
    await renderIssueDetail(
      makeIssue({
        createdAt: '2026-03-15T10:00:00.000Z',
        updatedAt: '2026-03-20T14:30:00.000Z'
      })
    )

    expect(screen.getByText(/Created/)).not.toBeNull()
    expect(screen.getByText(/Updated/)).not.toBeNull()
  })

  it('calls update when status toggled', async () => {
    mockTeamList.mockResolvedValue([])
    const issue = makeIssue({ status: 'open' })
    const updatedIssue = { ...issue, status: 'done' as const }
    mockIssueUpdate.mockResolvedValue(updatedIssue)
    const onUpdate = vi.fn()

    await renderIssueDetail(issue, onUpdate)

    const openButton = screen.getByText('Open')
    openButton.click()

    await waitFor(() => {
      expect(mockIssueUpdate).toHaveBeenCalledWith({ id: 'issue-1', status: 'done' })
    })

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(updatedIssue)
    })
  })

  it('shows error toast when update fails', async () => {
    mockTeamList.mockResolvedValue([])
    mockIssueUpdate.mockRejectedValue(new Error('Network error'))
    const { toast } = await import('sonner')

    await renderIssueDetail(makeIssue({ status: 'open' }))

    const openButton = screen.getByText('Open')
    openButton.click()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Could not update issue')
    })
  })

  it('renders priority badge', async () => {
    mockTeamList.mockResolvedValue([])
    await renderIssueDetail(makeIssue({ priority: 'urgent' }))

    // Priority badge uses inline style with design token
    const badge = document.querySelector('[style*="--destructive"]')
    expect(badge).not.toBeNull()
    expect(badge!.textContent).toBe('urgent')
  })

  it('calls update when priority changed', async () => {
    mockTeamList.mockResolvedValue([])
    const issue = makeIssue({ priority: 'medium' })
    const updatedIssue = { ...issue, priority: 'high' as const }
    mockIssueUpdate.mockResolvedValue(updatedIssue)
    const onUpdate = vi.fn()

    await renderIssueDetail(issue, onUpdate)

    // Open the priority select
    const selectTrigger = screen.getByRole('combobox')
    selectTrigger.click()

    // Select 'high' option
    const highOption = await screen.findByText('high')
    highOption.click()

    await waitFor(() => {
      expect(mockIssueUpdate).toHaveBeenCalledWith({ id: 'issue-1', priority: 'high' })
    })

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(updatedIssue)
    })
  })

  it('renders Closed badge for done status', async () => {
    mockTeamList.mockResolvedValue([])
    await renderIssueDetail(makeIssue({ status: 'done' }))

    expect(screen.getByText('Closed')).not.toBeNull()
  })
})
