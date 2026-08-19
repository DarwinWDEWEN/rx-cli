// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '../../../../shared/team-types'

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
    description: '',
    status: 'open',
    priority: 'medium',
    ownerId: 'member-1',
    worklineKey: '',
    worklineState: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

async function renderIssueList(
  issues: Issue[],
  selectedIssue: Issue | null = null,
  loading = false,
  onSelect = vi.fn()
) {
  const { IssueList } = await import('./IssueList')
  return render(
    <IssueList
      issues={issues}
      selectedIssue={selectedIssue}
      loading={loading}
      onSelect={onSelect}
    />
  )
}

describe('IssueList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders loading state when loading is true', async () => {
    await renderIssueList([], null, true)
    // Loader2 spinner should be visible
    expect(document.querySelector('.animate-spin')).not.toBeNull()
  })

  it('renders empty state when no issues', async () => {
    await renderIssueList([])
    expect(screen.getByText('No issues yet')).not.toBeNull()
  })

  it('renders issue items with number and title', async () => {
    const issues = [
      makeIssue({ id: 'i1', number: 1, title: 'First Issue' }),
      makeIssue({ id: 'i2', number: 2, title: 'Second Issue' })
    ]
    await renderIssueList(issues)

    expect(screen.getByText(/First Issue/)).not.toBeNull()
    expect(screen.getByText(/Second Issue/)).not.toBeNull()
  })

  it('renders priority badge for each issue', async () => {
    await renderIssueList([makeIssue({ priority: 'high' })])

    expect(screen.getByText('high')).not.toBeNull()
  })

  it('renders Open status for open issues', async () => {
    await renderIssueList([makeIssue({ status: 'open' })])

    expect(screen.getByText('Open')).not.toBeNull()
  })

  it('renders Closed status for done issues', async () => {
    await renderIssueList([makeIssue({ status: 'done' })])

    expect(screen.getByText('Closed')).not.toBeNull()
  })

  it('calls onSelect when issue clicked', async () => {
    const issue = makeIssue({ id: 'i1', title: 'Click me' })
    const onSelect = vi.fn()
    await renderIssueList([issue], null, false, onSelect)

    const button = screen.getByText(/Click me/).closest('button')
    button!.click()

    expect(onSelect).toHaveBeenCalledWith(issue)
  })

  it('highlights selected issue', async () => {
    const issues = [
      makeIssue({ id: 'i1', number: 1, title: 'First' }),
      makeIssue({ id: 'i2', number: 2, title: 'Second' })
    ]
    await renderIssueList(issues, issues[0]!)

    const firstButton = screen.getByText(/First/).closest('button')
    expect(firstButton!.className).toContain('border-primary')
  })
})
