# Orca 团队协作功能 - 产品研发迭代规划

> 版本: v3.0 | 日期: 2026-08-13 | 状态: 修订版

---

## 1. 总体规划

### 1.1 迭代原则

- **Teams 是公司级**：成员可跨项目、跨 Issue 拥有多个 worktree
- **项目团队从 Teams 抽调**：项目成员必须是公司 Teams 中的成员
- **Issue 驱动分支**：每个 Issue 一个分支，完成后合并
- **单一联系人**：每个 Issue 只有一个成员负责与用户沟通
- **复用 Tasks 能力**：不修改 Tasks，在侧边栏导航中新增并列的 Issues and PRs 和 Teams 按钮

### 1.2 时间线概览

```
2026 Q3                          2026 Q4                         2027 Q1
│───────────────│──────────────────│──────────────────│───────────────│
    M1: Teams + 项目 +    M2: Issue 驱动       M3: Pipeline        M4: 收敛 +
    Issues and PRs 基础    + 分支/Worktree       Harness            单一联系人
    (3 周)                 自动分配 (2 周)       + Agent 协作        + 并行优化
                            (3 周)                (2 周)
```

---

## 2. 迭代详细计划

### 2.1 M1: Teams + 项目 + Issues and PRs 基础 (3 周)

**目标**：创建公司 Teams 管理层，创建 Issues and PRs 面板，实现基础 Issue/PR 管理

#### 第 1 周：Teams 管理

| 任务 | 负责人 | 预估 | 产出 |
|------|--------|------|------|
| Teams 数据库 schema | Backend | 0.5d | `teams-database.ts` |
| Team Store CRUD | Backend | 1d | `team-store.ts` |
| Agent 配置模型 | Backend | 1d | `agent-config.ts` |
| Skills 绑定 | Backend | 0.5d | `skill-binding.ts` |
| Teams IPC handlers | Backend | 0.5d | `ipc.ts` |
| Teams UI（成员列表+编辑） | Frontend | 2d | `TeamsPage.tsx` |

#### 第 2 周：项目 + Issue 存储

| 任务 | 负责人 | 预估 | 产出 |
|------|--------|------|------|
| Collaboration 数据库 schema | Backend | 1d | `collab-database.ts` |
| Project Store CRUD | Backend | 0.5d | `project-store.ts` |
| Issue Store CRUD | Backend | 1.5d | `issue-store.ts` |
| Project Team Store | Backend | 1d | `project-team-store.ts` |
| Issue IPC handlers | Backend | 1d | `ipc.ts` |

#### 第 3 周：Issues and PRs UI + 项目团队 UI

| 任务 | 负责人 | 预估 | 产出 |
|------|--------|------|------|
| Issues and PRs 面板框架 | Frontend | 1d | `IssuesAndPRsPage.tsx` |
| Issue 列表 + 详情 UI | Frontend | 1.5d | `IssueList.tsx`, `IssueDetail.tsx` |
| Issue 评论 UI | Frontend | 1d | 评论组件 |
| 项目团队管理 UI | Frontend | 1d | `ProjectTeam.tsx` |
| 集成测试 | Full | 0.5d | 测试用例 |

#### M1 交付物

- ✅ Teams 管理（创建/编辑/删除成员，配置 Agent/Model/Skills/Prompt）
- ✅ 删除成员约束（所有 worktree 已关闭）
- ✅ Issues and PRs 面板（与 Tasks 并列）
- ✅ 按项目显示 Issue/PR
- ✅ Issue CRUD + 评论 + 状态流转
- ✅ 项目团队管理（邀请/移除成员）

---

### 2.2 M2: Issue 驱动开发 + 分支/Worktree 自动分配 (2 周)

**目标**：Issue 创建后自动创建分支，分配成员 worktree，启动 Agent

#### 第 4 周：Issue → Branch → Worktree

| 任务 | 负责人 | 预估 | 产出 |
|------|--------|------|------|
| Issue 生命周期引擎 | Backend | 1.5d | `issue-lifecycle.ts` |
| Worktree 分配器 | Backend | 1.5d | `worktree-allocator.ts` |
| Issue-Worktree 映射表 | Backend | 0.5d | 数据库 schema |
| 分支创建（复用 git） | Backend | 0.5d | 分支创建 |
| Worktree 创建（复用 runtime） | Backend | 0.5d | 复用集成 |

#### 第 5 周：Agent 启动 + 单一联系人

| 任务 | 负责人 | 预估 | 产出 |
|------|--------|------|------|
| Agent 启动集成 | Backend | 1d | Agent 启动 |
| 单一联系人机制 | Backend | 1d | `single-contact.ts` |
| Issue 详情中 Worktree 展示 | Frontend | 1d | Worktree 面板 |
| 负责人分配 UI | Frontend | 0.5d | 分配组件 |
| 端到端测试 | Full | 0.5d | 测试用例 |

#### M2 交付物

- ✅ Issue 创建 → 自动创建分支
- ✅ 负责人分配任务 → 自动创建 worktree + Terminal
- ✅ 每个 Issue 每个成员只有一个 worktree
- ✅ 单一联系人机制
- ✅ Issue 完成后自动合并分支 + 关闭 worktree

---

### 2.3 M3: Pipeline Harness + Agent 协作 (3 周)

**目标**：实现标准化 CLI 工具集 + Harness 注入 + Agent 协作

#### 第 6 周：CLI 工具集

| 任务 | 负责人 | 预估 | 产出 |
|------|--------|------|------|
| Issue CLI | Backend | 0.5d | `pipeline-cli.ts` |
| PR CLI | Backend | 0.5d | `pipeline-cli.ts` |
| Worktree/Git CLI | Backend | 0.5d | `pipeline-cli.ts` |
| Team CLI | Backend | 0.5d | `pipeline-cli.ts` |
| CLI 注册到 Agent 环境 | Backend | 1d | CLI 集成 |
| Agent 调用 IPC | Backend | 0.5d | IPC 集成 |

#### 第 7 周：Harness 注入 + Agent 协作

| 任务 | 负责人 | 预估 | 产出 |
|------|--------|------|------|
| Harness 注入引擎 | Backend | 1.5d | `harness-engine.ts` |
| System Prompt 模板 | Backend | 0.5d | Prompt 模板 |
| Agent 评论回调 | Backend | 1d | 回调处理 |
| Pipeline 追踪器 | Backend | 1d | `pipeline-tracker.ts` |

#### 第 8 周：Pipeline UI

| 任务 | 负责人 | 预估 | 产出 |
|------|--------|------|------|
| Pipeline 可视化 UI | Frontend | 1.5d | `PipelineView.tsx` |
| 执行历史 UI | Frontend | 1d | `PipelineHistory.tsx` |
| 收敛规则引擎 | Backend | 1d | `convergence-rules.ts` |
| 集成测试 | Full | 0.5d | 测试用例 |

#### M3 交付物

- ✅ 标准化 CLI 工具集（Issue/PR/Worktree/Team/Git）
- ✅ Harness 注入引擎（System Prompt 组装）
- ✅ Agent 在 Issue 中评论协作
- ✅ Pipeline 可视化 UI
- ✅ 收敛规则引擎

---

### 2.4 M4: 收敛机制 + 单一联系人 + 并行优化 (2 周)

**目标**：完善收敛机制，实现单一联系人，优化并行执行

#### 第 9 周：收敛机制 + 单一联系人完善

| 任务 | 负责人 | 预估 | 产出 |
|------|--------|------|------|
| 收敛规则完善 | Backend | 1d | 收敛规则 |
| 人工上报机制 | Backend | 1d | 上报逻辑 |
| 单一联系人流程完善 | Backend | 1d | 单一联系人 |
| 收敛状态 UI | Frontend | 1d | 收敛展示 |

#### 第 10 周：并行优化 + 端到端测试

| 任务 | 负责人 | 预估 | 产出 |
|------|--------|------|------|
| 并行执行优化 | Backend | 1d | 并行优化 |
| 资源约束管理 | Backend | 0.5d | 约束配置 |
| 成员活跃 worktree 展示 | Frontend | 1d | 状态展示 |
| 端到端测试 | Full | 1d | 完整流程测试 |

#### M4 交付物

- ✅ 收敛规则（轮次上限/超时/scope 冻结）
- ✅ 人工上报机制
- ✅ 单一联系人流程完善
- ✅ 并行执行优化
- ✅ 完整端到端流程

---

## 3. 里程碑与验收标准

### 3.1 M1 验收标准

| # | 验收项 | 标准 |
|---|--------|------|
| M1-1 | Teams CRUD | 可创建/编辑/删除团队成员 |
| M1-2 | Agent 配置 | 可配置 Agent 类型、模型、Skills |
| M1-3 | Prompt 配置 | 可配置默认 Prompt 和性格特质 |
| M1-4 | 删除约束 | 有活跃 worktree 时无法删除成员 |
| M1-5 | Issues and PRs 面板 | 与 Tasks 并列，按项目显示 |
| M1-6 | Issue CRUD | 可创建/编辑/删除 Issue，支持状态流转 |
| M1-7 | Issue 评论 | 可添加评论 |
| M1-8 | 项目团队 | 可从 Teams 邀请成员到项目 |

### 3.2 M2 验收标准

| # | 验收项 | 标准 |
|---|--------|------|
| M2-1 | Issue → 分支 | Issue 创建后自动创建分支 |
| M2-2 | 任务分配 | 负责人可分配任务给团队成员 |
| M2-3 | Worktree 自动创建 | 分配任务后自动创建 worktree |
| M2-4 | Agent 自动启动 | worktree 中自动启动绑定的 Agent |
| M2-5 | 单一联系人 | 只有负责人与用户直接沟通 |
| M2-6 | Issue 完成 | PR 合并后自动关闭 Issue |

### 3.3 M3 验收标准

| # | 验收项 | 标准 |
|---|--------|------|
| M3-1 | CLI 工具 | Agent 可通过 CLI 操作 Issue/PR/Worktree |
| M3-2 | Harness 注入 | Agent 启动时自动注入角色 Prompt |
| M3-3 | Agent 评论 | Agent 在 Issue 中发表分析和计划 |
| M3-4 | Pipeline 可视化 | UI 展示 Pipeline 执行状态 |
| M3-5 | 收敛规则 | 轮次/超时时正确触发上报 |

### 3.4 M4 验收标准

| # | 验收项 | 标准 |
|---|--------|------|
| M4-1 | Scope 收敛 | PM 确认后 scope 冻结 |
| M4-2 | 人工上报 | 异常/超时/未收敛时上报 |
| M4-3 | 单一联系人 | 用户只与负责人沟通 |
| M4-4 | 并行 Issue | 项目可并行处理 ≥3 个 Issue |
| M4-5 | 全流程 | Issue 创建 → 分支 → 开发 → PR → 合并 → 关闭 |

---

## 4. 资源需求

### 4.1 团队配置

| 角色 | 人数 | 职责 |
|------|------|------|
| 后端工程师 | 2 | Store、Engine、IPC、Harness |
| 前端工程师 | 2 | Store、组件、Pipeline 可视化 |
| 测试工程师 | 1 | 单元/集成/E2E 测试 |
| 产品经理 | 0.5 | 需求细化、验收 |

### 4.2 技术依赖

| 依赖 | 用途 | 状态 |
|------|------|------|
| better-sqlite3 | 本地数据存储 | 需新增 |
| zod (已有) | Schema 验证 | 已有 |
| Zustand (已有) | 前端状态管理 | 已有 |
| Electron IPC (已有) | 主↔渲染通信 | 已有 |

---

## 5. 风险管理

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Agent CLI 兼容性差异大 | 高 | 中 | 前期调研 Top 5 Agent，抽象 CLI 层 |
| 需求 scope 膨胀 | 高 | 高 | 负责人审批机制 + 轮次上限 + 超时上报 |
| 多 Agent 并发冲突 | 中 | 中 | 独立 worktree + branch 隔离 |
| Pipeline 涌现不准确 | 中 | 中 | 规则 + 人类可修正 |
| 与现有功能冲突 | 低 | 高 | 功能开关 + 灰度发布 |

---

## 6. 依赖与并行

### 6.1 依赖图

```
M1 (Teams + 项目 + Issues and PRs)
  │
  ▼
M2 (Issue 驱动 + 分支/Worktree)
  │
  ▼
M3 (Pipeline Harness + Agent 协作)
  │
  ▼
M4 (收敛 + 单一联系人 + 并行优化)
```

### 6.2 可并行任务

| 周期 | 并行任务 |
|------|---------|
| M1 Week 1 | Team Store 与 Agent 配置并行 |
| M1 Week 3 | Issue UI 与 Project Team UI 并行 |
| M2 Week 5 | Agent 启动与单一联系人并行 |
| M3 Week 8 | Pipeline UI 与收敛规则并行 |
| M4 Week 10 | 并行优化与 UI 优化并行 |

---

## 7. 发布策略

| 里程碑 | 发布形式 | 目标用户 |
|--------|---------|---------|
| M1 | RC 版本 | 内部测试 |
| M2 | RC 版本 | 内部测试 |
| M3 | Beta 版本 | 早期用户 |
| M4 | 正式版本 | 全部用户 |

### 功能开关

```yaml
# orca.yaml
experimental:
  teamsManagement: true              # M1
  issuesAndPRsPanel: true            # M1
  projectTeamManagement: true        # M1
  issueDrivenDevelopment: true       # M2
  worktreeAutoAllocation: true       # M2
  singleContactMechanism: true       # M2
  pipelineHarness: true              # M3
  convergenceRules: true             # M3
  parallelIssueProcessing: true      # M4
```

---

## 8. 成功指标

### 8.1 开发指标

| 指标 | 目标 |
|------|------|
| 代码覆盖率 | > 70% |
| Pipeline 执行成功率 | > 75% |
| Bug 逃逸率 | < 5% |

### 8.2 产品指标

| 指标 | 目标 | 测量方式 |
|------|------|---------|
| Issue 自主完成率 | > 50% | 无需人类干预完成的 Issue 比例 |
| 平均 Issue 处理时间 | < 4h | 创建到关闭的中位时间 |
| Scope 收敛率 | > 85% | 无膨胀完成 / 总完成 |
| 人工介入率 | < 30% | 需要人类干预的 Issue 比例 |
| 并行 Issue 处理数 | ≥ 3 | 单项目同时处理的 Issue 数 |

---

## 9. 后续规划 (Post-M4)

### 9.1 短期 (M5-M6)

| 功能 | 描述 |
|------|------|
| 远程同步 | Issue/PR 与 GitHub/GitLab 双向同步 |
| Pipeline 优化 | 基于历史数据优化涌现算法 |
| Agent 能力矩阵 | 自动分析 Agent 能力并推荐绑定 |

### 9.2 中期 (M7-M9)

| 功能 | 描述 |
|------|------|
| AI 任务分解 | LLM 自动将 Issue 分解为子任务 |
| 团队效能分析 | 基于活动日志的团队效能报告 |
| 智能 Review | Agent Review 结果自动修复 |

### 9.3 长期 (M10+)

| 功能 | 描述 |
|------|------|
| 多团队协作 | 跨团队任务协作与依赖管理 |
| 外部 Agent 市场 | 第三方 Agent 插件集成 |
| 云端同步 | 团队配置云端同步与备份 |
