// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PullRequest } from '../../../../shared/team-types'

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
    description: '',
    status: 'open',
    sourceBranch: 'feature/test',
    targetBranch: 'main',
    authorId: 'member-1',
    reviewers: [],
    approvals: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

async function renderPRList(
  prs: PullRequest[],
  selectedPr: PullRequest | null = null,
  loading = false,
  onSelect = vi.fn()
) {
  const { PRList } = await import('./PRList')
  return render(<PRList prs={prs} selectedPr={selectedPr} loading={loading} onSelect={onSelect} />)
}

describe('PRList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders loading state when loading is true', async () => {
    await renderPRList([], null, true)
    expect(document.querySelector('.animate-spin')).not.toBeNull()
  })

  it('renders empty state when no PRs', async () => {
    await renderPRList([])
    expect(screen.getByText('No pull requests yet')).not.toBeNull()
  })

  it('renders PR items with number and title', async () => {
    const prs = [
      makePr({ id: 'pr1', number: 1, title: 'First PR' }),
      makePr({ id: 'pr2', number: 2, title: 'Second PR' })
    ]
    await renderPRList(prs)

    expect(screen.getByText(/First PR/)).not.toBeNull()
    expect(screen.getByText(/Second PR/)).not.toBeNull()
  })

  it('renders branch info for each PR', async () => {
    const pr = makePr({ sourceBranch: 'feat/x', targetBranch: 'main', title: 'Branch Test PR' })
    await renderPRList([pr])

    // Branch info shows source → target
    const button = screen.getByText(/Branch Test PR/).closest('button')
    expect(button).not.toBeNull()
    expect(button!.textContent).toContain('feat/x')
    expect(button!.textContent).toContain('main')
  })

  it('renders Open status for open PRs', async () => {
    await renderPRList([makePr({ status: 'open' })])

    expect(screen.getByText('open')).not.toBeNull()
  })

  it('renders Merged status for merged PRs', async () => {
    await renderPRList([makePr({ status: 'merged' })])

    expect(screen.getByText('merged')).not.toBeNull()
  })

  it('renders Closed status for closed PRs', async () => {
    await renderPRList([makePr({ status: 'closed' })])

    expect(screen.getByText('closed')).not.toBeNull()
  })

  it('calls onSelect when PR clicked', async () => {
    const pr = makePr({ id: 'pr1', title: 'Click me' })
    const onSelect = vi.fn()
    await renderPRList([pr], null, false, onSelect)

    const button = screen.getByText(/Click me/).closest('button')
    button!.click()

    expect(onSelect).toHaveBeenCalledWith(pr)
  })

  it('highlights selected PR', async () => {
    const prs = [
      makePr({ id: 'pr1', number: 1, title: 'First' }),
      makePr({ id: 'pr2', number: 2, title: 'Second' })
    ]
    await renderPRList(prs, prs[0]!)

    const firstButton = screen.getByText(/First/).closest('button')
    expect(firstButton!.className).toContain('border-primary')
  })
})
