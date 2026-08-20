import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') }
}))

const { __resetCollaborationDbForTests, __setCollaborationDbPathForTests } =
  await import('./collaboration-database')
const { createTeamStore, __resetTeamStoreForTests } = await import('./team-store')
const { createProjectStore, __resetProjectStoreForTests } = await import('./project-store')
const { __resetActivityLogStoreForTests } = await import('./activity-log-store')

async function setupTestContext() {
  __resetCollaborationDbForTests()
  __setCollaborationDbPathForTests(':memory:')
  __resetTeamStoreForTests()
  __resetProjectStoreForTests()
  __resetActivityLogStoreForTests()

  const teamStore = createTeamStore()
  const projectStore = createProjectStore({ teamStore })

  const member = teamStore.create({
    name: 'Alice',
    role: 'lead',
    personality: '',
    responsibilities: [],
    capabilities: [],
    agentType: 'claude',
    agentModel: 'claude-sonnet',
    agentConfig: {},
    skills: [],
    defaultPrompt: '',
    isActive: true,
    hostType: 'local',
    workspaceAccess: []
  })

  const project = projectStore.register({
    name: 'Test Project',
    hostId: 'local',
    hostType: 'local',
    repoPath: '/tmp/test'
  })

  const { getActivityLogStore: freshGet } = await import('./activity-log-store')
  return { store: freshGet(), member, project, teamStore, projectStore }
}

describe('activity log store', () => {
  let ctx: Awaited<ReturnType<typeof setupTestContext>>

  beforeEach(async () => {
    ctx = await setupTestContext()
  })

  afterEach(() => {
    __resetActivityLogStoreForTests()
    __resetProjectStoreForTests()
    __resetTeamStoreForTests()
    __resetCollaborationDbForTests()
  })

  it('logs an event with all fields', () => {
    const { store, project, member } = ctx
    const entry = store.log({
      projectId: project.id,
      actorType: 'user',
      actorId: member.id,
      actorName: member.name,
      action: 'issue.created',
      targetType: 'issue',
      targetId: 'iss_123',
      metadata: { title: 'New issue' }
    })

    expect(entry.id).toMatch(/^al_/)
    expect(entry.projectId).toBe(project.id)
    expect(entry.actorType).toBe('user')
    expect(entry.actorId).toBe(member.id)
    expect(entry.action).toBe('issue.created')
    expect(entry.targetType).toBe('issue')
    expect(entry.targetId).toBe('iss_123')
    expect(entry.metadata).toEqual({ title: 'New issue' })
    expect(entry.createdAt).toBeTruthy()
  })

  it('auto-generates id and createdAt', () => {
    const { store, member } = ctx
    const entry = store.log({
      actorType: 'agent',
      actorId: member.id,
      actorName: member.name,
      action: 'worktree.started'
    })

    expect(entry.id).toMatch(/^al_/)
    expect(entry.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('lists by project sorted by created_at DESC', async () => {
    const { store, project, member } = ctx

    store.log({
      projectId: project.id,
      actorType: 'user',
      actorId: member.id,
      actorName: member.name,
      action: 'first'
    })
    await new Promise((r) => setTimeout(r, 10))
    store.log({
      projectId: project.id,
      actorType: 'user',
      actorId: member.id,
      actorName: member.name,
      action: 'second'
    })
    await new Promise((r) => setTimeout(r, 10))
    store.log({
      projectId: project.id,
      actorType: 'user',
      actorId: member.id,
      actorName: member.name,
      action: 'third'
    })

    const entries = store.listByProject(project.id)
    expect(entries).toHaveLength(3)
    expect(entries[0].action).toBe('third')
    expect(entries[1].action).toBe('second')
    expect(entries[2].action).toBe('first')
  })

  it('filters by project — returns only matching project events', () => {
    const { store, project, member, projectStore } = ctx
    const otherProject = projectStore.register({
      name: 'Other Project',
      hostId: 'local',
      hostType: 'local',
      repoPath: '/tmp/other'
    })

    store.log({
      projectId: project.id,
      actorType: 'user',
      actorId: member.id,
      actorName: member.name,
      action: 'in-project'
    })
    store.log({
      projectId: otherProject.id,
      actorType: 'user',
      actorId: member.id,
      actorName: member.name,
      action: 'other-project'
    })

    const entries = store.listByProject(project.id)
    expect(entries).toHaveLength(1)
    expect(entries[0].action).toBe('in-project')
  })

  it('returns empty array for project with no events', () => {
    const { store, project } = ctx
    expect(store.listByProject(project.id)).toEqual([])
  })

  it('respects limit option', () => {
    const { store, project, member } = ctx
    for (let i = 0; i < 5; i++) {
      store.log({
        projectId: project.id,
        actorType: 'user',
        actorId: member.id,
        actorName: member.name,
        action: `action-${i}`
      })
    }

    const entries = store.listByProject(project.id, { limit: 3 })
    expect(entries).toHaveLength(3)
  })

  it('metadata serialize/deserialize round-trip preserves nested objects', () => {
    const { store, project, member } = ctx
    const complexMeta = {
      issue: { id: 'iss_1', title: 'Bug fix' },
      tags: ['urgent', 'backend'],
      count: 42,
      nested: { deep: { value: true } }
    }

    const entry = store.log({
      projectId: project.id,
      actorType: 'user',
      actorId: member.id,
      actorName: member.name,
      action: 'complex',
      metadata: complexMeta
    })

    const fetched = store.get(entry.id)
    expect(fetched?.metadata).toEqual(complexMeta)
  })

  it('handles empty metadata — defaults to {}', () => {
    const { store, member } = ctx
    const entry = store.log({
      actorType: 'user',
      actorId: member.id,
      actorName: member.name,
      action: 'no-meta'
    })

    expect(entry.metadata).toEqual({})
  })

  it('returns null for non-existent id', () => {
    const { store } = ctx
    expect(store.get('al_missing')).toBeNull()
  })

  it('snake→camel field mapping is correct', () => {
    const { store, project, member } = ctx
    const entry = store.log({
      projectId: project.id,
      actorType: 'user',
      actorId: member.id,
      actorName: member.name,
      action: 'mapping-test',
      targetType: 'issue',
      targetId: 'iss_x'
    })

    // camelCase fields present
    expect(entry.projectId).toBeTruthy()
    expect(entry.actorType).toBeTruthy()
    expect(entry.actorId).toBeTruthy()
    expect(entry.targetType).toBeTruthy()
    expect(entry.targetId).toBeTruthy()
    expect(entry.createdAt).toBeTruthy()

    // snake_case fields absent
    expect((entry as Record<string, unknown>).project_id).toBeUndefined()
    expect((entry as Record<string, unknown>).actor_type).toBeUndefined()
    expect((entry as Record<string, unknown>).actor_id).toBeUndefined()
    expect((entry as Record<string, unknown>).target_type).toBeUndefined()
    expect((entry as Record<string, unknown>).target_id).toBeUndefined()
    expect((entry as Record<string, unknown>).created_at).toBeUndefined()
  })
})
