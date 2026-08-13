# Orca 团队协作功能 - 技术详细设计

> 版本: v3.0 | 日期: 2026-08-13 | 状态: 修订版

---

## 1. 架构总览

### 1.1 设计哲学

```
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
  ├── Issues and PRs 面板 (本地 Issue/PR，按项目)
  ├── 项目团队 (从 Teams 抽调)
  ├── Issue → Branch → Worktree 自动分配
  └── Pipeline Harness (标准化 CLI + 规则)
```

### 1.2 UI 布局

Orca 的导航入口位于**左侧边栏顶部**（Sidebar Nav），采用垂直排列。新增的 "Issues and PRs" 和 "Teams" 按钮与现有 Tasks、Automations、Search 等按钮并列。

```
┌──────────────────┐
│  ◯ SetupGuide    │  ← 条件显示
│  📋 Tasks        │  ← 现有（远程 Git Issue/PR）
│  📁 Artifacts    │  ← 条件显示
│  📋 Issues & PRs │  ← 【新增】本地 Issue/PR
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

**实现方式**：在现有 `SidebarNav` 组件中新增两个导航按钮，遵循现有样式规范（13px 文字、size-4 图标、rounded-md 圆角、`bg-worktree-sidebar-accent` 激活态背景）。

### 1.3 模块组织

```
src/
├── main/
│   ├── teams/                      # 【新增】公司团队管理
│   │   ├── teams-database.ts
│   │   ├── team-store.ts
│   │   ├── member-model.ts
│   │   ├── agent-config.ts
│   │   └── ipc.ts
│   │
│   ├── collaboration/              # 【新增】项目协作
│   │   ├── collab-database.ts
│   │   ├── project-store.ts
│   │   ├── issue-store.ts
│   │   ├── pr-store.ts
│   │   ├── project-team-store.ts
│   │   └── ipc.ts
│   │
│   ├── issue-engine/               # 【新增】Issue 驱动引擎
│   │   ├── issue-lifecycle.ts      # Issue → Branch → Worktree
│   │   ├── worktree-allocator.ts   # Worktree 分配
│   │   ├── single-contact.ts       # 单一联系人机制
│   │   └── ipc.ts
│   │
│   ├── pipeline/                   # 【新增】Pipeline Harness
│   │   ├── pipeline-cli.ts          # CLI 工具集
│   │   ├── harness-engine.ts       # Harness 注入
│   │   ├── convergence-rules.ts    # 收敛规则
│   │   └── ipc.ts
│   │
│   └── (现有模块复用)
│       ├── git/worktree.ts
│       ├── runtime/orca-runtime.ts
│       ├── agent-hooks/server.ts
│       └── agent-hooks/managed-agent-hook-registry.ts
│
├── shared/
│   ├── team-types.ts               # 【新增】
│   ├── issue-types.ts              # 【新增】
│   ├── pr-types.ts                 # 【新增】
│   └── collaboration-types.ts     # 【新增】
│
└── renderer/src/
    ├── components/
    │   ├── issues/                 # 【新增】Issue UI
    │   ├── pull-requests/          # 【新增】PR UI
    │   ├── team/                   # 【新增】Team UI
    │   └── projects/               # 【新增】项目协作 UI
    │
    └── store/slices/
        ├── issues.ts               # 【新增】
        ├── pull-requests.ts        # 【新增】
        ├── team.ts                 # 【新增】
        └── projects.ts             # 【新增】
```

---

## 2. 数据存储设计

### 2.1 数据库分离

| 数据库 | 位置 | 存储内容 |
|--------|------|---------|
| `teams.db` | `~/.orca/teams.db` | 公司团队、成员 Agent 配置 |
| `collaboration.db` | `~/.orca/collaboration.db` | 项目、Issue、PR、项目团队、活动日志 |

### 2.2 Teams 数据库 Schema

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

-- 无 worktree 绑定！worktree 是 Issue 级的
```

### 2.3 Collaboration 数据库 Schema

```sql
-- 项目表
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  repo_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 项目团队成员表 (中间表)
CREATE TABLE project_team_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  member_id TEXT NOT NULL REFERENCES team_members(id),
  role_in_project TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'member'
  joined_at INTEGER NOT NULL,
  UNIQUE(project_id, member_id)
);

-- Issue 表
CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  owner_id TEXT NOT NULL REFERENCES team_members(id),  -- 负责人
  branch_name TEXT,                                      -- 关联分支
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Issue 评论表
CREATE TABLE issue_comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  author_id TEXT NOT NULL,          -- team_member_id 或 'user'
  author_type TEXT NOT NULL,        -- 'user' | 'agent'
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- PR 表
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

-- PR 评论表
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

-- Issue-Worktree 映射表
CREATE TABLE issue_worktrees (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  member_id TEXT NOT NULL REFERENCES team_members(id),
  worktree_id TEXT NOT NULL,        -- 关联 Orca 的 worktree
  terminal_id TEXT,                 -- 关联 Terminal
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  UNIQUE(issue_id, member_id)       -- 每个 Issue 每个成员只有一个 worktree
);

-- 活动日志
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

-- 索引
CREATE INDEX idx_issues_project ON issues(project_id);
CREATE INDEX idx_issues_owner ON issues(owner_id);
CREATE INDEX idx_issues_branch ON issues(branch_name);
CREATE INDEX idx_issue_worktrees_issue ON issue_worktrees(issue_id);
CREATE INDEX idx_issue_worktrees_member ON issue_worktrees(member_id);
CREATE INDEX idx_prs_project ON pull_requests(project_id);
CREATE INDEX idx_prs_issue ON pull_requests(issue_id);
CREATE INDEX idx_activity_project ON activity_log(project_id);
```

---

## 3. Teams 模块（公司级）

### 3.1 核心模型

```typescript
// src/shared/team-types.ts

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  avatarUrl?: string;
  personality: string;
  responsibilities: string[];
  capabilities: string[];

  // Agent 配置
  agentType: AgentType;
  agentModel: string;
  agentConfig: Record<string, unknown>;

  // Skills
  skills: SkillBinding[];

  // Prompt
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
// src/main/teams/team-store.ts

export class TeamStore {
  private db = getTeamsDatabase();

  create(input: CreateMemberInput): TeamMember {
    const id = crypto.randomUUID();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO team_members (id, name, role, personality, responsibilities, capabilities,
        agent_type, agent_model, agent_config, skills, default_prompt, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(/* ... */);

    return this.getById(id)!;
  }

  /**
   * 删除成员前检查：必须所有 worktree 已关闭
   */
  async canDelete(memberId: string): Promise<{ canDelete: boolean; activeWorktrees: number }> {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM issue_worktrees iw
      JOIN issues i ON iw.issue_id = i.id
      WHERE iw.member_id = ? AND iw.status = 'active' AND i.status != 'done'
    `).get(memberId) as { count: number };

    return {
      canDelete: result.count === 0,
      activeWorktrees: result.count,
    };
  }

  async delete(memberId: string): Promise<void> {
    const { canDelete } = await this.canDelete(memberId);
    if (!canDelete) {
      throw new Error('Member has active worktrees. Close all worktrees first.');
    }
    this.db.prepare('DELETE FROM team_members WHERE id = ?').run(memberId);
  }

  /**
   * 获取成员当前活跃 worktree 数量
   */
  getActiveWorktreeCount(memberId: string): number {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM issue_worktrees
      WHERE member_id = ? AND status = 'active'
    `).get(memberId) as { count: number };
    return result.count;
  }
}
```

---

## 4. Collaboration 模块（项目级）

### 4.1 Project Store

```typescript
// src/main/collaboration/project-store.ts

export class ProjectStore {
  private db = getCollaborationDatabase();

  create(input: CreateProjectInput): Project {
    const id = crypto.randomUUID();

    this.db.prepare(`
      INSERT INTO projects (id, name, description, repo_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.description ?? '', input.repoPath, Date.now(), Date.now());

    return this.getById(id)!;
  }
}
```

### 4.2 Project Team Store

```typescript
// src/main/collaboration/project-team-store.ts

export class ProjectTeamStore {
  private db = getCollaborationDatabase();

  /**
   * 邀请成员到项目团队
   * 成员必须是公司 Teams 中的
   */
  inviteMember(projectId: string, memberId: string, role: 'owner' | 'member' = 'member'): void {
    // 验证成员存在于 Teams
    const member = teamStore.getById(memberId);
    if (!member) {
      throw new Error('Member not found in Teams');
    }

    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO project_team_members (id, project_id, member_id, role_in_project, joined_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, projectId, memberId, role, Date.now());
  }

  /**
   * 移除成员（需先关闭其在项目中的所有 worktree）
   */
  async removeMember(projectId: string, memberId: string): Promise<void> {
    // 检查是否有活跃的 worktree
    const activeCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM issue_worktrees iw
      JOIN issues i ON iw.issue_id = i.id
      WHERE i.project_id = ? AND iw.member_id = ? AND iw.status = 'active'
    `).get(projectId, memberId) as { count: number };

    if (activeCount.count > 0) {
      throw new Error('Member has active worktrees in this project');
    }

    this.db.prepare('DELETE FROM project_team_members WHERE project_id = ? AND member_id = ?')
      .run(projectId, memberId);
  }

  /**
   * 获取项目团队成员
   */
  getProjectTeam(projectId: string): ProjectTeamMember[] {
    return this.db.prepare(`
      SELECT ptm.*, tm.name, tm.role, tm.agent_type, tm.agent_model
      FROM project_team_members ptm
      JOIN team_members tm ON ptm.member_id = tm.id
      WHERE ptm.project_id = ?
    `).all(projectId) as ProjectTeamMember[];
  }
}
```

### 4.3 Issue Store

```typescript
// src/main/collaboration/issue-store.ts

export class IssueStore {
  private db = getCollaborationDatabase();

  create(input: CreateIssueInput): Issue {
    const id = crypto.randomUUID();
    const number = this.nextIssueNumber(input.projectId);
    const branchName = `feature/issue-${number}-${slugify(input.title)}`;

    this.db.prepare(`
      INSERT INTO issues (id, project_id, number, title, description, status, priority, owner_id, branch_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
    `).run(id, input.projectId, number, input.title, input.description ?? '',
           input.priority ?? 'medium', input.ownerId, branchName, Date.now(), Date.now());

    return this.getById(id)!;
  }

  /**
   * 添加评论（用户或 Agent）
   */
  addComment(input: AddCommentInput): IssueComment {
    const id = crypto.randomUUID();

    this.db.prepare(`
      INSERT INTO issue_comments (id, issue_id, author_id, author_type, author_name, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.issueId, input.authorId, input.authorType, input.authorName, input.body, Date.now());

    return this.getCommentById(id)!;
  }

  /**
   * 获取 Issue 详情（含评论、worktree 分配）
   */
  getDetail(issueId: string): IssueDetail {
    const issue = this.getById(issueId);
    const comments = this.getComments(issueId);
    const worktrees = this.getWorktreeAllocations(issueId);

    return { ...issue, comments, worktrees };
  }

  private nextIssueNumber(projectId: string): number {
    const row = this.db.prepare('SELECT MAX(number) as max FROM issues WHERE project_id = ?').get(projectId) as { max: number | null };
    return (row.max ?? 0) + 1;
  }
}
```

---

## 5. Issue 驱动引擎

### 5.1 Issue 生命周期

```typescript
// src/main/issue-engine/issue-lifecycle.ts

export class IssueLifecycleEngine {
  constructor(
    private runtime: Runtime,
    private worktreeAllocator: WorktreeAllocator,
    private harnessEngine: HarnessEngine,
  ) {}

  /**
   * Issue 创建后自动触发
   */
  async onIssueCreated(issueId: string): Promise<void> {
    const issue = issueStore.getById(issueId);
    const project = projectStore.getById(issue.projectId);

    // 1. 创建分支
    await gitRunner.createBranch(project.repoPath, issue.branchName, 'main');

    // 2. 通知负责人
    await this.notifyOwner(issue.ownerId, issue);
  }

  /**
   * 负责人分配任务给团队成员
   */
  async assignTask(issueId: string, assignerId: string, assignments: TaskAssignment[]): Promise<void> {
    const issue = issueStore.getById(issueId);

    for (const assignment of assignments) {
      // 1. 创建 worktree（基于 Issue 分支）
      const worktree = await this.worktreeAllocator.createForIssue({
        issueId,
        memberId: assignment.memberId,
        repoPath: issue.repoPath,
        branchName: issue.branchName,
      });

      // 2. 创建 Terminal
      const terminal = await this.runtime.createTerminal(`id:${worktree.id}`, {
        launchAgent: assignment.member.agentType,
        command: this.buildAgentCommand(assignment.member),
        env: this.buildAgentEnv(assignment.member),
      });

      // 3. 记录映射
      this.recordWorktreeAllocation(issueId, assignment.memberId, worktree.id, terminal.id);

      // 4. 发送初始任务
      const prompt = this.harnessEngine.buildInitialPrompt(issue, assignment.member, assignment.task);
      await this.runtime.sendToTerminal(terminal.handle, prompt);
    }
  }

  /**
   * Issue 完成后合并分支
   */
  async onIssueCompleted(issueId: string): Promise<void> {
    const issue = issueStore.getById(issueId);
    const project = projectStore.getById(issue.projectId);

    // 1. 合并分支到 main
    await gitRunner.mergeBranch(project.repoPath, issue.branchName, 'main');

    // 2. 关闭所有 worktree
    await this.worktreeAllocator.closeAllForIssue(issueId);

    // 3. 更新 Issue 状态
    issueStore.updateStatus(issueId, 'done');
  }
}
```

### 5.2 Worktree 分配器

```typescript
// src/main/issue-engine/worktree-allocator.ts

export class WorktreeAllocator {
  /**
   * 为 Issue 成员创建 worktree
   * 规则：每个 Issue 每个成员只有一个 worktree
   */
  async createForIssue(input: CreateIssueWorktreeInput): Promise<Worktree> {
    // 检查是否已存在
    const existing = this.getExistingWorktree(input.issueId, input.memberId);
    if (existing) return existing;

    const member = teamStore.getById(input.memberId);
    const worktree = await worktreeManager.addWorktree({
      repoPath: input.repoPath,
      prefix: `issue-${input.issue.number}-${member.role}`,
      branch: input.branchName,
    });

    return worktree;
  }

  /**
   * 关闭 Issue 的所有 worktree
   */
  async closeAllForIssue(issueId: string): Promise<void> {
    const allocations = this.getAllocationsForIssue(issueId);
    for (const alloc of allocations) {
      await worktreeManager.removeWorktree(alloc.worktreeId);
      await this.runtime.stopTerminal(alloc.terminalId);
      this.markWorktreeClosed(alloc.id);
    }
  }

  /**
   * 获取成员的活跃 worktree 列表
   */
  getMemberActiveWorktrees(memberId: string): IssueWorktreeAllocation[] {
    return collabDb.prepare(`
      SELECT iw.*, i.title as issue_title, i.number as issue_number
      FROM issue_worktrees iw
      JOIN issues i ON iw.issue_id = i.id
      WHERE iw.member_id = ? AND iw.status = 'active'
      ORDER BY i.created_at DESC
    `).all(memberId) as IssueWorktreeAllocation[];
  }
}
```

### 5.3 单一联系人机制

```typescript
// src/main/issue-engine/single-contact.ts

export class SingleContactManager {
  /**
   * 验证：只有负责人可以与用户直接沟通
   * 其他成员的 Agent 评论不直接展示给用户
   * 而是通过负责人汇总后传达
   */
  async handleAgentComment(issueId: string, comment: IssueComment): Promise<void> {
    const issue = issueStore.getById(issueId);

    if (comment.authorType === 'agent') {
      if (comment.authorId === issue.ownerId) {
        // 负责人的评论 → 直接展示给用户
        await this.deliverToUser(issueId, comment);
      } else {
        // 其他成员的评论 → 记录在 Issue 中，负责人可见
        // 负责人可选择性汇总给用户
        await this.storeInternalComment(issueId, comment);
      }
    } else {
      // 用户评论 → 通知负责人
      await this.notifyOwner(issue.ownerId, comment);
    }
  }

  /**
   * 负责人汇总团队进度，向用户报告
   */
  async ownerReportsToUser(issueId: string, summary: string): Promise<void> {
    const issue = issueStore.getById(issueId);
    await issueStore.addComment({
      issueId,
      authorId: issue.ownerId,
      authorType: 'agent',
      authorName: '负责人',
      body: summary,
    });
  }
}
```

---

## 6. Pipeline Harness

### 6.1 CLI 工具集

```typescript
// src/main/pipeline/pipeline-cli.ts

export class PipelineCli {
  constructor(
    private repoPath: string,
    private memberId: string,
    private issueId: string,
  ) {}

  /**
   * Issue 评论
   */
  async commentOnIssue(body: string): Promise<void> {
    const member = teamStore.getById(this.memberId);
    await issueStore.addComment({
      issueId: this.issueId,
      authorId: this.memberId,
      authorType: 'agent',
      authorName: member.name,
      body,
    });
  }

  /**
   * 创建 PR
   */
  async createPR(title: string): Promise<PR> {
    const issue = issueStore.getById(this.issueId);
    return prStore.create({
      projectId: issue.projectId,
      issueId: this.issueId,
      title,
      sourceBranch: issue.branchName,
      targetBranch: 'main',
      authorId: this.memberId,
    });
  }

  /**
   * 通知负责人
   */
  async notifyOwner(message: string): Promise<void> {
    const issue = issueStore.getById(this.issueId);
    await orchestration.send({
      target: issue.ownerId,
      from: this.memberId,
      message,
    });
  }

  /**
   * 通知团队成员
   */
  async notifyTeam(message: string): Promise<void> {
    const projectTeam = projectTeamStore.getProjectTeam(issue.projectId);
    for (const member of projectTeam) {
      if (member.id !== this.memberId) {
        await orchestration.send({
          target: member.id,
          from: this.memberId,
          message,
        });
      }
    }
  }
}
```

### 6.2 Harness 注入引擎

```typescript
// src/main/pipeline/harness-engine.ts

export class HarnessEngine {
  buildSystemPrompt(member: TeamMember, issue: Issue, assignment: TaskAssignment): string {
    const isOwner = issue.ownerId === member.id;

    return `
你是 ${member.name}，团队的 ${member.role}。

${member.personality ? `<personality>\n${member.personality}\n</personality>` : ''}

<skills>
你拥有以下 Skills:
${member.skills.filter(s => s.enabled).map(s => `- ${s.skillName}`).join('\n')}
</skills>

<default_prompt>
${member.defaultPrompt}
</default_prompt>

<current_issue>
Issue #${issue.number}: ${issue.title}
描述: ${issue.description}
分支: ${issue.branch_name}
${isOwner ? '\n你是本 Issue 的负责人，负责与用户沟通。' : '\n你是本 Issue 的成员，通过 Issue 评论与团队沟通。'}
</current_issue>

<task>
${assignment.task}
</task>

<rules>
1. 每次操作后必须在 Issue 中评论反馈进度
2. 任务完成后必须评论总结
3. 有疑问请在 Issue 中提出
4. 使用 orca CLI 工具执行操作
5. 禁止需求无限膨胀（超出 scope 需负责人确认）
</rules>

<tools>
- orca issue comment "评论"   # 写 Issue 评论
- orca pr create --title "..." # 创建 PR
- orca pr merge <id>          # 合并 PR
- orca team notify "消息"     # 通知团队成员
- orca git commit -m "..."    # Git 提交
</tools>
    `.trim();
  }
}
```

### 6.3 收敛规则引擎

```typescript
// src/main/pipeline/convergence-rules.ts

export class ConvergenceEngine {
  private config = {
    maxCommentRounds: 10,           // 单 Issue 最大评论轮次
    maxStageDurationMs: 30 * 60 * 1000,  // 30 min
    maxRetries: 2,
  };

  /**
   * 检查 Issue 是否收敛
   */
  checkIssueConvergence(issueId: string): ConvergenceResult {
    const comments = issueStore.getComments(issueId);
    const agentComments = comments.filter(c => c.authorType === 'agent');

    // 轮次检查
    if (agentComments.length > this.config.maxCommentRounds) {
      return { converged: false, reason: 'max_rounds_exceeded', action: 'escalate' };
    }

    // 检查负责人是否确认 scope
    const hasOwnerConfirmation = agentComments.some(c =>
      c.authorType === 'agent' && c.body.includes('scope 已确认')
    );

    if (hasOwnerConfirmation) {
      return { converged: true, reason: 'owner_confirmed' };
    }

    return { converged: false, reason: 'in_progress' };
  }

  /**
   * 检查是否需要上报人类
   */
  shouldEscalate(issueId: string, failureCount: number): boolean {
    if (failureCount >= this.config.maxRetries) return true;
    const convergence = this.checkIssueConvergence(issueId);
    return convergence.action === 'escalate';
  }
}
```

---

## 7. 与现有基础设施的集成

### 7.1 复用 Orca Runtime

```typescript
// 创建 worktree (复用现有)
const worktree = await this.runtime.createManagedWorktree({
  repoPath,
  prefix: `issue-${number}`,
  branch: branchName,
});

// 创建 terminal + 启动 Agent (复用现有)
const terminal = await this.runtime.createTerminal(`id:${worktree.id}`, {
  launchAgent: member.agentType,
  command: this.buildAgentCommand(member),
  env: {
    ORCA_ISSUE_ID: issue.id,
    ORCA_MEMBER_ID: member.id,
    ORCA_HARNESS_PROMPT: systemPrompt,
  },
});
```

### 7.2 复用 Agent Hook Server

```typescript
// 监控 Agent 状态
agentHookServer.onStatusChange(terminal.paneKey, async (status) => {
  if (status === 'idle') {
    await this.onAgentComplete(issueId, memberId);
  }
});
```

### 7.3 复用 Orchestration

```typescript
// 跨 Agent 通信
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
'collab:project:create'
'collab:project:getById'
'collab:team:invite'
'team:remove'
'team:getProjectTeam'

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

// Issue Engine IPC
'issueEngine:onCreated'
'issueEngine:assignTask'
'issueEngine:onCompleted'
'issueEngine:getMemberWorktrees'
```

---

## 9. 并发模型

### 9.1 Issue 级并行

```
Issue #12:
  ├── 小K: issue-12-pm/       → Terminal 1 (Kimi)
  ├── 小D: issue-12-dev/      → Terminal 1 (OpenCode)
  └── 小M: issue-12-design/   → Terminal 1 (OpenCode)

每个成员在该 Issue 上只有 1 个 Terminal
Agent 内部并行处理子任务
```

### 9.2 成员级并行

```
小D 同时参与 3 个 Issue:
  ├── Issue #12: issue-12-dev/    → Terminal 1 (OpenCode)
  ├── Issue #13: issue-13-dev/    → Terminal 1 (OpenCode)
  └── Issue #14: issue-14-dev/    → Terminal 1 (OpenCode)

小D 有 3 个 worktree，每个 1 个 Terminal
```

### 9.3 资源约束

```typescript
const ConcurrencyConfig = {
  maxAgentsPerProject: 10,
  maxWorktreesPerMember: 5,     // 单成员最大活跃 worktree
  maxWorktreesPerIssue: 5,      // 单 Issue 最大 worktree
};
```

---

## 10. 安全设计

### 10.1 数据本地化

- Teams 数据存储在 `~/.orca/teams.db`
- Collaboration 数据存储在 `~/.orca/collaboration.db`
- 所有数据纯本地，不上传

### 10.2 Agent 隔离

- Agent 只能访问自己的 worktree
- Agent 不能读取 `~/.orca` 下的敏感配置
- Agent 的 Bash 工具限制在 worktree 目录内

### 10.3 敏感配置加密

- Agent API Key 使用 Electron `safeStorage` 加密
- 仅在 Agent 启动时解密注入环境变量

---

## 11. 测试策略

### 11.1 单元测试

| 模块 | 测试内容 |
|------|---------|
| Team Store | CRUD、删除约束 |
| Issue Store | CRUD、状态流转、评论 |
| PR Store | 创建、合并、审批 |
| Worktree Allocator | 创建、关闭、约束 |
| Harness Engine | Prompt 注入 |
| Convergence Engine | 轮次上限、超时 |

### 11.2 集成测试

| 场景 | 测试内容 |
|------|---------|
| Issue → 协作 | 创建 Issue → 分配任务 → Agent 评论 |
| PR → Review | 创建 PR → Review → 合并 |
| 并行 Issue | 多 Issue 同时处理 |
| 成员删除约束 | 有活跃 worktree 时无法删除 |

### 11.3 E2E 测试

- 复用现有 Playwright + CDP 框架
- 模拟完整 Issue 处理流程
