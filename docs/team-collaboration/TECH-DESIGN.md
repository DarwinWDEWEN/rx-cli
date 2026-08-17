# Orca 团队协作功能 - 技术详细设计

> 版本: v3.1 | 日期: 2026-08-14 | 状态: 修订版

---

## 1. 架构总览

### 1.1 设计哲学

```text
现有 Orca 能力 (复用)
  ├── Tasks 面板 → 远程 Git Issue/PR（不改）
  ├── 文件夹 = 项目
  ├── Git Worktree (创建/管理/合并)
  ├── Terminal + PTY
  ├── Agent Registry (Claude/Codex/Kimi/OpenCode/...)
  ├── Agent Hook Server (状态监控)
  └── Orchestration (Agent 间通信)

新增能力 (叠加)
  ├── Teams 面板 (公司团队管理)
  ├── Issues and PRs 面板 (按 Git 项目管理 Issue/PR)
  ├── Git 初始化引导
  ├── 项目团队 (从 Teams 抽调)
  ├── Issue → Worktree 自动分配
  └── Pipeline Harness (标准化 CLI + 规则)
```

### 1.2 UI 布局

Orca 的导航入口位于左侧边栏顶部（Sidebar Nav），新增的 `Issues and PRs` 和 `Teams` 按钮与现有 `Tasks`、`Automations`、`Search` 等按钮并列。

```text
┌──────────────────┐
│  ◯ SetupGuide    │  ← 条件显示
│  📋 Tasks        │  ← 现有（远程 Git Issue/PR）
│  📁 Artifacts    │  ← 条件显示
│  📋 Issues & PRs │  ← 【新增】项目级 Issue/PR
│  ⏰ Automations  │  ← 现有
│  👥 Agents       │  ← 实验性
│  📱 Mobile       │  ← 现有
│  👥 Teams        │  ← 【新增】公司团队
│  🔍 Search       │  ← 现有（底部搜索框）
├──────────────────┤
│  Worktree List   │
│  ...             │
└──────────────────┘
```

实现方式：在现有 `SidebarNav` 组件中新增两个导航按钮，沿用现有样式规范与状态管理。

### 1.3 模块组织

```text
src/
├── main/
│   ├── collaboration/              # 【新增】统一协作域
│   │   ├── collaboration-database.ts
│   │   ├── team-store.ts
│   │   ├── project-store.ts
│   │   ├── issue-store.ts
│   │   ├── pr-store.ts
│   │   ├── project-team-store.ts
│   │   └── ipc.ts
│   │
│   ├── issue-engine/               # 【新增】Issue 驱动引擎
│   │   ├── issue-lifecycle.ts      # Issue → Worktree 分配 → 集成提交
│   │   ├── worktree-allocator.ts   # Worktree / Git 引用分配
│   │   ├── owner-collaboration.ts  # 推荐负责人沟通机制
│   │   └── ipc.ts
│   │
│   ├── pipeline/                   # 【新增】Pipeline Harness
│   │   ├── pipeline-cli.ts
│   │   ├── harness-engine.ts
│   │   ├── execution-context.ts    # 组装 Agent 运行时上下文快照
│   │   ├── agent-runner.ts         # 统一封装不同 Agent CLI / SDK 的执行入口
│   │   ├── stream-event-normalizer.ts # 归一化 Agent 流事件与工具调用结果
│   │   ├── convergence-rules.ts
│   │   └── ipc.ts
│   │
│   └── (现有模块复用)
│       ├── git/worktree.ts
│       ├── runtime/orca-runtime.ts
│       ├── agent-hooks/server.ts
│       └── agent-hooks/managed-agent-hook-registry.ts
│
├── shared/
│   ├── team-types.ts
│   ├── issue-types.ts
│   ├── pr-types.ts
│   └── collaboration-types.ts
│
└── renderer/src/
    ├── components/
    │   ├── issues/
    │   ├── pull-requests/
    │   ├── team/
    │   └── projects/
    │
    └── store/slices/
        ├── issues.ts
        ├── pull-requests.ts
        ├── team.ts
        └── projects.ts
```

---

## 2. 数据存储设计

### 2.1 单库存储

| 数据库 | 位置 | 存储内容 |
|--------|------|---------|
| `collaboration.db` | `~/.orca/collaboration.db` | 公司团队、项目接入、Issue、PR、项目团队、工作树映射、活动日志 |

选择单库的原因：

- 避免跨库外键与跨库 join 的复杂度
- 团队、项目、Issue、Worktree 都是同一协作域数据
- 删除成员、统计活跃 worktree、项目团队查询都需要原子关联查询

### 2.2 基础 Schema

```sql
-- 公司团队成员表
CREATE TABLE team_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  personality TEXT DEFAULT '',
  responsibilities TEXT DEFAULT '[]',
  capabilities TEXT DEFAULT '[]',
  agent_type TEXT NOT NULL,
  agent_model TEXT NOT NULL,
  agent_config TEXT DEFAULT '{}',
  skills TEXT DEFAULT '[]',
  default_prompt TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 项目表
-- Project 与 Orca 的项目概念一致：打开的文件夹即项目
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  workspace_id TEXT,
  host_id TEXT NOT NULL,
  host_type TEXT NOT NULL,          -- 'local' | 'ssh' | 'wsl' | 'remote'
  repo_path TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  git_initialized INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_projects_host_repo ON projects(host_id, repo_path);

-- 项目团队成员表
CREATE TABLE project_team_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  member_id TEXT NOT NULL REFERENCES team_members(id),
  role_in_project TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'member'
  joined_at INTEGER NOT NULL,
  UNIQUE(project_id, member_id)
);
```

### 2.3 协作 Schema

```sql
CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  owner_id TEXT NOT NULL REFERENCES team_members(id),
  workline_key TEXT NOT NULL,       -- 业务工作线标识，例如 issue-12
  workline_state TEXT NOT NULL DEFAULT 'intake',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE issue_comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  author_id TEXT NOT NULL,
  author_type TEXT NOT NULL,        -- 'user' | 'agent'
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'project_team',
  created_at INTEGER NOT NULL
);

CREATE TABLE pull_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  issue_id TEXT REFERENCES issues(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  author_id TEXT NOT NULL,
  reviewers TEXT DEFAULT '[]',
  approvals TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE pr_comments (
  id TEXT PRIMARY KEY,
  pr_id TEXT NOT NULL REFERENCES pull_requests(id),
  author_id TEXT NOT NULL,
  author_type TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  file_path TEXT,
  line_number INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE issue_worktrees (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  member_id TEXT NOT NULL REFERENCES team_members(id),
  worktree_id TEXT NOT NULL,
  terminal_id TEXT,
  active_ref_name TEXT,             -- 当前 worktree checkout 的 Git ref，属于实现细节
  host_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  UNIQUE(issue_id, member_id)
);

CREATE TABLE issue_git_refs (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  ref_name TEXT NOT NULL,
  ref_role TEXT NOT NULL,           -- 'owner' | 'member' | 'release' | 'experiment'
  member_id TEXT REFERENCES team_members(id),
  purpose TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(issue_id, ref_name)
);

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_issues_project ON issues(project_id);
CREATE INDEX idx_issues_owner ON issues(owner_id);
CREATE INDEX idx_issues_workline_key ON issues(workline_key);
CREATE INDEX idx_issue_worktrees_issue ON issue_worktrees(issue_id);
CREATE INDEX idx_issue_worktrees_member ON issue_worktrees(member_id);
CREATE INDEX idx_issue_git_refs_issue ON issue_git_refs(issue_id);
CREATE INDEX idx_prs_project ON pull_requests(project_id);
CREATE INDEX idx_prs_issue ON pull_requests(issue_id);
CREATE INDEX idx_activity_project ON activity_log(project_id);
```

---

## 3. Teams 模块（公司级）

### 3.1 核心模型

```typescript
export interface TeamMember {
  id: string;
  name: string;
  role: string;
  avatarUrl?: string;
  personality: string;
  responsibilities: string[];
  capabilities: string[];
  agentType: AgentType;
  agentModel: string;
  agentConfig: Record<string, unknown>;
  skills: SkillBinding[];
  defaultPrompt: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SkillBinding {
  skillId: string;
  skillName: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}
```

### 3.2 Team Store

```typescript
export class TeamStore {
  private db = getCollaborationDatabase();

  async canDelete(memberId: string): Promise<{ canDelete: boolean; activeWorktrees: number }> {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM issue_worktrees iw
      JOIN issues i ON iw.issue_id = i.id
      WHERE iw.member_id = ? AND iw.status = 'active' AND i.status != 'done'
    `).get(memberId) as { count: number };

    return {
      canDelete: result.count === 0,
      activeWorktrees: result.count,
    };
  }
}
```

约束：

- Team 成员不直接绑定某个固定 worktree
- 删除成员前，必须关闭其全部活跃 worktree
- 一个成员可同时参与多个项目和多个 Issue

---

## 4. Collaboration 模块（项目级）

### 4.1 Project Store

项目不是新造的一层资源，而是将 Orca 已打开的文件夹接入协作域。

```typescript
export class ProjectStore {
  private db = getCollaborationDatabase();

  register(input: RegisterProjectInput): Project {
    const id = crypto.randomUUID();

    this.db.prepare(`
      INSERT INTO projects (
        id, name, description, workspace_id, host_id, host_type,
        repo_path, default_branch, git_initialized, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.description ?? '',
      input.workspaceId ?? null,
      input.hostId,
      input.hostType,
      input.repoPath,
      input.defaultBranch ?? 'main',
      input.gitInitialized ? 1 : 0,
      Date.now(),
      Date.now(),
    );

    return this.getById(id)!;
  }

  async ensureGitInitialized(projectId: string): Promise<void> {
    const project = this.getById(projectId)!;
    if (project.gitInitialized) return;
    await gitRunner.init(project.repoPath, { hostId: project.hostId });
    this.markGitInitialized(projectId);
  }
}
```

### 4.2 Project Team Store

```typescript
export class ProjectTeamStore {
  private db = getCollaborationDatabase();

  inviteMember(projectId: string, memberId: string, role: 'owner' | 'member' = 'member'): void {
    const member = teamStore.getById(memberId);
    if (!member) throw new Error('Member not found in Teams');

    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO project_team_members (id, project_id, member_id, role_in_project, joined_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, projectId, memberId, role, Date.now());
  }
}
```

### 4.3 Issue Store

```typescript
export class IssueStore {
  private db = getCollaborationDatabase();

  create(input: CreateIssueInput): Issue {
    const id = crypto.randomUUID();
    const number = this.nextIssueNumber(input.projectId);
    const worklineKey = `issue-${number}`;

    this.db.prepare(`
      INSERT INTO issues (
        id, project_id, number, title, description, status, priority,
        owner_id, workline_key, workline_state, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
    `).run(
      id,
      input.projectId,
      number,
      input.title,
      input.description ?? '',
      input.priority ?? 'medium',
      input.ownerId,
      worklineKey,
      Date.now(),
      Date.now(),
    );

    return this.getById(id)!;
  }
}
```

说明：

- 评论当前不做内部/外部隔离，统一按项目团队可见
- 负责人是推荐的对外同步者，不是唯一可写评论者
- `Issue 工作线` 是业务对象，不等同于单一 Git branch
- 一个大型 Issue 允许负责人在工作线下创建多个 Git refs / branches

---

## 5. Issue 驱动引擎

### 5.1 Worktree 优先模型

产品心智上，每个 Issue 的协作核心是多个独立 worktree：
- 每个有任务的成员拥有自己的 Issue worktree
- 每个 Issue-Member 对应一个 terminal
- 负责人负责最终集成、验收和推进 PR

Git 底层约束说明：
- `git worktree` 不是纯目录复制，它要求每个 worktree 处于某个可 checkout 的 Git 状态
- 同一个本地分支不能同时被多个 worktree checkout
- 因此，当一个 Issue 有多个需要提交代码的成员时，系统必须在底层为不同 worktree 分配不同的 Git 引用状态

设计结论：
- **对用户和产品文档，主概念是 worktree**
- **对实现，仍需要 Git ref / branch 策略作为 worktree 的底层支撑**
- 负责人看到的是 Issue 工作线；普通成员主要感知的是自己的 worktree，而不是分支

### 5.2 Harness 驱动角色工作流

员工角色的工作流不在系统中硬编码，而是通过 Prompt 配置和 Harness 规则驱动：

- 成员是什么角色，由 `defaultPrompt + skills + personality + capabilities` 决定
- 负责人如何拆解需求、何时拉人、何时验收、何时推进 PR，也由 Harness 约束引导
- 系统只提供协作骨架：Issue、评论、worktree、terminal、PR、状态流转
- “产品经理先出方案、开发再实现、测试再验收”是推荐模式，不是写死的流程图

实现原则：

- **角色行为由 Harness 驱动**
- **业务状态由系统落库**
- **Git / worktree 操作由 Orca 现有能力执行**

### 5.3 Issue 生命周期

```typescript
export class IssueLifecycleEngine {
  constructor(
    private runtime: Runtime,
    private worktreeAllocator: WorktreeAllocator,
    private harnessEngine: HarnessEngine,
  ) {}

  async onIssueCreated(issueId: string): Promise<void> {
    const issue = issueStore.getById(issueId);
    const project = projectStore.getById(issue.projectId);

    await this.initializeWorkline(issue, project);

    await this.notifyOwner(issue.ownerId, issue);
  }

  async assignTask(issueId: string, assignerId: string, assignments: TaskAssignment[]): Promise<void> {
    const issue = issueStore.getById(issueId);
    const project = projectStore.getById(issue.projectId);

    for (const assignment of assignments) {
      const worktree = await this.worktreeAllocator.createForIssue({
        issue,
        project,
        memberId: assignment.memberId,
        needsDedicatedRef: assignment.needsCodeBranch ?? true,
      });

      const terminal = await this.runtime.createTerminal(`id:${worktree.id}`, {
        launchAgent: assignment.member.agentType,
        command: this.buildAgentCommand(assignment.member),
        env: this.buildAgentEnv(assignment.member),
      });

      this.recordWorktreeAllocation(issueId, assignment.memberId, worktree.id, terminal.id);

      const prompt = this.harnessEngine.buildInitialPrompt(issue, assignment.member, assignment.task);
      await this.runtime.sendToTerminal(terminal.handle, prompt);
    }
  }

  async onIssueCompleted(issueId: string): Promise<void> {
    const issue = issueStore.getById(issueId);

    await this.worktreeAllocator.integrateIssueWorkline(issueId, issue.ownerId);
    await this.worktreeAllocator.closeAllForIssue(issueId);
    issueStore.updateStatus(issueId, 'done');
  }

  private async initializeWorkline(issue: Issue, project: Project): Promise<void> {
    await gitRefRegistry.ensureIssueOwnerRef({
      issueId: issue.id,
      worklineKey: issue.worklineKey,
      repoPath: project.repoPath,
      defaultBranch: project.defaultBranch,
      hostId: project.hostId,
      ownerId: issue.ownerId,
    });
  }
}
```

### 5.4 Worktree 分配器

```typescript
export class WorktreeAllocator {
  async createForIssue(input: CreateIssueWorktreeInput): Promise<Worktree> {
    const existing = this.getExistingWorktree(input.issue.id, input.memberId);
    if (existing) return existing;

    const member = teamStore.getById(input.memberId)!;
    const activeRefName = await gitRefRegistry.ensureWorktreeRef({
      issueId: input.issue.id,
      worklineKey: input.issue.worklineKey,
      memberId: input.memberId,
      repoPath: input.project.repoPath,
      hostId: input.project.hostId,
    });

    const worktree = await worktreeManager.addWorktree({
      repoPath: input.project.repoPath,
      prefix: `issue-${input.issue.number}-${member.role}`,
      branch: activeRefName,
      hostId: input.project.hostId,
    });

    return worktree;
  }

  async integrateIssueWorkline(issueId: string, ownerId: string): Promise<void> {
    // 负责人负责汇总各 worktree 的提交结果，并完成最终集成。
    // 具体选择 merge / cherry-pick / rebase 由 Harness 策略与当前 Git 状态共同决定。
  }
}
```

### 5.5 推荐负责人沟通机制

```typescript
export class OwnerCollaborationManager {
  async handleAgentComment(issueId: string, comment: IssueComment): Promise<void> {
    const issue = issueStore.getById(issueId);

    if (comment.authorType === 'agent' && comment.authorId === issue.ownerId) {
      await this.markAsOwnerSummary(issueId, comment);
      return;
    }

    await this.storeTeamVisibleComment(issueId, comment);
  }
}
```

说明：

- 所有 Issue 评论默认项目团队可见
- UI 默认强调负责人的总结和同步消息
- 不对成员直接评论做权限封堵
- Git 引用策略属于实现细节，不作为主要 UI 概念外露

### 5.6 项目管理状态机

角色行为由 Harness 驱动，但业务状态需要统一收敛，建议采用下面的项目管理状态机。

#### Issue 状态

| 状态 | 含义 | 进入条件 | 退出条件 |
| ---- | ---- | -------- | -------- |
| `intake` | 刚创建，待理解需求 | 创建 Issue | 负责人确认进入 `planning` |
| `planning` | 需求澄清、拆解、分工 | 负责人开始组织团队 | 至少一个成员被分配工作，进入 `in_progress` |
| `in_progress` | 团队正在推进 | worktree / agent 已启动 | 负责人发起验收，进入 `review` |
| `review` | 汇总结果、验收、修正 | 负责人发起 review | 通过则 `done`，失败回 `in_progress` |
| `blocked` | 受阻 | Harness 或负责人标记阻塞 | 阻塞解除回原状态 |
| `done` | 完成 | PR 合并或负责人确认完成 | 终态 |
| `cancelled` | 取消 | 用户或负责人取消 | 终态 |

#### PR 状态

| 状态 | 含义 |
| ---- | ---- |
| `draft` | 负责人或成员准备提交结果 |
| `open` | 已创建，待 review |
| `changes_requested` | 需要继续修改 |
| `ready_to_merge` | 已满足合并条件 |
| `merged` | 已合并 |
| `closed` | 放弃 |

#### Issue-Worktree 状态

| 状态 | 含义 |
| ---- | ---- |
| `pending` | 已分配但未启动 |
| `active` | worktree 与 terminal 已就绪 |
| `waiting_review` | 成员工作已完成，等待负责人集成 |
| `blocked` | 受阻 |
| `closed` | 已关闭 |

说明：

- 状态机只约束协作收敛，不规定成员必须怎么工作
- 成员具体动作由 Harness 决定
- 负责人可在一个 Issue 工作线下创建多个 branches / refs，但业务状态仍只挂在一个 Issue 上

---

## 6. Pipeline Harness

### 6.1 CLI 工具集

```typescript
export class PipelineCli {
  constructor(
    private repoPath: string,
    private memberId: string,
    private issueId: string,
  ) {}

  async commentOnIssue(body: string): Promise<void> {
    const member = teamStore.getById(this.memberId)!;
    await issueStore.addComment({
      issueId: this.issueId,
      authorId: this.memberId,
      authorType: 'agent',
      authorName: member.name,
      body,
      visibility: 'project_team',
    });
  }

  async createPR(title: string): Promise<PR> {
    const issue = issueStore.getById(this.issueId);
    const project = projectStore.getById(issue.projectId);
    return prStore.create({
      projectId: issue.projectId,
      issueId: this.issueId,
      title,
      sourceBranch: gitRefRegistry.getPreferredPrSourceRef(issue.id, this.memberId),
      targetBranch: project.defaultBranch,
      authorId: this.memberId,
    });
  }

  async notifyTeam(message: string): Promise<void> {
    const issue = issueStore.getById(this.issueId);
    const projectTeam = projectTeamStore.getProjectTeam(issue.projectId);
    for (const member of projectTeam) {
      if (member.id === this.memberId) continue;
      await orchestration.send({
        target: member.id,
        from: this.memberId,
        message,
      });
    }
  }
}
```

### 6.2 Harness 注入引擎

```typescript
export class HarnessEngine {
  buildSystemPrompt(member: TeamMember, issue: Issue, assignment: TaskAssignment): string {
    const isOwner = issue.ownerId === member.id;

    return `
你是 ${member.name}，团队的 ${member.role}。

<skills>
${member.skills.filter(skill => skill.enabled).map(skill => `- ${skill.skillName}`).join('\n')}
</skills>

<default_prompt>
${member.defaultPrompt}
</default_prompt>

<current_issue>
Issue #${issue.number}: ${issue.title}
Issue 工作线: ${issue.worklineKey}
${isOwner ? '你是负责人，优先负责对外沟通、集成、验收和推进 PR。' : '你是成员，通过 Issue 评论与团队协作。'}
</current_issue>

<task>
${assignment.task}
</task>

<rules>
1. 每次关键操作后在 Issue 中反馈进度
2. 任务完成后必须评论总结
3. 使用 orca CLI 工具执行操作
4. 超出 scope 的需求需由负责人确认
5. 你的角色工作流以默认 Prompt 和当前 Harness 规则为准
</rules>
    `.trim();
  }
}
```

### 6.3 Agent 执行适配层

参考 CodeBuddy NPC 的 Agent SDK 分层实现后，本项目需要把 Harness 拆成 4 个明确边界：

1. **环境校验 / 上下文快照**：确认当前执行所需的项目、Issue、成员、宿主、worktree、工作模式都存在
2. **Prompt 构建**：将角色规则和当前任务输入分开构建，避免业务层直接拼字符串
3. **执行适配**：用统一接口驱动不同 Agent CLI / SDK，而不是在业务流程里分支判断
4. **流事件归一化**：把不同执行器返回的文本、thinking、tool_use、tool_result、结束状态映射成统一事件

```typescript
export type HarnessExecutionContext = {
  projectId: string;
  projectPath: string;
  hostId: string;
  hostType: Project['hostType'];
  issueId: string;
  issueNumber: number;
  worklineKey: string;
  memberId: string;
  role: string;
  assignmentTask: string;
  worktreePath: string;
  workMode: 'execute' | 'review' | 'ask';
};

export type AgentExecutionPolicy = {
  maxTurns: number;
  firstTokenTimeoutMs: number;
  idleTimeoutMs: number;
  allowedTools: string[];
  requireProgressComment: boolean;
};

export type AgentRunEvent =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; toolName: string; callId: string }
  | { type: 'tool_result'; toolName: string; callId: string; content: string }
  | { type: 'result'; status: 'success' | 'failed'; summary?: string };

export interface AgentRunner {
  run(request: {
    agentType: TeamMember['agentType'];
    command: string;
    env: Record<string, string>;
    context: HarnessExecutionContext;
    policy: AgentExecutionPolicy;
    systemPrompt: string;
    userPrompt: string;
  }): AsyncIterable<AgentRunEvent>;
}
```

设计要求：

- `execution-context.ts` 负责生成上下文快照，缺少关键字段时直接 fail fast
- `harness-engine.ts` 只负责 `systemPrompt / userPrompt` 构建，不直接启动 Agent
- `agent-runner.ts` 负责适配不同 Agent 的命令行、环境变量、模型参数和超时策略
- `stream-event-normalizer.ts` 负责处理工具调用配对、孤儿事件告警、结构化日志和最终状态输出

从 CodeBuddy SDK 中可直接借鉴的点：

- **Prompt 分层**：`systemPrompt` 放角色与规则，`userPrompt` 放场景与输入
- **执行策略显式化**：最大轮次、超时、工具白名单、遥测开关不应散落在业务代码中
- **工具调用配对**：需要维护 `tool_use -> tool_result` 对应关系，避免日志和追踪断链
- **结果统一出口**：无论成功失败，都应输出统一的完成事件和统计摘要

不直接照搬的点：

- 不依赖 `CNB_*` 这类平台变量命名
- 不把容器入口脚本当成 Orca 的产品入口
- 不默认使用 `bypassPermissions` 这类与 CNB Bot 场景强绑定的 SDK 选项

### 6.4 收敛规则引擎

```typescript
export class ConvergenceEngine {
  private config = {
    maxCommentRounds: 10,
    maxStageDurationMs: 30 * 60 * 1000,
    maxRetries: 2,
  };
}
```

---

## 7. 与现有基础设施的集成

### 7.1 复用 Orca Runtime

```typescript
const worktree = await this.runtime.createManagedWorktree({
  repoPath: project.repoPath,
  prefix: `issue-${issue.number}`,
  branch: activeRefName,
  hostId: project.hostId,
});

const terminal = await this.runtime.createTerminal(`id:${worktree.id}`, {
  launchAgent: member.agentType,
  command: this.buildAgentCommand(member),
  env: {
    ORCA_ISSUE_ID: issue.id,
    ORCA_MEMBER_ID: member.id,
    ORCA_PROJECT_HOST_ID: project.hostId,
    ORCA_WORKTREE_PATH: worktree.path,
    ORCA_WORKLINE_KEY: issue.worklineKey,
    ORCA_ASSIGNMENT_TASK: assignment.task,
    ORCA_WORK_MODE: 'execute',
    ORCA_HARNESS_PROMPT: systemPrompt,
  },
});
```

可以直接复用 Orca 的现有能力，新增层保持尽量薄：

- **项目 / worktree / terminal / git 执行**：直接复用 Orca
- **连接层 / 宿主差异 / SSH / WSL / remote**：直接复用 Orca
- **需要新增的只是协作域元数据与执行上下文层**：Teams、项目团队、Issue 工作线、Harness 配置、上下文快照、状态机

因此问题不在“能不能复用 Orca”，而在“要不要把协作域状态补齐”。本方案选择：

- **执行层全部复用 Orca**
- **业务层新增轻量协作模型**
- **Agent 适配层只做薄封装，不重复实现 Orca runtime**

### 7.2 宿主兼容性

当前产品层只区分两种情况：

- 有 Git：进入团队协作流程
- 没有 Git：提示 `git init`

除此之外，`local / ssh / wsl / remote` 不新增产品分支逻辑，全部沿用 Orca 现有执行模型。

任何 Git、Worktree、Terminal 操作都必须带上 `hostId` / `hostType` 上下文。

### 7.3 复用 Orchestration

```typescript
await orchestration.send({
  target: targetMemberId,
  from: sourceMemberId,
  type: 'issue_update',
  payload: { issueId, message },
});
```

---

## 8. IPC 设计

```typescript
// Teams IPC
'team:member:list'
'team:member:getById'
'team:member:create'
'team:member:update'
'team:member:delete'
'team:agent:checkHealth'
'team:agent:getAvailableAgents'
'team:agent:getAvailableSkills'

// Collaboration IPC
'collab:project:list'
'collab:project:register'
'collab:project:initGit'
'collab:project:getById'
'collab:team:invite'
'collab:team:remove'
'collab:team:getProjectTeam'

// Issue IPC
'issue:list'
'issue:getById'
'issue:create'
'issue:updateStatus'
'issue:addComment'
'issue:assignTask'
'issue:getWorktrees'

// PR IPC
'pr:list'
'pr:create'
'pr:merge'
'pr:getDiff'
'pr:addComment'
'pr:submitApproval'
```

---

## 9. 并发模型

### 9.1 Issue 级并行

```text
Issue #12:
  ├── 小K: issue-12-pm/       → Terminal 1 (Kimi)
  ├── 小D: issue-12-dev/      → Terminal 1 (OpenCode)
  └── 小M: issue-12-design/   → Terminal 1 (OpenCode)

  底层 Git 状态：
  ├── 负责人 worktree 关联 Issue 工作线
  ├── 开发成员 worktree 按需关联独立 ref
  └── 最终由负责人完成集成
```

### 9.2 成员级并行

```text
小D 同时参与 3 个 Issue:
  ├── Issue #12: issue-12-dev/    → Terminal 1
  ├── Issue #13: issue-13-dev/    → Terminal 1
  └── Issue #14: issue-14-dev/    → Terminal 1

每个 Issue 仅 1 个 Terminal，Agent 内部自行并行子任务
```

### 9.3 冲突处理

- 独立 worktree 用于尽量减少直接冲突
- 底层 Git ref 隔离由系统自动处理
- 若多个成员提交存在冲突，由负责人在集成阶段统一解决
- PR 从负责人维护的 Issue 工作线创建

---

## 10. 安全设计

### 10.1 数据本地化

- 所有协作数据统一存储在 `~/.orca/collaboration.db`
- 所有数据纯本地，不上传
- 项目执行宿主信息按 Orca 现有连接模型记录

### 10.2 Agent 隔离

- Agent 只能访问自己的 worktree
- Agent 不能读取 `~/.orca` 下的敏感配置
- Agent 的 Bash 工具限制在 worktree 目录内

### 10.3 敏感配置加密

- Agent API Key 使用 Electron `safeStorage` 加密
- 仅在 Agent 启动时解密注入环境变量

### 10.4 异常恢复

异常恢复优先复用 Orca 现有逻辑，不单独发明第二套恢复机制：

- worktree 丢失 / 移除：复用 Orca worktree 扫描与 reconciliation
- terminal 断开：复用 Orca terminal / PTY 恢复逻辑
- 远程连接断开：复用 Orca host / remote runtime 重连逻辑
- Git 状态漂移：复用 Orca Git provider 与 worktree list / status 刷新

协作层只补业务对账：

- DB 中存在但 Orca 不存在的 worktree → 标记 `closed` / `blocked`
- Orca 中存在但 DB 未登记的 worktree → 标记为 unmanaged，不自动接管
- Issue `done` 时若仍有活跃 worktree → 回退到 `review` 或标记 `blocked`

---

## 11. 测试策略

### 11.1 单元测试

| 模块 | 测试内容 |
| ------ | --------- |
| Team Store | CRUD、删除约束 |
| Project Store | 项目接入、Git 初始化 |
| Issue Store | CRUD、状态流转、评论 |
| PR Store | 创建、合并、审批 |
| Worktree Allocator | 创建、关闭、底层 Git 引用分配 |
| Harness Engine | Prompt 注入 |
| Convergence Engine | 轮次上限、超时 |

### 11.2 集成测试

| 场景 | 测试内容 |
| ------ | --------- |
| Issue → 协作 | 创建 Issue → 分配 worktree → Agent 评论 → 集成 |
| PR → Review | 创建 PR → Review → 合并 |
| 并行 Issue | 多 Issue 同时处理 |
| 多宿主执行 | local / SSH / WSL / remote 下流程一致 |
| 成员删除约束 | 有活跃 worktree 时无法删除 |

### 11.3 E2E 测试

- 复用现有 Playwright + CDP 框架
- 模拟完整 Issue 处理流程
