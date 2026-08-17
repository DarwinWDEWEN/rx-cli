# Orca 团队协作模块 - 进度追踪

> 用途：站在 ROADMAP 角度追踪当前进度、已完成/未完成对照、依赖链缺口与下一步方向，避免迭代偏差。
> 维护约定：每轮迭代收口后更新本文档（§4 索引、§3 状态、§7 估算、§8 序列）。

## 1. 项目状态总览（2026-08-17）

**定位**：在 Orca（Electron 桌面端 AI 协作编码工具）之上叠加团队协作模块。当前处于 **M1 后端收口 + M3 Harness 基础提前完成 + M1 前端基础（C1-C5）落地** 的阶段——进度呈"跳跃式"，不是按 M1→M2→M3 线性推进。R9 收口后 M1 首次"可见可用"（两个协作入口 + Teams/IssuesPRs 页面骨架 + preload 20 通道打通）。

```mermaid
flowchart LR
    M1[M1 Teams+项目+IssuesPRs<br/>后端~90% / 前端基础 C1-C5] --> M2[M2 Issue驱动+Worktree<br/>0%]
    M2 --> M3[M3 Pipeline Harness<br/>后端核心~60% / 前端 0%]
    M3 --> M4[M4 收敛+协作体验<br/>0%]
    style M1 fill:#bbdefb,color:#0d47a1
    style M2 fill:#fff3e0,color:#e65100
    style M3 fill:#bbdefb,color:#0d47a1
    style M4 fill:#fff3e0,color:#e65100
```

**当前测试基线**：后端 8 文件 / 106 tests 全绿（`tsc --noEmit -p config/tsconfig.node.json` exit 0）；渲染层 7 文件 / 254 tests 全绿（`tsc web` 无新增错误，16 个 TS6307 为预存）；协作库 `SCHEMA_VERSION = 5`。

## 2. 里程碑进度对照

| 里程碑 | 范围（ROADMAP §2） | 当前状态 | 缺口 |
|--------|--------------------|----------|------|
| M1 Teams + 项目接入 + IssuesPRs 基础 | 第 1-3 周 | 后端完成大部分；前端基础（C1-C5）落地 | B2/B6/B7/A5 后端；C6-C9 前端 |
| M2 Issue 驱动 + Worktree 自动分配 | 第 4-5 周 | 未开始 | D1-D7 全部 |
| M3 Pipeline Harness + Agent 协作 | 第 6-8 周 | Harness 骨架完成（E2 系列 + E4） | E1/E3/E5/E6/E7 + convergence-rules |
| M4 收敛机制 + 协作体验 + 并行优化 | 第 9-10 周 | 未开始 | F1-F7 全部 |

## 3. 任务包状态矩阵

| 任务包 | 内容 | 状态 | 详情 |
|--------|------|------|------|
| A 数据层与基础设施 | A1-A5 | **80%** | A1 ✅ 数据库入口+迁移；A2 ✅ 10 张表（v5）；A3 ✅ 领域类型；A4 ✅ Store 层封装；**A5 activity-log ❌** |
| B 主进程协作域服务 | B1-B8 | **60%** | B1 ✅ TeamStore；B3 ✅ ProjectStore（markGitInitialized）；B4 ✅ 项目团队（project-store 内）；B5 ✅ IssueStore；B8 ✅ 协作 IPC（team/project/issue，无 PR）；**B2 agent-config ❌、B6 pr-store ❌、B7 git-ref-registry ❌** |
| C 渲染层导航与基础页面 | C1-C9 | **55%** | **C1 ✅ activeView 扩展 + C2 ✅ 导航历史扩展 + C3 ✅ Sidebar Teams/IssuesPRs 入口 + C4 ✅ TeamsPage 骨架 + C5 ✅ IssuesAndPRsPage 骨架**（含 preload team/project/issue 20 通道暴露、竞态/编辑测试、254 渲染层 tests、TCOLLAB-010/011/012 骨架验收）；C6-C9 未开始 |
| D Issue 驱动执行链路 | D1-D7 | **0%** | 全部未开始（生命周期/worktree 分配/terminal+Agent 启动/状态联动） |
| E Harness 与协作能力 | E1-E7 | **45%** | E2 ✅ harness-engine；E2a ✅ execution-context；E2b ✅ agent-runner(+withPolicy)；E2c ✅ stream-event-normalizer；E4 ✅ owner-collaboration(+issue-comment-store)；**E1 pipeline-cli ❌、E3 角色工作流配置 ❌、E5 pipeline-tracker ❌、E6/E7 UI ❌** |
| F 收敛、恢复与质量保障 | F1-F7 | **0%** | 全部未开始 |

## 4. 已完成迭代记录索引

| 迭代 | 沉淀文档 | 核心产出 |
|------|----------|----------|
| R2 | `multi-agent-iteration/2026-08-14-round2-review-fix.md` | 数据层 MVP 审查收口（TeamStore + DB，canDelete 门禁） |
| R3 | `multi-agent-iteration/2026-08-14-round3-project-issue-store.md` | B3 ProjectStore + B5 IssueStore；git 状态改纯持久化 |
| R4 | `multi-agent-iteration/2026-08-14-round4-store-hardening.md` | Store 加固：removeMember worktree/issue 校验、owner ∈ 项目团队 |
| R5 | `multi-agent-iteration/2026-08-14-round5-collaboration-ipc.md` | B8 协作 IPC（team.* / project.* / issue.* + Zod 校验） |
| R6 | `multi-agent-iteration/2026-08-17-round6-harness-foundation.md` | E2 系列：上下文快照/Prompt 分层/Runner 统一接口/事件归一化/withPolicy |
| R7 | `multi-agent-iteration/2026-08-17-round7-owner-collaboration.md` | E4 评论回写闭环 + IssueCommentStore（含 A/B 收口） |
| R8 | `multi-agent-iteration/2026-08-17-round8-activeview-nav-history.md` | C1-C2 前端基础：activeView 支持 issues-and-prs/teams + 导航历史扩展（208 渲染层 tests） |
| R9 | `multi-agent-iteration/2026-08-17-round9-sidebar-teams-issues-pages.md` | C3-C5: Sidebar Teams/IssuesPRs 入口 + Teams/IssuesPRs 页骨架 + preload 20 通道暴露（254 渲染层 tests）；经两轮复核修复（竞态/编辑/字段/文档数字/lint 清零） |

## 5. 已确立的硬性约定（防偏差的关键，后续每轮必须遵守）

1. **Project = Orca 打开的文件夹**；Teams 是公司级，项目团队从 Teams 抽调，成员必须 ∈ 项目团队才可执行任务
2. **owner 必须属于项目团队**（Issue create/update/reopen 均校验，`assertOwnerInProject` 模式）
3. **删除保护**：`TeamStore.delete()` / `removeMember()` 必须经 `canDelete()` 门禁（活跃 worktree / 项目 / Issue / PR 约束）
4. **Git 状态只经 `markGitInitialized` 写回**，Store 层不做本地探测；host-aware 探测属 IPC/runtime 层
5. **Harness 是运行时约束层，不是固定流程模板**；Prompt 分层（systemPrompt=角色/规则，userPrompt=场景/任务）；运行时上下文必须显式
6. **worktreePath 是真实文件系统路径，不是 worktree 实体 ID**
7. **评论默认项目团队可见**，不做内外隔离；负责人是推荐对外同步者，不封堵成员评论
8. **确定性总结，不用 LLM** 生成运行总结（事实由系统落库）
9. **数据库用 `node:sqlite`**（技术决策，偏离 ROADMAP 原文的 better-sqlite3）；`PRAGMA foreign_keys = ON`；迁移用 `PRAGMA user_version` 事务包裹；POSIX `chmodSync(0o600)`
10. **禁止重犯清单**（源自 R6，后续所有轮次自查）：不用 fixture 掩盖缺口 / 无虚假声明 / 无死代码 / 不漏 invariant / 不语义混淆 / 文档数字与实现一致 / 不扩大范围

## 6. 依赖链缺口与风险

| 缺口 | 影响 | 处理建议 |
|------|------|----------|
| **E5 依赖 E1 + D1** | pipeline-tracker 无法开工 | E1 CLI 最小版（`orca issue comment` / `orca issue update`）优先于 E5 |
| **E2b 真实 runner 依赖 E1** | 目前只有 Mock runner | E1 落地后接真实 CLI 适配；同时补 `AbortController` 取消机制（R6 遗留观察项） |
| **C 系列前端依赖 B8（已完成）** | 前端 C1-C5 已落地 | C6-C9（项目接入引导 + 项目团队 UI + Issue/PR 详情）是当前性价比最高的下一步 |
| **D2/D4 依赖 Orca Runtime 集成** | worktree 分配 + terminal/Agent 启动未落地 | 需接 `createManagedWorktree` / `createTerminal`；M2 是"骨架→真实运行"的关键一跳 |
| **B6 PR Store 缺失** | B8 IPC 无 PR、C9/PR UI 无依赖 | M1 收口时补 |
| **多宿主（SSH/WSL/remote）** | 现有代码以 local 为主 | 按 ROADMAP M4-5 验收标准，产品层只分有 Git/无 Git，执行复用 Orca |

## 7. 剩余工作量估算

按"每轮一个最小闭环"粒度：

| 阶段 | 任务 | 预估 Round |
|------|------|-----------|
| M1 收口（后端） | B6 PR Store+IPC / B7 git-ref / B2 agent-config / A5 activity-log | 2 |
| M1 交付（前端） | C6-C9（项目接入引导 + 项目团队 UI + Issue/PR 列表详情；C1-C5 已完成） | 2 |
| M2 Issue 驱动 | D1-D5（生命周期 + worktree 分配 + terminal/Agent 启动 + 负责人集成） | 3 |
| M2 联动 | D6-D7（Issue 详情 worktree 展示 + 状态联动） | 1 |
| M3 收口（后端） | E1 CLI → E5 tracker → E3 角色工作流配置 | 3 |
| M3 收口（前端） | E6 Pipeline 可视化 + E7 负责人视图 | 1-2 |
| M4 收敛 | F1-F4（收敛规则 + 上报 + 对账 + 并行约束） | 2-3 |
| 质量收尾 | F5-F7（测试补齐 + 集成 + E2E） | 2 |

**合计：约 16-18 个 Round 剩余**（约等于 ROADMAP 剩余 7 周左右规划量）。估算为相对粒度，实际受任务大小影响。

## 8. 建议的下一步序列（当前建议）

```
Round 8:   ✅ C1-C2  activeView 扩展 + 导航历史（前端基础，已收口）
Round 9:   ✅ C3-C5  Sidebar 入口 + Teams 页 + IssuesPRs 页骨架（前端骨架，已收口）
Round 10:  E1     Pipeline CLI 最小版（解锁 E5，打通 Agent 真实执行链）
Round 11:  C6     M1 项目接入引导（前端可见可用）或 D1+B7（解锁 worktree 链路）
Round 12:  E5/D   视 E1 节奏补 pipeline-tracker / worktree 分配
```

原则：**先补前端让 M1 可见可用，再回后端打通 E1/D 依赖链**，保证每轮有可演示闭环。若排期冲突，优先级为：C 系列（M1 可用性）> E1（解锁 E5 与真实 runner）> D 系列（M2）。

## 9. 当前状态校验命令

```bash
PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH" pnpm vitest run src/main/runtime/collaboration/*.test.ts src/main/ipc/collaboration-ipc.test.ts src/main/runtime/pipeline/*.test.ts
PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH" pnpm tsc --noEmit -p config/tsconfig.node.json
```

> 预期：8 文件 / 106 tests 全绿；tsc exit 0。
