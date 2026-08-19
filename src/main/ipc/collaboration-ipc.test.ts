import { beforeEach, describe, expect, it, vi } from 'vitest'

// Why: instead of mocking electron (which causes module resolution issues in
// vitest), we create a fake ipcMain and directly invoke the registration
// functions. This tests the same code path without Electron dependency.
const fakeIpcMain = {
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle(channel: string, handler: (...args: unknown[]) => unknown) {
    this.handlers.set(channel, handler)
  }
}

// Why: collaboration-database reads app.getPath('userData') on init.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') },
  ipcMain: fakeIpcMain
}))

const dbMod = await import('../runtime/collaboration/collaboration-database')
const { createTeamStore, __resetTeamStoreForTests } =
  await import('../runtime/collaboration/team-store')
const { createProjectStore, __resetProjectStoreForTests } =
  await import('../runtime/collaboration/project-store')
const { createIssueStore, __resetIssueStoreForTests } =
  await import('../runtime/collaboration/issue-store')
const { __resetCollaborationDbForTests, __setCollaborationDbPathForTests } = dbMod

// Import the registration functions and call them directly.
const teamHandlers = await import('./collaboration-teams')
const projectHandlers = await import('./collaboration-projects')
const issueHandlers = await import('./collaboration-issues')

// Register handlers directly — same as register-core-handlers does at startup.
teamHandlers.registerCollaborationTeamHandlers()
projectHandlers.registerCollaborationProjectHandlers()
issueHandlers.registerCollaborationIssueHandlers()

function invoke(channel: string, ...args: unknown[]) {
  const handler = fakeIpcMain.handlers.get(channel)
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`)
  }
  return handler({} as Electron.IpcMainInvokeEvent, ...args)
}

describe('collaboration IPC handlers', () => {
  let teamStore: ReturnType<typeof createTeamStore>
  let projectStore: ReturnType<typeof createProjectStore>
  let issueStore: ReturnType<typeof createIssueStore>

  beforeEach(() => {
    __resetCollaborationDbForTests()
    __setCollaborationDbPathForTests(':memory:')
    __resetTeamStoreForTests()
    __resetProjectStoreForTests()
    __resetIssueStoreForTests()
    // Why: explicit deps ensure cross-store calls see the same instance.
    teamStore = createTeamStore()
    projectStore = createProjectStore({ teamStore })
    issueStore = createIssueStore({ projectStore, teamStore })
  })

  describe('team.*', () => {
    it('team:create creates a member and team:list returns it', () => {
      invoke('team:create', {
        name: 'Alice',
        role: 'lead',
        agentType: 'claude',
        agentModel: 'claude-sonnet'
      })
      const list = invoke('team:list') as unknown[]
      expect(list).toHaveLength(1)
    })

    it('team:create rejects empty name (Zod validation)', () => {
      expect(() =>
        invoke('team:create', {
          name: '',
          role: 'lead',
          agentType: 'claude',
          agentModel: 'claude-sonnet'
        })
      ).toThrow()
    })

    it('team:canDelete reflects no constraints for clean member', () => {
      const member = teamStore.create({
        name: 'Bob',
        role: 'member',
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
        workspaceAccess: []
      })
      const result = invoke('team:canDelete', { id: member.id }) as {
        canDelete: boolean
        reasons?: string[]
      }
      expect(result.canDelete).toBe(true)
    })
  })

  describe('project.*', () => {
    it('project:register creates project and project:list returns it', () => {
      invoke('project:register', {
        name: 'My Project',
        hostId: 'local',
        hostType: 'local',
        repoPath: '/tmp/test-repo'
      })
      const list = invoke('project:list') as unknown[]
      expect(list).toHaveLength(1)
    })

    it('project:register does NOT do local git probing', () => {
      // Why: Store layer must not probe local filesystem. We pass a nonexistent
      // path and expect registration to succeed without errors.
      const project = invoke('project:register', {
        name: 'Remote Project',
        hostId: 'ssh-host',
        hostType: 'ssh',
        repoPath: '/nonexistent/ssh/path'
      }) as { gitInitialized: boolean }
      expect(project.gitInitialized).toBe(false) // default, no probing
    })

    it('project:markGitInitialized persists state without probing', () => {
      const project = invoke('project:register', {
        name: 'Remote Project',
        hostId: 'ssh-host',
        hostType: 'ssh',
        repoPath: '/nonexistent/ssh/path'
      }) as { id: string }
      invoke('project:markGitInitialized', { id: project.id, initialized: true })
      const fetched = invoke('project:get', { id: project.id }) as {
        gitInitialized: boolean
      }
      expect(fetched.gitInitialized).toBe(true)
    })

    it('project:register rejects empty repoPath (Zod validation)', () => {
      expect(() =>
        invoke('project:register', {
          name: 'Bad',
          hostId: 'local',
          hostType: 'local',
          repoPath: ''
        })
      ).toThrow()
    })

    // Why: gitInitialized must NOT be accepted by register — git state can only
    // be written via project:markGitInitialized after UI/runtime probes the repo.
    it('project:register rejects gitInitialized parameter', () => {
      expect(() =>
        invoke('project:register', {
          name: 'No Git Param',
          hostId: 'local',
          hostType: 'local',
          repoPath: '/tmp/test-repo',
          gitInitialized: true
        })
      ).toThrow()
    })

    it('project:register always returns gitInitialized false, then markGitInitialized sets it', () => {
      const project = invoke('project:register', {
        name: 'Fresh Project',
        hostId: 'local',
        hostType: 'local',
        repoPath: '/tmp/test-repo'
      }) as { id: string; gitInitialized: boolean }
      expect(project.gitInitialized).toBe(false)
      // Why: the only path to set gitInitialized = true is markGitInitialized
      invoke('project:markGitInitialized', { id: project.id, initialized: true })
      const fetched = invoke('project:get', { id: project.id }) as {
        gitInitialized: boolean
      }
      expect(fetched.gitInitialized).toBe(true)
    })

    it('project:changeOwner switches owner role correctly', () => {
      const alice = teamStore.create({
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
        workspaceAccess: []
      })
      const bob = teamStore.create({
        name: 'Bob',
        role: 'member',
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
        workspaceAccess: []
      })

      const project = invoke('project:register', {
        name: 'Test Project',
        hostId: 'local',
        hostType: 'local',
        repoPath: '/tmp/test-repo'
      }) as { id: string }

      invoke('project:inviteMember', {
        projectId: project.id,
        memberId: alice.id,
        roleInProject: 'owner'
      })
      invoke('project:inviteMember', {
        projectId: project.id,
        memberId: bob.id,
        roleInProject: 'member'
      })

      invoke('project:changeOwner', { projectId: project.id, newOwnerMemberId: bob.id })

      const members = invoke('project:listMembers', { projectId: project.id }) as {
        memberId: string
        roleInProject: string
      }[]
      const aliceMember = members.find((m) => m.memberId === alice.id)
      const bobMember = members.find((m) => m.memberId === bob.id)
      expect(aliceMember?.roleInProject).toBe('member')
      expect(bobMember?.roleInProject).toBe('owner')
    })

    it('project:changeOwner rejects missing projectId (Zod validation)', () => {
      expect(() =>
        invoke('project:changeOwner', { projectId: '', newOwnerMemberId: 'tm_123' })
      ).toThrow()
    })

    it('project:changeOwner rejects missing newOwnerMemberId (Zod validation)', () => {
      expect(() =>
        invoke('project:changeOwner', { projectId: 'proj_123', newOwnerMemberId: '' })
      ).toThrow()
    })
  })

  describe('issue.*', () => {
    let projectId: string
    let ownerId: string

    beforeEach(() => {
      const owner = teamStore.create({
        name: 'Owner',
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
        workspaceAccess: []
      })
      ownerId = owner.id
      const project = projectStore.register({
        name: 'Test Project',
        hostId: 'local',
        hostType: 'local',
        repoPath: '/tmp/test-repo'
      })
      projectId = project.id
      projectStore.inviteMember(projectId, ownerId)
    })

    it('issue:create creates issue and issue:listByProject returns it', () => {
      invoke('issue:create', {
        projectId,
        title: 'Fix bug',
        ownerId
      })
      const list = invoke('issue:listByProject', { projectId }) as unknown[]
      expect(list).toHaveLength(1)
    })

    it('issue:create rejects owner not in project team', () => {
      const outsider = teamStore.create({
        name: 'Outsider',
        role: 'member',
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
        workspaceAccess: []
      })
      // Why: outsider exists in team_members but NOT in project_team_members
      expect(() =>
        invoke('issue:create', {
          projectId,
          title: 'Should fail',
          ownerId: outsider.id
        })
      ).toThrow(/not a member of project/)
    })

    it('issue:update enforces owner invariant even without ownerId change', () => {
      const issue = issueStore.create({ projectId, title: 'Original', ownerId })
      // Close issue so owner can be removed (removeMember blocks open issues)
      issueStore.update({ id: issue.id, status: 'done' })
      projectStore.removeMember(projectId, ownerId)
      // Why: reopening without changing ownerId should fail
      expect(() => invoke('issue:update', { id: issue.id, status: 'open' })).toThrow(
        /not a member of project/
      )
    })

    it('issue:create rejects empty title (Zod validation)', () => {
      expect(() =>
        invoke('issue:create', {
          projectId,
          title: '',
          ownerId
        })
      ).toThrow()
    })
  })
})
