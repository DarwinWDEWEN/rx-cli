// @vitest-environment happy-dom

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CreateTeamMemberInput,
  TeamMemberRecord,
  UpdateTeamMemberInput
} from '../../../../shared/team-types'

const mockTeamList = vi.fn<() => Promise<TeamMemberRecord[]>>()
const mockTeamCreate = vi.fn<(input: CreateTeamMemberInput) => Promise<TeamMemberRecord>>()
const mockTeamUpdate = vi.fn<(input: UpdateTeamMemberInput) => Promise<TeamMemberRecord>>()

vi.mock('@/store', () => ({
  useAppStore: () => ({
    closeTeamsPage: vi.fn()
  })
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

function makeMember(overrides: Partial<TeamMemberRecord> = {}): TeamMemberRecord {
  return {
    id: 'member-1',
    name: 'Test Member',
    role: 'Developer',
    personality: '',
    responsibilities: [],
    capabilities: [],
    agentType: 'codex',
    agentModel: 'claude-sonnet-4-20250514',
    agentConfig: {},
    skills: [],
    defaultPrompt: '',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    hostType: 'local',
    workspaceAccess: [],
    totalTasks: 0,
    activeProjects: 0,
    activeWorktrees: 0,
    ...overrides
  }
}

// Why: dynamic import ensures vi.mock is hoisted before component import
async function renderTeamsPage() {
  const { default: TeamsPage } = await import('./TeamsPage')
  return render(<TeamsPage />)
}

describe('TeamsPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api = {
      collaboration: {
        team: {
          list: mockTeamList,
          create: mockTeamCreate,
          update: mockTeamUpdate
        }
      }
    }
    mockTeamList.mockResolvedValue([])
  })

  afterEach(() => {
    // Why: manually clear DOM to prevent test pollution in happy-dom
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders empty state when no members exist', async () => {
    mockTeamList.mockResolvedValue([])
    await renderTeamsPage()

    await waitFor(() => {
      expect(screen.getByText('No team members yet')).not.toBeNull()
    })
    expect(mockTeamList).toHaveBeenCalledTimes(1)
  })

  it('renders member list when members exist', async () => {
    const members = [
      makeMember({ id: 'm1', name: 'Alice', role: 'Developer' }),
      makeMember({ id: 'm2', name: 'Bob', role: 'Reviewer', isActive: false })
    ]
    mockTeamList.mockResolvedValue(members)
    await renderTeamsPage()

    await waitFor(() => {
      expect(screen.getByText('Alice')).not.toBeNull()
    })
    expect(screen.getByText('Bob')).not.toBeNull()
    expect(screen.getByText('Developer')).not.toBeNull()
    expect(screen.getByText('Reviewer')).not.toBeNull()
  })

  it('shows create form when add member button is clicked', async () => {
    mockTeamList.mockResolvedValue([])
    await renderTeamsPage()

    await waitFor(() => {
      expect(screen.getByText('No team members yet')).not.toBeNull()
    })

    const addButton = screen.getAllByRole('button', { name: /Add member/i })[0]
    addButton?.click()

    await waitFor(() => {
      expect(screen.getByText('Create')).not.toBeNull()
    })
  })

  it('calls team:create when form is submitted', async () => {
    mockTeamList.mockResolvedValue([])
    mockTeamCreate.mockResolvedValue(makeMember({ id: 'new-1', name: 'Charlie' }))
    await renderTeamsPage()

    await waitFor(() => {
      expect(screen.getByText('No team members yet')).not.toBeNull()
    })

    // Open create form
    const addButton = screen.getAllByRole('button', { name: /Add member/i })[0]
    addButton?.click()

    // Fill form
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Member name')).not.toBeNull()
    })

    const nameInput = screen.getByPlaceholderText('Member name') as HTMLInputElement
    const roleInput = screen.getByPlaceholderText('e.g. Developer, Reviewer') as HTMLInputElement

    // Use fireEvent for React controlled components
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(nameInput, { target: { value: 'Charlie' } })
    fireEvent.change(roleInput, { target: { value: 'Developer' } })

    // Submit
    const createButton = screen.getByRole('button', { name: 'Create' })
    createButton.click()

    await waitFor(() => {
      expect(mockTeamCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Charlie', role: 'Developer' })
      )
    })
  })

  it('opens edit dialog when edit button is clicked', async () => {
    const member = makeMember({ id: 'm1', name: 'Alice', role: 'Developer' })
    mockTeamList.mockResolvedValue([member])
    await renderTeamsPage()

    await waitFor(() => {
      expect(screen.getByText('Alice')).not.toBeNull()
    })

    // Click edit button (Pencil icon)
    const editButton = screen.getByRole('button', { name: /Edit member/i })
    editButton.click()

    // Dialog should show "Edit member" title and pre-filled name
    await waitFor(() => {
      expect(screen.getByText('Edit member')).not.toBeNull()
    })

    const nameInput = screen.getByPlaceholderText('Member name') as HTMLInputElement
    expect(nameInput.value).toBe('Alice')
  })

  it('calls team:update when editing existing member', async () => {
    const member = makeMember({ id: 'm1', name: 'Alice', role: 'Developer' })
    mockTeamList.mockResolvedValue([member])
    mockTeamUpdate.mockResolvedValue({ ...member, name: 'Alice Updated' })
    await renderTeamsPage()

    await waitFor(() => {
      expect(screen.getByText('Alice')).not.toBeNull()
    })

    // Open edit dialog
    const editButton = screen.getByRole('button', { name: /Edit member/i })
    editButton.click()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Member name')).not.toBeNull()
    })

    // Modify name
    const nameInput = screen.getByPlaceholderText('Member name') as HTMLInputElement
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(nameInput, { target: { value: 'Alice Updated' } })

    // Submit
    const saveButton = screen.getByRole('button', { name: 'Save' })
    saveButton.click()

    await waitFor(() => {
      expect(mockTeamUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'm1', name: 'Alice Updated' })
      )
    })
  })

  it('shows error toast when team:list fails', async () => {
    const { toast } = await import('sonner')
    mockTeamList.mockRejectedValue(new Error('Network error'))
    await renderTeamsPage()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Could not load team members')
    })
  })
})
