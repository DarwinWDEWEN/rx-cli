# Round 4 — 后端数据层加固（Review 问题修复）

> 日期: 2026-08-14 | 阶段: M1 数据层收敛 | 触发: Round 3 代码审核

## 1. 本轮目标

修复 Round 3 审查发现的 3 个问题，将后端数据层收敛到可作为 IPC/UI 基础的稳定状态：
1. syncGitStatus 多宿主支持（数据层不做跨宿主探测）
2. removeMember 增加活跃 worktree 校验
3. Issue owner 必须属于项目团队

## 2. 接入点分析

本轮仅修改既有协作模块文件，不涉及 Orca 底层、IPC、UI：
- `src/main/runtime/collaboration/project-store.ts` — 问题 1、2
- `src/main/runtime/collaboration/issue-store.ts` — 问题 3
- `src/main/runtime/collaboration/project-store.test.ts` — 问题 1、2 测试
- `src/main/runtime/collaboration/issue-store.test.ts` — 问题 3 测试
- `src/main/runtime/collaboration/team-store.ts` — 第二轮修复问题 A（FK 约束对齐）
- `src/main/runtime/collaboration/team-store.test.ts` — 第二轮修复问题 A 测试

## 3. 修复策略

### 问题 1：syncGitStatus 多宿主问题

**选择方案 A**（数据层只做持久化，不做跨宿主探测）。

理由：
- Store 层硬耦合 host provider / SSH 路由违反分层原则
- Orca 的 `isGitRepo` 仅适用于本地文件系统
- 真实 git 探测需要 host-aware provider（SSH/WSL/runtime），属于 IPC/runtime 层职责
- 方案 B 在这一轮会引入大量对 Orca 宿主基础设施的依赖，且无法在单元测试中隔离

修复动作：
- 删除 `syncGitStatus()` 方法
- 新增 `markGitInitialized(projectId, initialized = true)` — 纯持久化更新
- 移除对 `isGitRepo` 的导入
- 项目注册时的初始 `gitInitialized` 值由调用方（IPC 层）探测后传入

### 问题 2：removeMember 缺少 worktree 校验

**选择**：增加项目内活跃 worktree 硬校验。

实现：
- JOIN `issue_worktrees` + `issues`，限制 `project_id` + `member_id` + `iw.status = 'active'`
- 是否额外限制 `issue.status != 'done'`？
  - **判断**：不加。PRD 原文是"必须所有 worktree 已关闭"——worktree 自身 `status = 'active'` 就是硬条件，与 issue 状态无关。即使 issue 已 done，只要 worktree 仍 active，就阻止移除。
- 错误信息明确列出活跃 worktree 数量
- **额外加固**：同时阻止"仍负责 open issue"的成员被移除（open issue 的 owner 被移除会导致孤儿 issue）

### 问题 3：Issue owner 必须属于项目团队

**选择**：在 IssueStore 内查询 `project_team_members` 校验 owner 是项目成员。

实现：
- 新增 `assertOwnerInProject()` 辅助函数，通过 ProjectStore 的 `listMembers` 判断
- create/update 时校验 `ownerId` 在项目团队中存在对应记录
- 错误信息："Owner {id} is not a member of project {id}"

---

## 4. 实施记录

### 4.1 实际修改文件

| 文件 | 动作 |
|------|------|
| `src/main/runtime/collaboration/project-store.ts` | 删除 syncGitStatus，新增 markGitInitialized；removeMember 加 worktree + open issue 校验；新增 `CreateProjectStoreDeps` 可选依赖注入；新增 `rowToProjectTeamMember` 行转换函数 |
| `src/main/runtime/collaboration/issue-store.ts` | create/update 校验 owner 属于项目团队；新增 `CreateIssueStoreDeps` 可选依赖注入 |
| `src/main/runtime/collaboration/project-store.test.ts` | 更新 git 测试 + 新增 worktree/open issue 移除测试；改用显式依赖注入创建 stores |
| `src/main/runtime/collaboration/issue-store.test.ts` | 新增 owner 必须属于项目团队测试（3 个用例）；改用显式依赖注入创建 stores |
| `src/main/runtime/collaboration/team-store.ts` | canDelete 统计所有 worktree（含 closed）以对齐 FK RESTRICT 约束 |
| `src/main/runtime/collaboration/team-store.test.ts` | 新增 closed worktree 阻塞删除测试 |

### 4.2 关键发现：listMembers 行转换缺失

**实施中发现的隐性问题**：`ProjectStore.listMembers()` 返回的是原始 DB 行（snake_case: `member_id`），但 `ProjectTeamMember` 类型使用 camelCase（`memberId`）。之前的实现使用 `as ProjectTeamMember[]` 类型断言，没有真正转换字段。

这导致：
- `assertOwnerInProject()` 检查 `m.memberId === ownerId` 永远为 false（实际是 `m.memberId === undefined`）
- 所有"owner 属于项目团队"的校验都会误抛异常

**修复**：新增 `ProjectTeamMemberRow` 类型和 `rowToProjectTeamMember()` 转换函数，`listMembers()` 返回前进行真实映射。

### 4.3 依赖注入模式

**问题**：测试中 `await import('./project-store')` 与 `issue-store.ts` 的静态 `import { getProjectStore } from './project-store'` 在 vitest 中可能解析为不同模块实例，导致单例不共享。

**修复**：为 `createProjectStore` 和 `createIssueStore` 增加可选 `deps` 参数，测试中显式传递共享的 store 实例：

```typescript
// 测试中的创建顺序
teamStore = createTeamStore()
projectStore = createProjectStore({ teamStore })
issueStore = createIssueStore({ projectStore, teamStore })
```

生产代码保持兼容：`getProjectStore()` / `getIssueStore()` 仍返回单例，无需 deps。

### 4.4 第二轮 Review 修复（FK 约束对齐 + owner invariant 加固）

**问题 A：canDelete 与 FK 约束不一致**

`team_store.canDelete()` 只统计 active worktree，但 `issue_worktrees.member_id -> team_members.id` 是 `ON DELETE RESTRICT`。结果是：前置校验说能删（只有 closed worktree），实际 DB 删不掉（FK 阻塞）。

修复：`canDelete()` 改为统计所有 worktree（`SELECT COUNT(*) FROM issue_worktrees WHERE member_id = ?`），与 FK 约束对齐。

**问题 B：issue.update() 绕过 owner invariant**

只在 `input.ownerId` 传入时校验 owner 属于项目团队。如果 done issue 的 owner 已被移出项目，之后只改 status/worklineState 把它 reopen（不改 ownerId），invariant 被绕过。

修复：`update()` 使用 `resolvedOwnerId = input.ownerId ?? existing.owner_id`，始终调用 `assertOwnerInProject()` 校验。

---

## 5. 修复结果汇总

### 问题 1 ✅

- `syncGitStatus()` 已删除
- `markGitInitialized(id, initialized = true)` 纯持久化
- 测试覆盖：`markGitInitialized persists git state without local probing`（使用 `/nonexistent/ssh/path` 验证不再做本地探测）

### 问题 2 ✅

- `removeMember` 先检查活跃 worktree，再检查 open issue
- 测试覆盖：
  - `removeMember blocks removal when member has active worktree`（反向）
  - `removeMember succeeds after worktree is closed`（正向，issue 为 done + worktree 为 closed）
  - `removeMember blocks removal when member still owns open issues`（反向，新增）

### 问题 3 ✅

- `assertOwnerInProject()` 在 create/update 时校验
- 测试覆盖：
  - `throws when owner is a team member but not in project team`（反向）
  - `throws when updating owner to a non-project-member`（反向）
  - `update owner to another project member succeeds`（正向）
  - `update fails when existing owner was removed from project team`（反向，第二轮新增）

### 问题 A（第二轮）✅

- `canDelete()` 统计所有 worktree 以对齐 FK RESTRICT
- 测试覆盖：`canDelete: blocks deletion when member only has closed worktree`

### 问题 B（第二轮）✅

- `update()` 始终校验 owner（无论是否传入 ownerId）
- 测试覆盖：`update fails when existing owner was removed from project team`

---

## 6. 测试与验证结果

```
Test Files  4 passed (4)
Tests       49 passed (49)
```

类型检查：`tsc --noEmit -p config/tsconfig.node.json` 通过（无错误）。

测试分布：
- `collaboration-database.test.ts`: 12 tests
- `team-store.test.ts`: 12 tests（+1 新增）
- `project-store.test.ts`: 10 tests（+1 新增）
- `issue-store.test.ts`: 15 tests（+4 新增）

---

## 7. 风险与待确认项

1. **依赖注入是测试专用模式**：生产代码仍使用 `getProjectStore()` 等单例 getter。如果未来 vitest 模块解析行为变化，测试可能需要调整。当前模式明确且可维护。

2. **markGitInitialized 的调用时机**：IPC/层需要在项目注册后探测 git 状态并调用 `markGitInitialized`。这是 B8 IPC 注册时的任务。

3. **open issue 检查是额外加固**：PRD 只要求 worktree 检查，open issue 检查是防御性添加。如果产品认为"owner 被移除时 issue 应自动转交"，需调整策略。

4. **rowToProjectTeamMember 只用于 listMembers**：`inviteMember` 返回的手动构造对象已是 camelCase，无需转换。`removeMember` 中的 `selectTeamMember` 仅用于存在性检查，也无需转换。

5. **canDelete 错误信息变化**：从"活跃 worktree"改为"worktree（含已关闭）"，以准确反映阻塞原因。

---

## 8. 已沉淀记录

- `docs/team-collaboration/multi-agent-iteration/2026-08-14-round4-store-hardening.md`（本文档）

---

## 9. 建议的下一轮任务

**B8 协作 IPC 注册**（ROADMAP 下一项）：
- 注册 `project.*` / `issue.*` / `team.*` IPC handlers
- 在 IPC 层实现真正的 host-aware git 探测（调用 Orca 的 git provider）
- 项目注册流程：前端传入 repo_path → 后端探测 hostType → 调用 `markGitInitialized`
- Zod validation for IPC inputs（之前规划但未实施）

**可选补充**：
- 为 `team-store.test.ts` 增加依赖注入模式（当前无跨 store 调用，但保持一致性）
- 审查其他 Store 方法是否存在类似的行转换缺失（如 `inviteMember` 返回手动构造，已确认安全）
