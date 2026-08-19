// @vitest-environment happy-dom

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamMemberRecord } from '../../../../shared/team-types'

const mockTeamList = vi.fn<() => Promise<TeamMemberRecord[]>>()
const mockProjectListMembers =
  vi.fn<(args: { projectId: string }) => Promise<{ memberId: string; roleInProject: string }[]>>()
const mockInviteMember =
  vi.fn<(args: { projectId: string; memberId: string; roleInProject?: string }) => Promise<void>>()
const mockRemoveMember = vi.fn<(args: { projectId: string; memberId: string }) => Promise<void>>()
const mockChangeOwner =
  vi.fn<(args: { projectId: string; newOwnerMemberId: string }) => Promise<void>>()

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

function makeMember(overrides: Partial<TeamMemberRecord> = {}): TeamMemberRecord {
  return {
    id: 'member-1',
    name: 'Alice',
    role: 'lead',
    agentType: 'claude',
    agentModel: 'claude-sonnet',
    personality: '',
    responsibilities: [],
    capabilities: [],
    agentConfig: {},
    skills: [],
    defaultPrompt: '',
    isActive: true,
    hostType: 'local',
    workspaceAccess: [],
    totalTasks: 0,
    activeProjects: 0,
    activeWorktrees: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

async function renderProjectTeamPanel(projectId: string) {
  const { ProjectTeamPanel } = await import('./ProjectTeamPanel')
  return render(<ProjectTeamPanel projectId={projectId} />)
}

describe('ProjectTeamPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  function setupApiMocks(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api = {
      collaboration: {
        team: { list: mockTeamList },
        project: {
          listMembers: mockProjectListMembers,
          inviteMember: mockInviteMember,
          removeMember: mockRemoveMember,
          changeOwner: mockChangeOwner
        }
      }
    }
  }

  it('renders empty team state when no members exist', async () => {
    mockTeamList.mockResolvedValue([makeMember()])
    mockProjectListMembers.mockResolvedValue([])
    setupApiMocks()

    await renderProjectTeamPanel('proj-1')

    await waitFor(() => {
      expect(screen.getByText(/No team members in this project/i)).not.toBeNull()
    })
  })

  it('renders member list with owner indicator', async () => {
    const alice = makeMember({ id: 'm1', name: 'Alice' })
    const bob = makeMember({ id: 'm2', name: 'Bob' })
    mockTeamList.mockResolvedValue([alice, bob])
    mockProjectListMembers.mockResolvedValue([
      { memberId: 'm1', roleInProject: 'owner' },
      { memberId: 'm2', roleInProject: 'member' }
    ])
    setupApiMocks()

    await renderProjectTeamPanel('proj-1')

    await waitFor(() => {
      expect(screen.getByText('Alice')).not.toBeNull()
      expect(screen.getByText('Bob')).not.toBeNull()
    })

    // Owner should have Owner label
    expect(screen.getByText('Owner')).not.toBeNull()
    expect(screen.getByText('Member')).not.toBeNull()
  })

  it('opens invite dialog when Invite button is clicked', async () => {
    const alice = makeMember({ id: 'm1', name: 'Alice' })
    const bob = makeMember({ id: 'm2', name: 'Bob' })
    mockTeamList.mockResolvedValue([alice, bob])
    mockProjectListMembers.mockResolvedValue([{ memberId: 'm1', roleInProject: 'owner' }])
    setupApiMocks()

    await renderProjectTeamPanel('proj-1')

    await waitFor(() => {
      expect(screen.getByText('Alice')).not.toBeNull()
    })

    const inviteButton = screen.getByText('Invite')
    inviteButton.click()

    await waitFor(() => {
      expect(screen.getByText('Invite Member')).not.toBeNull()
    })
  })

  it('shows error toast when removeMember fails', async () => {
    const { toast } = await import('sonner')
    const alice = makeMember({ id: 'm1', name: 'Alice' })
    mockTeamList.mockResolvedValue([alice])
    mockProjectListMembers.mockResolvedValue([{ memberId: 'm1', roleInProject: 'owner' }])
    mockRemoveMember.mockRejectedValue(new Error('Cannot remove member'))
    setupApiMocks()

    await renderProjectTeamPanel('proj-1')

    await waitFor(() => {
      expect(screen.getByText('Alice')).not.toBeNull()
    })

    // Find and click remove button (UserMinus icon)
    const removeButtons = screen.getAllByRole('button', { name: /Remove/i })
    removeButtons[0]!.click()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Cannot remove member')
    })
  })

  it('calls changeOwner when clicking crown icon', async () => {
    const alice = makeMember({ id: 'm1', name: 'Alice' })
    const bob = makeMember({ id: 'm2', name: 'Bob' })
    mockTeamList.mockResolvedValue([alice, bob])
    mockProjectListMembers.mockResolvedValue([
      { memberId: 'm1', roleInProject: 'owner' },
      { memberId: 'm2', roleInProject: 'member' }
    ])
    mockChangeOwner.mockResolvedValue(undefined)
    setupApiMocks()

    await renderProjectTeamPanel('proj-1')

    await waitFor(() => {
      expect(screen.getByText('Bob')).not.toBeNull()
    })

    // Find and click make owner button for Bob (Crown icon)
    const makeOwnerButtons = screen.getAllByRole('button', { name: /Make owner/i })
    makeOwnerButtons[0]!.click()

    await waitFor(() => {
      expect(mockChangeOwner).toHaveBeenCalledWith({
        projectId: 'proj-1',
        newOwnerMemberId: 'm2'
      })
    })
  })

  it('disables Invite button when no candidates available', async () => {
    const alice = makeMember({ id: 'm1', name: 'Alice' })
    mockTeamList.mockResolvedValue([alice])
    mockProjectListMembers.mockResolvedValue([{ memberId: 'm1', roleInProject: 'owner' }])
    setupApiMocks()

    await renderProjectTeamPanel('proj-1')

    await waitFor(() => {
      expect(screen.getByText('Alice')).not.toBeNull()
    })

    const inviteButton = screen.getByText('Invite') as HTMLButtonElement
    expect(inviteButton.disabled).toBe(true)
  })
})
