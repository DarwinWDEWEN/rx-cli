import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') }
}))

const dbMod = await import('./collaboration-database')
const { createTeamStore, __resetTeamStoreForTests } = await import('./team-store')
const { createProjectStore, __resetProjectStoreForTests } = await import('./project-store')
const { createIssueStore, __resetIssueStoreForTests } = await import('./issue-store')
const { createIssueCommentStore, __resetIssueCommentStoreForTests } =
  await import('./issue-comment-store')
const { __resetCollaborationDbForTests, __setCollaborationDbPathForTests } = dbMod

import type { TeamMemberRecord } from '../../../shared/team-types'
import type { Issue, Project } from '../../../shared/team-types'

describe('IssueCommentStore', () => {
  let teamStore: ReturnType<typeof createTeamStore>
  let projectStore: ReturnType<typeof createProjectStore>
  let issueStore: ReturnType<typeof createIssueStore>
  let store: ReturnType<typeof createIssueCommentStore>

  function makeMember(over: Partial<TeamMemberRecord> = {}): TeamMemberRecord {
    return teamStore.create({
      name: 'Alice',
      role: 'lead',
      agentType: 'claude',
      agentModel: 'claude-sonnet',
      ...over
    })
  }

  function makeProject(): Project {
    return projectStore.register({
      name: 'Test Project',
      hostId: 'local',
      hostType: 'local',
      repoPath: '/tmp/test-repo'
    })
  }

  function makeIssue(projectId: string, ownerId: string): Issue {
    return issueStore.create({
      projectId,
      title: 'Fix bug',
      ownerId
    })
  }

  beforeEach(() => {
    __resetCollaborationDbForTests()
    __setCollaborationDbPathForTests(':memory:')
    __resetTeamStoreForTests()
    __resetProjectStoreForTests()
    __resetIssueStoreForTests()
    __resetIssueCommentStoreForTests()
    teamStore = createTeamStore()
    projectStore = createProjectStore({ teamStore })
    issueStore = createIssueStore({ projectStore, teamStore })
    store = createIssueCommentStore({ issueStore, teamStore })
  })

  afterEach(() => {
    __resetIssueCommentStoreForTests()
    __resetTeamStoreForTests()
    __resetProjectStoreForTests()
    __resetIssueStoreForTests()
    __resetCollaborationDbForTests()
  })

  it('创建评论成功', () => {
    const member = makeMember()
    const project = makeProject()
    projectStore.inviteMember(project.id, member.id)
    const issue = makeIssue(project.id, member.id)

    const comment = store.create({
      issueId: issue.id,
      authorId: member.id,
      authorType: 'agent',
      authorName: member.name,
      body: '任务完成'
    })

    expect(comment.id).toMatch(/^ic_/)
    expect(comment.issueId).toBe(issue.id)
    expect(comment.authorId).toBe(member.id)
    expect(comment.authorType).toBe('agent')
    expect(comment.authorName).toBe('Alice')
    expect(comment.body).toBe('任务完成')
    expect(comment.visibility).toBe('project_team')
  })

  it('Issue 不存在时抛错', () => {
    const member = makeMember()

    expect(() =>
      store.create({
        issueId: 'iss_missing',
        authorId: member.id,
        authorName: member.name,
        body: 'test'
      })
    ).toThrow(/Issue not found/)
  })

  it('author 不存在时抛错', () => {
    const project = makeProject()
    const member = makeMember()
    projectStore.inviteMember(project.id, member.id)
    const issue = makeIssue(project.id, member.id)

    expect(() =>
      store.create({
        issueId: issue.id,
        authorId: 'mem_missing',
        authorName: 'Ghost',
        body: 'test'
      })
    ).toThrow(/Author.*not found/)
  })

  it('列表按时间排序', () => {
    const member = makeMember()
    const project = makeProject()
    projectStore.inviteMember(project.id, member.id)
    const issue = makeIssue(project.id, member.id)

    store.create({
      issueId: issue.id,
      authorId: member.id,
      authorName: member.name,
      body: '第一条'
    })
    store.create({
      issueId: issue.id,
      authorId: member.id,
      authorName: member.name,
      body: '第二条'
    })

    const comments = store.listByIssue(issue.id)
    expect(comments).toHaveLength(2)
    expect(comments[0].body).toBe('第一条')
    expect(comments[1].body).toBe('第二条')
    // Why: 验证按 created_at ASC 排序。
    expect(comments[0].createdAt <= comments[1].createdAt).toBe(true)
  })

  it('非项目团队成员也可以评论（按设计：成员可评论 Issue）', () => {
    const member = makeMember({ name: 'Member' })
    const outsider = makeMember({ name: 'Outsider' })
    const project = makeProject()
    // Why: only member is in the project team; outsider is NOT.
    projectStore.inviteMember(project.id, member.id)
    const issue = makeIssue(project.id, member.id)

    // Why: outsider is a real team member, so they can comment even if not in project team.
    const comment = store.create({
      issueId: issue.id,
      authorId: outsider.id,
      authorName: outsider.name,
      body: '外部成员评论'
    })

    expect(comment.authorId).toBe(outsider.id)
  })

  it('默认 authorType 为 agent', () => {
    const member = makeMember()
    const project = makeProject()
    projectStore.inviteMember(project.id, member.id)
    const issue = makeIssue(project.id, member.id)

    const comment = store.create({
      issueId: issue.id,
      authorId: member.id,
      authorName: member.name,
      body: 'test'
    })

    expect(comment.authorType).toBe('agent')
  })

  it('get 返回指定评论', () => {
    const member = makeMember()
    const project = makeProject()
    projectStore.inviteMember(project.id, member.id)
    const issue = makeIssue(project.id, member.id)

    const created = store.create({
      issueId: issue.id,
      authorId: member.id,
      authorName: member.name,
      body: 'test'
    })

    const fetched = store.get(created.id)
    expect(fetched).toBeDefined()
    expect(fetched?.id).toBe(created.id)
    expect(fetched?.body).toBe('test')
  })
})
