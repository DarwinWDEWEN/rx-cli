# Orca 团队协作功能 - 产品研发迭代规划

> 版本: v3.1 | 日期: 2026-08-14 | 状态: 修订版

---

## 1. 总体规划

### 1.1 迭代原则

- **Teams 是公司级**：成员可跨项目、跨 Issue 拥有多个 worktree
- **项目团队从 Teams 抽调**：项目成员必须来自公司 Teams
- **Project 与 Orca 一致**：打开的文件夹即项目，未初始化 Git 时提示 `git init`
- **Git 是协作前提**：所有 Issue / PR / Worktree 能力都建立在 Git 仓库之上
- **Issue 以 Worktree 为主心智**：每个 Issue 为有任务成员分配独立 worktree
- **Git 引用是底层实现细节**：系统自动处理 worktree 对应的 checkout/ref 状态
- **负责人主导沟通与集成**：默认由负责人对外同步并处理冲突，但不是硬性权限隔离
- **评论对项目团队可见**：当前不区分内外评论流
- **复用 Orca 宿主能力**：local / SSH / WSL / remote 统一沿用 Orca 现有能力
- **复用 Tasks 能力**：不修改 Tasks，在侧边栏导航中新增 `Issues and PRs` 和 `Teams`

### 1.2 时间线概览

```text
2026 Q3                          2026 Q4                         2027 Q1
│───────────────│──────────────────│──────────────────│───────────────│
    M1: Teams + 项目接入   M2: Issue 驱动       M3: Pipeline        M4: 收敛 +
    + Issues and PRs 基础   + Worktree 自动分配   Harness            协作体验
    (3 周)                  自动分配 (2 周)       + Agent 协作        + 并行优化
                             (3 周)                (2 周)
```

---

## 2. 迭代详细计划

### 2.1 M1: Teams + 项目接入 + Issues and PRs 基础 (3 周)

**目标**：完成公司团队管理、Git 项目接入、Issues and PRs 基础面板。

#### 第 1 周：单库与 Teams 管理

| 任务 | 负责人 | 产出 |
|------|--------|------|
| 统一协作数据库 schema | Backend | `collaboration-database.ts` |
| Team Store CRUD | Backend | `team-store.ts` |
| Agent 配置模型 | Backend | `agent-config.ts` |
| Skills 绑定 | Backend | `skill-binding.ts` |
| Teams IPC handlers | Backend | `ipc.ts` |
| Teams UI（成员列表+编辑） | Frontend | `TeamsPage.tsx` |

#### 第 2 周：项目接入 + Issue 存储

| 任务 | 负责人 | 产出 |
|------|--------|------|
| Project register / initGit | Backend | `project-store.ts` |
| Project Team Store | Backend | `project-team-store.ts` |
| Issue Store CRUD | Backend | `issue-store.ts` |
| PR Store CRUD | Backend | `pr-store.ts` |
| Project / Issue IPC handlers | Backend | `ipc.ts` |
| Git 初始化引导 | Frontend | 项目接入引导 UI |

#### 第 3 周：Issues and PRs UI

| 任务 | 负责人 | 产出 |
|------|--------|------|
| 侧边栏导航接入 | Frontend | `SidebarNav` 集成 |
| Issues and PRs 面板框架 | Frontend | `IssuesAndPRsPage.tsx` |
| Issue 列表 + 详情 UI | Frontend | `IssueList.tsx`, `IssueDetail.tsx` |
| 项目团队管理 UI | Frontend | `ProjectTeam.tsx` |
| 集成测试 | Full | 测试用例 |

#### M1 交付物

- ✅ Teams 管理（创建/编辑/删除成员，配置 Agent/Model/Skills/Prompt）
- ✅ 删除成员约束（所有活跃 worktree 已关闭）
- ✅ 项目接入（基于 Orca 已打开文件夹）
- ✅ 非 Git 项目初始化引导（`git init`）
- ✅ Issues and PRs 面板（与 Tasks 并列）
- ✅ 按项目显示 Issue/PR

---

### 2.2 M2: Issue 驱动开发 + Worktree 自动分配 (2 周)

**目标**：实现 Issue 创建后的 worktree、terminal 自动分配，以及负责人集成机制。

#### 第 4 周：Issue → Worktree

| 任务 | 负责人 | 产出 |
|------|--------|------|
| Issue 生命周期引擎 | Backend | `issue-lifecycle.ts` |
| Worktree 分配器 | Backend | `worktree-allocator.ts` |
| Issue-Worktree 映射表 | Backend | 数据库 schema |
| Issue 工作线初始化 | Backend | 工作线元数据 + Git ref 注册 |
| Worktree 底层引用分配 | Backend | Git 集成 |

#### 第 5 周：Agent 启动 + 负责人集成

| 任务 | 负责人 | 产出 |
|------|--------|------|
| Agent 启动集成 | Backend | Agent 启动流程 |
| 负责人集成流程 | Backend | `owner-collaboration.ts` |
| Issue 详情中 Worktree 展示 | Frontend | Worktree 面板 |
| 负责人分配 UI | Frontend | 分配组件 |
| 项目管理状态机 | Backend | Issue / PR / Worktree 状态流转 |
| 端到端测试 | Full | 测试用例 |

#### M2 交付物

- ✅ Issue 创建 → 自动建立 Issue 工作线
- ✅ 分配任务 → 自动创建 worktree + terminal
- ✅ 每个 Issue 每个成员只有一个 worktree
- ✅ 负责人负责集成成员提交并处理冲突
- ✅ Issue PR 从负责人维护的 Issue 工作线创建

---

### 2.3 M3: Pipeline Harness + Agent 协作 (3 周)

**目标**：实现标准化 CLI 工具集、Harness 注入、角色工作流配置、Agent 协作与评论同步。

#### 第 6 周：CLI 工具集

| 任务 | 负责人 | 产出 |
|------|--------|------|
| Issue CLI | Backend | `pipeline-cli.ts` |
| PR CLI | Backend | `pipeline-cli.ts` |
| Worktree / Git CLI | Backend | `pipeline-cli.ts` |
| Team CLI | Backend | `pipeline-cli.ts` |
| CLI 注册到 Agent 环境 | Backend | CLI 集成 |

#### 第 7 周：Harness 注入 + 协作上下文

| 任务 | 负责人 | 产出 |
|------|--------|------|
| Harness 注入引擎 | Backend | `harness-engine.ts` |
| System Prompt 模板 | Backend | Prompt 模板 |
| 角色工作流配置 | Backend | Prompt / Harness 规则 |
| Agent 评论回调 | Backend | 评论处理 |
| Pipeline 追踪器 | Backend | `pipeline-tracker.ts` |

#### 第 8 周：Pipeline UI

| 任务 | 负责人 | 产出 |
|------|--------|------|
| Pipeline 可视化 UI | Frontend | `PipelineView.tsx` |
| 执行历史 UI | Frontend | `PipelineHistory.tsx` |
| 收敛规则引擎 | Backend | `convergence-rules.ts` |
| 集成测试 | Full | 测试用例 |

#### M3 交付物

- ✅ 标准化 CLI 工具集（Issue/PR/Worktree/Team/Git）
- ✅ Harness 注入引擎（System Prompt 组装）
- ✅ 角色工作流由 Prompt + Harness 驱动
- ✅ Agent 在 Issue 中评论协作
- ✅ 评论默认项目团队可见
- ✅ Pipeline 可视化 UI

---

### 2.4 M4: 收敛机制 + 协作体验 + 并行优化 (2 周)

**目标**：完善收敛、负责人主导协作体验、多 Issue 并行，以及多宿主稳定性。

#### 第 9 周：收敛机制 + 协作体验

| 任务 | 负责人 | 产出 |
|------|--------|------|
| 收敛规则完善 | Backend | 收敛规则 |
| 人工上报机制 | Backend | 上报逻辑 |
| 负责人视图强化 | Frontend | 负责人总结视图 |
| 协作状态 UI | Frontend | 状态展示 |

#### 第 10 周：并行优化 + 多宿主验证

| 任务 | 负责人 | 产出 |
|------|--------|------|
| 并行执行优化 | Backend | 并行优化 |
| 资源约束管理 | Backend | 约束配置 |
| 多宿主流程验证 | Full | local / SSH / WSL / remote |
| 端到端测试 | Full | 完整流程测试 |

#### M4 交付物

- ✅ 收敛规则（轮次上限 / 超时 / scope 冻结）
- ✅ 人工上报机制
- ✅ 负责人主导的对外沟通体验
- ✅ 并行 Issue 优化
- ✅ 多宿主稳定运行

---

## 3. 里程碑与验收标准

### 3.1 M1 验收标准

| # | 验收项 | 标准 |
|---|--------|------|
| M1-1 | Teams CRUD | 可创建/编辑/删除团队成员 |
| M1-2 | Agent 配置 | 可配置 Agent 类型、模型、Skills |
| M1-3 | Prompt 配置 | 可配置默认 Prompt 和性格特质 |
| M1-4 | 删除约束 | 有活跃 worktree 时无法删除成员 |
| M1-5 | 项目接入 | 可从 Orca 已打开项目接入 |
| M1-6 | Git 初始化引导 | 非 Git 项目可提示并执行 `git init` |
| M1-7 | Issues and PRs 面板 | 与 Tasks 并列，按项目显示 |
| M1-8 | 项目团队 | 可从 Teams 邀请成员到项目 |

### 3.2 M2 验收标准

| # | 验收项 | 标准 |
|---|--------|------|
| M2-1 | Issue 工作线 | Issue 创建后自动建立工作线元数据，并初始化 owner ref |
| M2-2 | Worktree 分配 | 任务分配后自动创建成员 worktree |
| M2-3 | Worktree 自动创建 | 分配任务后自动创建 worktree |
| M2-4 | Agent 自动启动 | worktree 中自动启动绑定的 Agent |
| M2-5 | 冲突处理 | 负责人可集成成员提交并处理冲突 |
| M2-6 | Issue 完成 | PR 合并后自动关闭 Issue |

### 3.3 M3 验收标准

| # | 验收项 | 标准 |
|---|--------|------|
| M3-1 | CLI 工具 | Agent 可通过 CLI 操作 Issue/PR/Worktree |
| M3-2 | Harness 注入 | Agent 启动时自动注入角色 Prompt |
| M3-2a | 角色工作流 | 角色流程由 Prompt + Harness 决定，而非硬编码 |
| M3-3 | Agent 评论 | Agent 在 Issue 中发表分析和计划 |
| M3-4 | 评论可见性 | 项目团队成员可查看完整协作评论 |
| M3-5 | Pipeline 可视化 | UI 展示 Pipeline 执行状态 |

### 3.4 M4 验收标准

| # | 验收项 | 标准 |
|---|--------|------|
| M4-1 | Scope 收敛 | 负责人确认后 scope 冻结 |
| M4-2 | 人工上报 | 异常/超时/未收敛时上报 |
| M4-3 | 负责人视图 | UI 默认突出负责人总结与同步 |
| M4-4 | 并行 Issue | 项目可并行处理 ≥3 个 Issue |
| M4-5 | 多宿主支持 | local / SSH / WSL / remote 流程可用 |

---

## 4. 开发任务拆解

### 4.1 开发顺序建议

建议按下面顺序推进，避免前后端因为数据模型反复返工：

1. 单库与数据模型
2. 主进程 Store / Service / IPC
3. 渲染层导航与基础页面
4. Issue → Worktree → Terminal 自动流转
5. Harness / CLI / 协作状态
6. 收敛、异常恢复、验收测试

### 4.2 任务包 A：数据层与基础设施

| 任务 ID | 任务 | 类型 | 主要落点 | 前置依赖 |
| ------ | ------ | ------ | ------ | ------ |
| A1 | 新建协作数据库入口与迁移机制 | Backend | `src/main/*` 协作数据库模块 | 无 |
| A2 | 落地 Teams / Projects / Issues / PRs / Worktrees / Git refs 表结构 | Backend | `collaboration.db` schema | A1 |
| A3 | 定义 zod schema 与领域类型 | Backend | `src/shared/*` 或协作模块类型定义 | A2 |
| A4 | 封装数据库访问层与事务边界 | Backend | `team-store.ts`、`issue-store.ts`、`pr-store.ts` 等 | A2 |
| A5 | 补协作域活动日志与审计记录 | Backend | `activity-log` store | A4 |

**说明**：

- A 任务包完成前，不建议大规模写 UI
- `Issue 工作线`、`issue_git_refs`、`issue_worktrees` 是后续所有流程的基础

### 4.3 任务包 B：主进程协作域服务

| 任务 ID | 任务 | 类型 | 主要落点 | 前置依赖 |
| ------ | ------ | ------ | ------ | ------ |
| B1 | Team Store CRUD | Backend | `team-store.ts` | A4 |
| B2 | Agent 配置与 Skills 绑定 | Backend | `agent-config.ts`、`skill-binding.ts` | A4 |
| B3 | Project 接入与 `git init` 流程 | Backend | `project-store.ts` | A4 |
| B4 | Project Team 管理 | Backend | `project-team-store.ts` | B1, B3 |
| B5 | Issue Store CRUD + 状态流转 | Backend | `issue-store.ts` | A4 |
| B6 | PR Store CRUD + 审批模型 | Backend | `pr-store.ts` | A4 |
| B7 | Git ref 注册器 | Backend | `git-ref-registry.ts` | B5 |
| B8 | 协作 IPC 注册 | Backend | `src/main/ipc/*` 新增协作 handler | B1-B7 |

**现有代码接入点**：

- 主进程 IPC 注册入口：`src/main/index.ts`
- 现有 IPC 目录：`src/main/ipc/`
- Runtime 能力复用：`src/main/runtime/orca-runtime.ts`

### 4.4 任务包 C：渲染层导航与基础页面

| 任务 ID | 任务 | 类型 | 主要落点 | 前置依赖 |
| ------ | ------ | ------ | ------ | ------ |
| C1 | 扩展 `activeView` 支持 `issues-and-prs` / `teams` | Frontend | [ui.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/ui.ts) | 无 |
| C2 | 扩展导航历史与关闭逻辑 | Frontend | `worktree-nav-history.ts`、`ui.test.ts` | C1 |
| C3 | 侧边栏按钮接入与 feature interaction 埋点 | Frontend | Sidebar 导航组件 | C1 |
| C4 | Teams 页面骨架 | Frontend | `TeamsPage.tsx` | B8 |
| C5 | Issues and PRs 页面骨架 | Frontend | `IssuesAndPRsPage.tsx` | B8 |
| C6 | 项目列表 + 项目接入引导 | Frontend | 项目选择 / `git init` 引导 UI | B3, C5 |
| C7 | 项目团队管理 UI | Frontend | `ProjectTeam.tsx` | B4, C5 |
| C8 | Issue 列表 / 详情页 | Frontend | `IssueList.tsx`、`IssueDetail.tsx` | B5, C5 |
| C9 | PR 列表 / 详情页 | Frontend | `PRList.tsx`、`PRDetail.tsx` | B6, C5 |

**现有代码接入点**：

- 顶层视图状态：`src/renderer/src/store/slices/ui.ts`
- 导航测试模式：`src/renderer/src/store/slices/ui.test.ts`
- 面板历史：`src/renderer/src/store/slices/worktree-nav-history.ts`

### 4.5 任务包 D：Issue 驱动执行链路

| 任务 ID | 任务 | 类型 | 主要落点 | 前置依赖 |
| ------ | ------ | ------ | ------ | ------ |
| D1 | Issue 生命周期引擎 | Backend | `issue-lifecycle.ts` | B5, B7 |
| D2 | Worktree 分配器 | Backend | `worktree-allocator.ts` | B7 |
| D3 | 创建成员 worktree 并登记映射 | Backend | `issue-worktree-store.ts` | D2 |
| D4 | 启动成员 terminal 与 Agent | Backend | Runtime / terminal service 集成 | D2 |
| D5 | 负责人集成流程 | Backend | `owner-collaboration.ts` | D1-D4 |
| D6 | Worktree / Terminal 在 Issue 详情中的展示 | Frontend | `IssueDetail.tsx` | D3, D4, C8 |
| D7 | Issue / PR / Worktree 状态联动 | Full | store + UI + IPC | D5, C8, C9 |

**现有能力复用点**：

- `createManagedWorktree`
- `createTerminal`
- 现有 worktree / terminal authority 与 host 上下文

### 4.6 任务包 E：Harness 与协作能力

| 任务 ID | 任务 | 类型 | 主要落点 | 前置依赖 |
| ------ | ------ | ------ | ------ | ------ |
| E1 | Pipeline CLI 设计与实现 | Backend | `pipeline-cli.ts` | B5, B6, D3 |
| E2 | Harness Prompt 注入引擎 | Backend | `harness-engine.ts` | B1, B2, B5 |
| E3 | 角色工作流配置模型 | Backend | Prompt / Harness 配置存储 | B1, B2 |
| E4 | Agent 评论回调与负责人总结识别 | Backend | `owner-collaboration.ts` | E2 |
| E5 | Pipeline 追踪器 | Backend | `pipeline-tracker.ts` | D1, E1 |
| E6 | Pipeline 可视化 UI | Frontend | `PipelineView.tsx` | E5, C8 |
| E7 | 负责人视图强化 | Frontend | Issue detail / summary panel | E4, C8 |

### 4.7 任务包 F：收敛、恢复与质量保障

| 任务 ID | 任务 | 类型 | 主要落点 | 前置依赖 |
| ------ | ------ | ------ | ------ | ------ |
| F1 | 收敛规则引擎 | Backend | `convergence-rules.ts` | E5 |
| F2 | 人工上报与阻塞处理 | Backend | escalation / reporting | F1 |
| F3 | 协作层对账与异常恢复 | Backend | reconciliation service | D3, D4 |
| F4 | 多 Issue 并行资源约束 | Backend | 执行约束与调度 | D4, F1 |
| F5 | 单元测试补齐 | Test | store / service / UI slice 测试 | A-D |
| F6 | 集成测试补齐 | Test | IPC + runtime + DB | B-F |
| F7 | E2E 测试 | Test | Playwright / CDP | C-F |

### 4.8 推荐并行分工

| 角色 | 建议认领 |
| ------ | ------ |
| 后端 1 | A1-A5, B1-B4 |
| 后端 2 | B5-B8, D1-D3 |
| 后端 3 | D4-D5, E1-E5, F1-F4 |
| 前端 1 | C1-C5 |
| 前端 2 | C6-C9, D6, E6-E7 |
| 测试 / 全栈 | D7, F5-F7 |

### 4.9 第一批可直接开工的任务

如果要明天就开始开发，建议先拉下面 10 个任务：

1. A1 协作数据库入口
2. A2 协作表结构
3. B1 Team Store CRUD
4. B3 Project 接入与 `git init`
5. B5 Issue Store CRUD
6. B8 协作 IPC 注册
7. C1 扩展 `activeView`
8. C3 侧边栏按钮接入
9. C4 Teams 页面骨架
10. C5 Issues and PRs 页面骨架

这 10 个任务完成后，项目会进入“有数据骨架、有入口、有基础页面”的状态，后面再推进自动 worktree 和 Harness，就会顺很多。

### 4.10 Jira / Teambition 风格 Ticket 清单

下面这批 Ticket 按“可直接进入开发”的粒度整理，建议作为第一阶段 backlog。

#### TCOLLAB-001 协作数据库入口与迁移机制

- **类型**：Backend
- **对应任务包**：A1
- **描述**：新增协作数据库入口，统一负责 `~/.orca/collaboration.db` 的初始化、版本管理与 schema 迁移执行。
- **主要落点**：`collaboration-database.ts`
- **依赖**：无
- **验收标准**：
  - 应用启动后可自动初始化协作数据库
  - 支持记录 schema version
  - 支持后续迁移脚本顺序执行
  - 初始化失败时有明确错误日志

#### TCOLLAB-002 协作域核心表结构落地

- **类型**：Backend
- **对应任务包**：A2
- **描述**：创建 Teams、Projects、Issues、PRs、Issue Worktrees、Issue Git Refs、Activity Log 等核心表。
- **主要落点**：数据库 schema / migration
- **依赖**：TCOLLAB-001
- **验收标准**：
  - 文档中的核心表均已落库
  - 主键、唯一约束、索引与文档一致
  - 本地可重复执行初始化且无冲突
  - 提供最基本的 schema 测试

#### TCOLLAB-003 Team Store CRUD

- **类型**：Backend
- **对应任务包**：B1
- **描述**：实现 Team 成员的创建、查询、更新、删除能力，支持角色、性格、Prompt、能力等字段。
- **主要落点**：`team-store.ts`
- **依赖**：TCOLLAB-002
- **验收标准**：
  - 可新增、编辑、查询、删除成员
  - 删除前可校验是否仍存在活跃 worktree
  - 返回结构与前端表单一致
  - 包含单元测试

#### TCOLLAB-004 Agent 配置与 Skills 绑定

- **类型**：Backend
- **对应任务包**：B2
- **描述**：实现成员绑定 Agent、模型、默认 Prompt、Skills 的持久化与读取。
- **主要落点**：`agent-config.ts`、`skill-binding.ts`
- **依赖**：TCOLLAB-002, TCOLLAB-003
- **验收标准**：
  - 每个成员可配置一个 Agent
  - 可配置默认 Prompt 与 Skills 列表
  - 配置可从 DB 正确读写
  - 敏感字段遵循现有安全方案

#### TCOLLAB-005 Project 接入与 Git 初始化

- **类型**：Backend
- **对应任务包**：B3
- **描述**：将 Orca 已打开文件夹接入协作域；若非 Git 仓库则支持执行 `git init`。
- **主要落点**：`project-store.ts`
- **依赖**：TCOLLAB-002
- **验收标准**：
  - 能识别当前项目是否为 Git 仓库
  - 非 Git 项目可触发 `git init`
  - 接入后的项目可写入协作数据库
  - 复用 Orca 现有宿主与 Git 执行能力

#### TCOLLAB-006 Issue Store CRUD 与状态流转

- **类型**：Backend
- **对应任务包**：B5
- **描述**：实现 Issue 的创建、查询、更新、状态流转、评论基础能力，并落地 `workline_key`。
- **主要落点**：`issue-store.ts`
- **依赖**：TCOLLAB-002, TCOLLAB-005
- **验收标准**：
  - 可创建 Issue 并生成 `issue-{n}` 工作线标识
  - 支持 `intake / planning / in_progress / review / blocked / done / cancelled`
  - 支持项目团队可见评论流
  - 包含状态流转测试

#### TCOLLAB-007 PR Store CRUD 与基础关联

- **类型**：Backend
- **对应任务包**：B6
- **描述**：实现 PR 的创建、查询、状态更新，并支持与 Issue、项目默认分支关联。
- **主要落点**：`pr-store.ts`
- **依赖**：TCOLLAB-002, TCOLLAB-006
- **验收标准**：
  - 可创建 PR 并关联 Issue
  - 支持 `draft / open / changes_requested / ready_to_merge / merged / closed`
  - 可记录 reviewer 与 approval 信息
  - 包含单元测试

#### TCOLLAB-008 协作 IPC 注册

- **类型**：Backend
- **对应任务包**：B8
- **描述**：新增 Teams / Projects / Issues / PRs 相关 IPC handlers，供渲染层调用。
- **主要落点**：`src/main/ipc/`
- **依赖**：TCOLLAB-003, TCOLLAB-004, TCOLLAB-005, TCOLLAB-006, TCOLLAB-007
- **验收标准**：
  - 文档中定义的核心 IPC 已注册
  - IPC 参数校验完整
  - 返回值结构稳定
  - 至少包含一组 handler 测试

#### TCOLLAB-009 扩展 activeView 支持新面板

- **类型**：Frontend
- **对应任务包**：C1
- **描述**：在 UI 状态中新增 `issues-and-prs` 与 `teams` 视图，接入打开、关闭、历史回退逻辑。
- **主要落点**：[ui.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/ui.ts)
- **依赖**：无
- **验收标准**：
  - 可打开 `issues-and-prs` 与 `teams`
  - 视图切换与历史回退行为符合现有模式
  - 持久化后的 `activeView` 可恢复
  - 补充对应测试

#### TCOLLAB-010 侧边栏导航接入新入口

- **类型**：Frontend
- **对应任务包**：C3
- **描述**：在 Orca 左侧导航中新增 `Issues and PRs` 与 `Teams` 入口，保持与现有样式和交互一致。
- **主要落点**：Sidebar 导航组件
- **依赖**：TCOLLAB-009
- **验收标准**：
  - 左侧导航显示两个新入口
  - 点击后可切换到对应视图
  - 图标、间距、激活态符合现有风格
  - 不影响 Tasks / Automations / Search 现有行为

#### TCOLLAB-011 Teams 页面骨架

- **类型**：Frontend
- **对应任务包**：C4
- **描述**：实现 Teams 页面基础结构，支持成员列表、详情抽屉或编辑面板、创建按钮。
- **主要落点**：`TeamsPage.tsx`
- **依赖**：TCOLLAB-008, TCOLLAB-010
- **验收标准**：
  - 可展示成员列表
  - 可打开创建/编辑表单
  - 至少展示 Agent、Model、Prompt、Skills 摘要
  - 空状态与加载态完整

#### TCOLLAB-012 Issues and PRs 页面骨架

- **类型**：Frontend
- **对应任务包**：C5
- **描述**：实现 Issues and PRs 主页面骨架，支持项目切换、Issue/PR 两类列表区域和详情区域。
- **主要落点**：`IssuesAndPRsPage.tsx`
- **依赖**：TCOLLAB-008, TCOLLAB-010
- **验收标准**：
  - 可展示项目列表
  - 可切换 Issue / PR 视图
  - 可加载项目级 Issue 列表
  - 页面结构支持后续接入工作线、worktree、pipeline 面板

#### TCOLLAB-013 Project Team 管理 UI

- **类型**：Frontend
- **对应任务包**：C7
- **描述**：在项目内支持从 Teams 邀请成员进入项目团队，并展示负责人标识。
- **主要落点**：`ProjectTeam.tsx`
- **依赖**：TCOLLAB-008, TCOLLAB-011, TCOLLAB-012
- **验收标准**：
  - 可从公司 Teams 中选择成员加入项目
  - 可展示项目团队当前成员
  - 可指定或变更负责人
  - 成员移除受活跃 worktree 约束

#### TCOLLAB-014 Issue 生命周期引擎与工作线初始化

- **类型**：Backend
- **对应任务包**：D1
- **描述**：实现 Issue 创建后的工作线初始化、负责人通知、任务分配入口。
- **主要落点**：`issue-lifecycle.ts`
- **依赖**：TCOLLAB-006, TCOLLAB-008
- **验收标准**：
  - 创建 Issue 后自动初始化工作线元数据
  - 自动初始化 owner ref
  - 可触发负责人收到待处理任务
  - 生命周期事件有活动日志

#### TCOLLAB-015 Worktree 分配与 Agent 启动

- **类型**：Backend
- **对应任务包**：D2, D4
- **描述**：基于 Issue 分配成员 worktree，并复用 Orca Runtime 启动 terminal 与绑定 Agent。
- **主要落点**：`worktree-allocator.ts`
- **依赖**：TCOLLAB-014
- **验收标准**：
  - 每个 Issue-Member 最多一个 worktree
  - worktree 能关联到底层 Git ref
  - terminal 能随 worktree 启动
  - hostId / hostType 上下文贯穿执行链路

#### TCOLLAB-016 Harness 注入与 Agent 评论回调

- **类型**：Backend
- **对应任务包**：E2, E4
- **描述**：为 Agent 注入角色 Prompt / Skills / 当前 Issue 上下文，并接收 Agent 评论写回 Issue。
- **主要落点**：`harness-engine.ts`、`owner-collaboration.ts`
- **依赖**：TCOLLAB-004, TCOLLAB-006, TCOLLAB-015
- **验收标准**：
  - Agent 启动时可注入完整上下文
  - Agent 评论可回写到 Issue
  - 负责人评论可被识别为总结消息
  - 评论默认项目团队可见

---

## 5. 技术依赖

| 依赖 | 用途 | 状态 |
|------|------|------|
| better-sqlite3 | 本地数据存储 | 需新增 |
| zod（已有） | Schema 验证 | 已有 |
| Zustand（已有） | 前端状态管理 | 已有 |
| Electron IPC（已有） | 主 ↔ 渲染通信 | 已有 |
| Orca Runtime（已有） | Worktree / Terminal / Host 执行 | 已有 |

---

## 6. 风险管理

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 多成员代码冲突 | 中 | 高 | worktree 隔离 + 底层 Git 引用隔离 + 负责人集中集成 |
| Agent 协作效率低 | 中 | 高 | 收敛规则 + 上报机制 + 人工兜底 |
| 非 Git 项目无法进入流程 | 中 | 中 | 明确 `git init` 引导 |
| 多宿主行为差异 | 中 | 高 | 产品层只区分有 Git / 没有 Git，其余执行全部复用 Orca |
| 评论过多影响阅读 | 中 | 中 | UI 强化负责人总结视图 |

---

## 7. 成功指标

| 指标 | 目标 | 说明 |
|------|------|------|
| Issue 自主完成率 | > 50% | 无需人类深度介入完成的 Issue 比例 |
| 平均 Issue 处理时间 | < 4h | 创建到关闭的中位时间 |
| 人工介入率 | < 30% | 需要人类介入的 Issue 比例 |
| 并行 Issue 处理数 | ≥ 3 | 单项目同时处理的 Issue 数 |
| 多宿主成功率 | > 95% | local / SSH / WSL / remote 核心流程成功率 |
