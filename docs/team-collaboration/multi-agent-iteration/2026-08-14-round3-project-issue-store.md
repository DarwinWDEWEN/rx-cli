# Round 3 — B3 Project Store + B5 Issue Store

> 日期: 2026-08-14 | 阶段: M1 后端数据层闭环 | 任务: B3 + B5

## 1. 本轮目标

完成后端数据层第二步闭环：

1. **B3 Project Store**：项目接入、查询、列表、更新、git 状态同步、项目团队成员管理
2. **B5 Issue Store**：Issue CRUD、worklineKey 自动生成、状态流转

## 2. 接入点分析

### 复用的 Orca 现有能力

| 能力 | 位置 | 本轮复用方式 |
| ------ | ------ | -------------- |
| `isGitRepo` | `src/main/git/repo.ts` | Project Store 内调用，判断目录是否已 Git 初始化 |
| `getGitRepoRoot` | `src/main/git/repo.ts` | 未直接调用（本轮不做 git init 执行，只做状态检查） |
| `gitExecFileAsync` | `src/main/git/runner.ts` | 未调用（git init 执行属于 IPC 层职责） |
| `connectionId` / `executionHostId` | Orca Repo 类型 | 映射为协作 schema 的 hostId / hostType |

### 关键设计决策

**为什么 Project Store 不直接执行 `git init`？**

TECH-DESIGN §4.1 的伪代码调用了 `gitRunner.init(project.repoPath, { hostId })`，但这属于 **IPC 层职责**——git 执行需要路由到正确的 host provider（本地/SSH/WSL/remote）。Project Store 作为数据层，只应：

- 接受上层传入的 `gitInitialized` 初始值
- 通过 `syncGitStatus()` 主动检查文件系统状态（调用纯函数 `isGitRepo`）
- 提供 `markGitInitialized()` 供 IPC 层在真实 init 完成后回调

这样数据层保持可测试性（不依赖 IPC/SSH），且 git 执行仍走 Orca 既有通道。

**hostId / hostType / repoPath 的处理**：

- `hostId`：对应 Orca 的 `connectionId`（`'local'` 或 `'ssh:target-id'`）
- `hostType`：`'local' | 'ssh' | 'wsl' | 'runtime'`
- `repoPath`：项目根目录绝对路径（POSIX 格式）

**worklineKey 生成策略**：

- 格式：`issue-{number}`，其中 number 是项目内自增整数
- 稳定、可读、URL 安全
- 唯一约束：`UNIQUE(project_id, workline_key)`
- 与 Git refs/branches 解耦——worklineKey 是业务身份，branch 是实现细节

**Issue 状态收敛**：

- TECH-DESIGN §2.2 只定义 `'open'`（默认）和 `'done'` 两态
- 本轮移除 Round 2 中多余的 `'active' | 'paused' | 'closed'`
- 后续 M3 Pipeline 可扩展更多状态

## 3. 与 Orca 现有能力的复用关系

```
┌─────────────────────────────────────────────────────────┐
│                    IPC 层（下一轮）                        │
│  接收前端 Project/Issue 操作请求                           │
│  路由 git 执行到正确的 host provider                      │
│  调用 Store 方法持久化                                    │
└────────────┬────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│                 本轮：Store 层                            │
│  ProjectStore / IssueStore / TeamStore                   │
│  纯数据操作 + 业务规则校验（canDelete / worklineKey）       │
└────────────┬────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│           Orca 既有能力（本轮复用）                         │
│  isGitRepo / getGitRepoRoot / gitExecFileAsync            │
│  connectionId → hostId 映射                               │
└─────────────────────────────────────────────────────────┘
```

## 4. 实施方案

### Project Store (`project-store.ts`)

- `register(input)`：注册新项目，默认 `status: 'active'`，`gitInitialized: false`
- `get(id)` / `list()`：查询
- `update(id, { name?, description?, status?, defaultBranch? })`：更新基础字段
- `syncGitStatus(id)`：调用 `isGitRepo(repoPath)` 检查并同步状态
- `inviteMember(projectId, memberId, role)`：邀请团队成员（校验项目+成员存在，防重复）
- `removeMember(projectId, memberId)`：移除成员（阻止仍有 open issue 的成员被移除）
- `listMembers(projectId)`：列出项目成员

### Issue Store (`issue-store.ts`)

- `create(input)`：创建 issue，自动生成 number（项目内自增）和 worklineKey（`issue-{number}`）
- `get(id)` / `getByWorklineKey(projectId, worklineKey)` / `listByProject(projectId)`：查询
- `update(input)`：更新 title/description/priority/status/worklineState/ownerId
- `nextIssueNumber(projectId)`：暴露 number 生成（供测试和预览）

### Schema 调整

- `user_version` 升到 3（issues.status 默认值确认为 'open'，实际未变）
- 移除 `TeamMemberOrca.status`（与 `isActive` 重复）

## 5. 实际修改文件清单

| 文件 | 动作 | 关键变更 |
| ------ | ------ | ---------- |
| `src/shared/team-types.ts` | 更新 | IssueStatus 收敛为 'open' \| 'done'；移除 TeamMemberOrca.status |
| `src/main/runtime/collaboration/collaboration-database.ts` | 更新 | user_version → 3；添加 v2→v3 迁移步骤 |
| `src/main/runtime/collaboration/project-store.ts` | **新建** | 项目 CRUD + git 状态同步 + 团队成员管理 |
| `src/main/runtime/collaboration/issue-store.ts` | **新建** | Issue CRUD + worklineKey 生成 + 状态流转 |
| `src/main/runtime/collaboration/team-store.ts` | 小修 | 移除 status 派生 |
| `src/main/runtime/collaboration/team-store.test.ts` | 小修 | 移除 status 字段 |
| `src/main/runtime/collaboration/project-store.test.ts` | **新建** | 10 个测试（CRUD + git 状态 + 成员管理 + 约束） |
| `src/main/runtime/collaboration/issue-store.test.ts` | **新建** | 11 个测试（CRUD + worklineKey + number 自增 + 唯一约束） |

## 6. 验证结果

- ✅ **单元测试**：42/42 通过（Round 2 的 23 个 + Round 3 新增 21 个，其中 2 个 Round 2 测试因版本号和 status 移除更新）
- ✅ **类型检查**：`tsc --noEmit -p config/tsconfig.node.json` 通过（0 错误）

### 测试覆盖矩阵

| Store | 测试数 | 覆盖场景 |
|-------|--------|----------|
| Project Store | 10 | 注册默认值、git 状态同步、列表顺序、update 刷新、邀请成员、重复邀请拒绝、未知成员拒绝、移除成员（无 open issue） |
| Issue Store | 11 | 创建+number+worklineKey、项目内自增、全局隔离、未知项目/owner 拒绝、worklineKey 查询、列表排序、update 状态流转、未知 owner 拒绝、DB 唯一约束 |

## 7. 风险与待确认项

- **git init 执行时机**：本轮不做。IPC 层需在 register 后检查 `gitInitialized`，若 false 则调用 Orca git 通道执行 init，然后调 `projectStore.syncGitStatus()` 或直接 `markGitInitialized()`。
- **Issue 状态机简化**：当前只有 open/done。M3 Pipeline 可能需要 in_progress/review 等中间态——IssueStatus 已预留扩展空间。
- **并发 number 生成**：当前用 `SELECT MAX(number) + 1`，单进程 Electron 安全；若未来多进程需改事务内原子递增。
- **projectStore.removeMember 的 open issue 检查**：当前只查 owner 是某成员的 open issue。若业务要求 assignee 也阻止，需扩展。
- **时间戳**：仍用 TEXT ISO（与 Orca 一致），与 TECH-DESIGN 的 INTEGER 偏差持续存在。

## 8. 已沉淀记录

- `multi-agent-iteration/2026-08-14-round3-project-issue-store.md`（本文件）

## 9. 下一轮建议

**B8 协作 IPC 注册**——将 Team/Project/Issue Store 能力暴露给 renderer。具体：

- 在 `src/main/ipc/register-core-handlers.ts` 添加 `registerCollaborationHandlers`
- 定义 IPC 通道命名（如 `collaboration:team:list`, `collaboration:project:register`, `collaboration:issue:create`）
- 桥接 Store 方法与 IPC handler
- 在 shared 目录补充 Zod 请求校验 schema

依赖本轮收敛后的稳定 Store API，风险低、闭环清晰。
