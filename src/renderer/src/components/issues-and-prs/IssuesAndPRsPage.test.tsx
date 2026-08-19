// @vitest-environment happy-dom

import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Issue, Project, PullRequest } from '../../../../shared/team-types'

const mockProjectList = vi.fn<() => Promise<Project[]>>()
const mockIssueListByProject = vi.fn<(args: { projectId: string }) => Promise<Issue[]>>()
const mockPrListByProject = vi.fn<(args: { projectId: string }) => Promise<PullRequest[]>>()
const mockProjectRegister =
  vi.fn<
    (args: {
      name: string
      hostId: string
      hostType: string
      repoPath: string
      defaultBranch?: string
    }) => Promise<Project>
  >()
const mockMarkGitInitialized =
  vi.fn<(args: { id: string; initialized?: boolean }) => Promise<void>>()
const mockProbeGit = vi.fn<(args: { path: string }) => Promise<{ isGitRepo: boolean }>>()
const mockInitGitRepo = vi.fn<(args: { path: string }) => Promise<{ initialized: boolean }>>()
const mockTeamList = vi.fn<() => Promise<{ id: string; name: string }[]>>()
const mockProjectListMembers =
  vi.fn<(args: { projectId: string }) => Promise<{ memberId: string; roleInProject: string }[]>>()

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    description: 'A test project',
    status: 'active',
    defaultBranch: 'main',
    workspaceId: 'ws-1',
    hostId: 'host-1',
    hostType: 'github',
    repoPath: 'test/repo',
    gitInitialized: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

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

// Why: dynamic import ensures vi.mock is hoisted before component import
async function renderIssuesAndPRsPage() {
  const { default: IssuesAndPRsPage } = await import('./IssuesAndPRsPage')
  return render(<IssuesAndPRsPage />)
}

describe('IssuesAndPRsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrListByProject.mockResolvedValue([])
    mockProjectListMembers.mockResolvedValue([])
    mockTeamList.mockResolvedValue([])
  })

  afterEach(() => {
    // Why: manually clear DOM to prevent test pollution
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  function setupApiMocks(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api = {
      collaboration: {
        project: {
          list: mockProjectList,
          register: mockProjectRegister,
          markGitInitialized: mockMarkGitInitialized,
          listMembers: mockProjectListMembers
        },
        issue: { listByProject: mockIssueListByProject },
        pr: { listByProject: mockPrListByProject },
        team: { list: mockTeamList },
        git: {
          probeGit: mockProbeGit,
          initGitRepo: mockInitGitRepo
        }
      },
      repos: {
        pickFolder: vi.fn<() => Promise<string | null>>()
      }
    }
  }

  it('renders empty project state when no projects exist', async () => {
    mockProjectList.mockResolvedValue([])
    mockIssueListByProject.mockResolvedValue([])
    setupApiMocks()
    await renderIssuesAndPRsPage()

    await waitFor(() => {
      expect(screen.getByText('No projects yet')).not.toBeNull()
    })
    expect(mockProjectList).toHaveBeenCalledTimes(1)
  })

  it('renders project selector when projects exist', async () => {
    const projects = [
      makeProject({ id: 'p1', name: 'Project A' }),
      makeProject({ id: 'p2', name: 'Project B' })
    ]
    mockProjectList.mockResolvedValue(projects)
    mockIssueListByProject.mockResolvedValue([])
    setupApiMocks()
    await renderIssuesAndPRsPage()

    await waitFor(
      () => {
        const select = document.querySelector('select')
        expect(select).not.toBeNull()
        expect(within(select as HTMLElement).getByText('Project A')).not.toBeNull()
      },
      { timeout: 5000 }
    )
  })

  it('loads issues when a project is selected', async () => {
    const projects = [makeProject({ id: 'p1', name: 'Project A' })]
    mockProjectList.mockResolvedValue(projects)
    mockIssueListByProject.mockResolvedValue([
      makeIssue({ id: 'i1', number: 1, title: 'First Issue' }),
      makeIssue({ id: 'i2', number: 2, title: 'Second Issue' })
    ])
    setupApiMocks()
    await renderIssuesAndPRsPage()

    await waitFor(
      () => {
        expect(mockIssueListByProject).toHaveBeenCalledWith({ projectId: 'p1' })
      },
      { timeout: 5000 }
    )

    await waitFor(
      () => {
        expect(screen.getByText(/First Issue/)).not.toBeNull()
      },
      { timeout: 5000 }
    )
  })

  it('shows empty issue state when project has no issues', async () => {
    mockProjectList.mockResolvedValue([makeProject({ id: 'p1', name: 'Project A' })])
    mockIssueListByProject.mockResolvedValue([])
    setupApiMocks()
    await renderIssuesAndPRsPage()

    await waitFor(
      () => {
        expect(screen.getByText('No issues yet')).not.toBeNull()
      },
      { timeout: 5000 }
    )
  })

  it('switches between Issues and PRs tabs', async () => {
    mockProjectList.mockResolvedValue([makeProject({ id: 'p1', name: 'Project A' })])
    mockIssueListByProject.mockResolvedValue([makeIssue({ id: 'i1', title: 'An Issue' })])
    setupApiMocks()
    await renderIssuesAndPRsPage()

    await waitFor(
      () => {
        expect(screen.getByText(/An Issue/)).not.toBeNull()
      },
      { timeout: 5000 }
    )

    // Switch to PRs tab
    const prsTab = screen.getByText('PRs')
    prsTab.click()

    await waitFor(() => {
      expect(screen.getByText(/No pull requests yet/)).not.toBeNull()
    })
  })

  it('shows error toast when project list fails', async () => {
    const { toast } = await import('sonner')
    mockProjectList.mockRejectedValue(new Error('Network error'))
    mockIssueListByProject.mockResolvedValue([])
    setupApiMocks()
    await renderIssuesAndPRsPage()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Could not load projects')
    })
  })

  it('discards stale issue list when switching projects rapidly', async () => {
    // Why: race condition test - when user switches projects quickly, stale responses
    // from the first project should not overwrite the newer project's data
    const projects = [
      makeProject({ id: 'p1', name: 'Project A' }),
      makeProject({ id: 'p2', name: 'Project B' })
    ]

    // Create delays to simulate slow API: p1 responds slowly, p2 responds quickly
    let p1Resolve: (issues: Issue[]) => void = () => {}
    const p1Promise = new Promise<Issue[]>((resolve) => {
      p1Resolve = resolve
    })

    mockProjectList.mockResolvedValue(projects)
    mockIssueListByProject.mockImplementation(async ({ projectId }) => {
      if (projectId === 'p1') {
        return p1Promise
      }
      // p2 responds immediately
      return [makeIssue({ id: 'i-p2', projectId: 'p2', number: 100, title: 'P2 Issue' })]
    })

    setupApiMocks()

    await renderIssuesAndPRsPage()

    // Wait for initial load with p1 selected
    await waitFor(
      () => {
        expect(mockIssueListByProject).toHaveBeenCalledWith({ projectId: 'p1' })
      },
      { timeout: 5000 }
    )

    // Wait for select element to be present
    await waitFor(() => {
      expect(document.querySelector('select')).not.toBeNull()
    })

    // Switch to p2 while p1 request is still pending
    const select = document.querySelector('select') as HTMLSelectElement
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(select, { target: { value: 'p2' } })

    // Wait for p2 response to be displayed
    await waitFor(
      () => {
        expect(screen.getByText(/P2 Issue/)).not.toBeNull()
      },
      { timeout: 5000 }
    )

    // Now resolve p1 with stale data (simulating slow response arriving late)
    p1Resolve([makeIssue({ id: 'i-p1', projectId: 'p1', number: 999, title: 'Stale P1 Issue' })])

    // Wait a bit to let any potential state updates settle
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Verify stale p1 data did NOT overwrite current p2 data
    expect(screen.getByText(/P2 Issue/)).not.toBeNull()
    expect(screen.queryByText(/Stale P1 Issue/)).toBeNull()
  })

  it('shows detail panel empty state when Detail tab is clicked', async () => {
    mockProjectList.mockResolvedValue([makeProject({ id: 'p1', name: 'Project A' })])
    mockIssueListByProject.mockResolvedValue([makeIssue({ id: 'i1', title: 'An Issue' })])
    mockTeamList.mockResolvedValue([])
    mockProjectListMembers.mockResolvedValue([])
    setupApiMocks()
    await renderIssuesAndPRsPage()

    await waitFor(
      () => {
        expect(screen.getByText(/An Issue/)).not.toBeNull()
      },
      { timeout: 5000 }
    )

    // Click Detail tab to show detail panel (first button in tab switcher)
    const tabButton = screen
      .getAllByRole('button')
      .find((btn) => btn.classList.contains('rounded-md') && btn.querySelector('svg'))
    tabButton!.click()

    await waitFor(() => {
      // Detail panel empty state should be visible
      expect(screen.getByText(/Select an issue to view details/)).not.toBeNull()
    })
  })

  // Why: C6a tests - empty project state with CTA
  it('renders Add project CTA when no projects exist', async () => {
    mockProjectList.mockResolvedValue([])
    setupApiMocks()
    await renderIssuesAndPRsPage()

    await waitFor(() => {
      expect(screen.getByText(/Add project/i)).not.toBeNull()
    })
  })

  it('opens onboarding dialog when Add project is clicked', async () => {
    mockProjectList.mockResolvedValue([])
    setupApiMocks()
    await renderIssuesAndPRsPage()

    await waitFor(() => {
      expect(screen.getByText(/Add project/i)).not.toBeNull()
    })

    const addButton = screen.getByText(/Add project/i)
    addButton.click()

    await waitFor(() => {
      expect(screen.getByText(/Add Project/i)).not.toBeNull()
    })
  })

  // Why: C7 tests - Project Team panel integration
  it('shows Team tab in right panel', async () => {
    const projects = [makeProject({ id: 'p1', name: 'Project A' })]
    mockProjectList.mockResolvedValue(projects)
    mockIssueListByProject.mockResolvedValue([makeIssue({ id: 'i1', title: 'An Issue' })])
    mockTeamList.mockResolvedValue([{ id: 'm1', name: 'Alice' }])
    mockProjectListMembers.mockResolvedValue([{ memberId: 'm1', roleInProject: 'owner' }])
    setupApiMocks()

    await renderIssuesAndPRsPage()

    await waitFor(() => {
      expect(screen.getByText('Team')).not.toBeNull()
    })
  })

  it('switches to Team tab and shows ProjectTeamPanel', async () => {
    const projects = [makeProject({ id: 'p1', name: 'Project A' })]
    mockProjectList.mockResolvedValue(projects)
    mockIssueListByProject.mockResolvedValue([makeIssue({ id: 'i1', title: 'An Issue' })])
    mockTeamList.mockResolvedValue([{ id: 'm1', name: 'Alice' }])
    mockProjectListMembers.mockResolvedValue([{ memberId: 'm1', roleInProject: 'owner' }])
    setupApiMocks()

    await renderIssuesAndPRsPage()

    await waitFor(() => {
      expect(screen.getByText('Team')).not.toBeNull()
    })

    // Click Team tab
    const teamTab = screen.getByText('Team')
    teamTab.click()

    // Wait for ProjectTeamPanel to load and show member
    await waitFor(
      () => {
        expect(screen.getByText('Alice')).not.toBeNull()
      },
      { timeout: 5000 }
    )
  })

  it('shows detail empty state when Detail tab is active', async () => {
    const projects = [makeProject({ id: 'p1', name: 'Project A' })]
    mockProjectList.mockResolvedValue(projects)
    mockIssueListByProject.mockResolvedValue([makeIssue({ id: 'i1', title: 'An Issue' })])
    mockTeamList.mockResolvedValue([])
    mockProjectListMembers.mockResolvedValue([])
    setupApiMocks()

    await renderIssuesAndPRsPage()

    await waitFor(() => {
      expect(screen.getByText('Team')).not.toBeNull()
    })

    // Click Detail tab (now has aria-label="Detail")
    const detailTab = screen.getByRole('button', { name: 'Detail' })
    detailTab.click()

    await waitFor(() => {
      expect(screen.getByText(/Select an issue to view details/)).not.toBeNull()
    })
  })

  it('shows Team panel by default in right panel', async () => {
    const projects = [makeProject({ id: 'p1', name: 'Project A' })]
    mockProjectList.mockResolvedValue(projects)
    mockIssueListByProject.mockResolvedValue([makeIssue({ id: 'i1', title: 'An Issue' })])
    mockTeamList.mockResolvedValue([{ id: 'm1', name: 'Alice' }])
    mockProjectListMembers.mockResolvedValue([{ memberId: 'm1', roleInProject: 'owner' }])
    setupApiMocks()

    await renderIssuesAndPRsPage()

    // Team tab should be shown by default
    await waitFor(
      () => {
        expect(screen.getByText('Alice')).not.toBeNull()
      },
      { timeout: 5000 }
    )
  })

  // Why: C8 fix - selecting an issue auto-switches to detail panel
  it('shows issue detail when issue is selected', async () => {
    const projects = [makeProject({ id: 'p1', name: 'Project A' })]
    mockProjectList.mockResolvedValue(projects)
    mockIssueListByProject.mockResolvedValue([
      makeIssue({ id: 'i1', number: 1, title: 'First Issue', description: 'Issue body' })
    ])
    mockTeamList.mockResolvedValue([{ id: 'm1', name: 'Alice' }])
    mockProjectListMembers.mockResolvedValue([{ memberId: 'm1', roleInProject: 'owner' }])
    setupApiMocks()

    await renderIssuesAndPRsPage()

    // Wait for issue to appear in list
    await waitFor(
      () => {
        expect(screen.getByText(/First Issue/)).not.toBeNull()
      },
      { timeout: 5000 }
    )

    // Click the issue in the list
    const issueButton = screen.getByText(/First Issue/).closest('button')
    issueButton!.click()

    // Detail panel should show the issue info (auto-switched to detail tab)
    await waitFor(() => {
      expect(screen.getByText('Issue body')).not.toBeNull()
    })
  })
})
