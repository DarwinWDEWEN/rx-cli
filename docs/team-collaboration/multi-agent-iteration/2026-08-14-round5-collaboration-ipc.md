# Round 5 — B8 协作 IPC 注册

> 日期: 2026-08-14 | 阶段: M1 后端能力出口 | 任务: B8 协作 IPC 注册

## 1. 本轮目标

完成 B8 协作 IPC 注册的最小可用闭环，为后续 Renderer/UI 接入提供稳定主进程调用面。

本轮只做：

- `team.*` IPC handlers
- `project.*` IPC handlers
- `issue.*` IPC handlers

明确不做：UI 页面、Sidebar 入口、PR Store/PR IPC、schema 扩张。

## 2. 接入点分析

### 2.1 当前已具备的能力

| 能力 | 文件 | 说明 |
| ------ | ------ | ------ |
| Team CRUD + delete 约束 | `src/main/runtime/collaboration/team-store.ts` | 含 canDelete() 与 FK 一致性修复 |
| Project CRUD + 项目成员管理 | `src/main/runtime/collaboration/project-store.ts` | 含 markGitInitialized() |
| Issue CRUD + owner invariant | `src/main/runtime/collaboration/issue-store.ts` | owner 必须属于项目团队 |
| 协作 schema / migration | `src/main/runtime/collaboration/collaboration-database.ts` | 已稳定 |

### 2.2 接入点

| 位置 | 作用 |
| ------ | ------ |
| `src/main/ipc/collaboration-teams.ts` | 新增 — team.* handlers |
| `src/main/ipc/collaboration-projects.ts` | 新增 — project.* handlers |
| `src/main/ipc/collaboration-issues.ts` | 新增 — issue.* handlers |
| `src/main/ipc/register-core-handlers.ts` | 修改 — 注册协作 handlers |

### 2.3 Orca 现有 IPC 复用原则

参考现有 handler 风格：

- `src/main/ipc/settings.ts` — ipcMain.handle 模式
- `src/main/ipc/plugins.ts` — Zod validation 模式

## 3. 实现策略

### 3.1 分层原则

- **Store 层**：只负责持久化和业务约束（已有）
- **IPC 层**：负责参数校验（Zod）、调用编排、错误向上抛出
- 不复制业务规则到 IPC 层

### 3.2 Git 探测原则

- 严禁重新引入 `syncGitStatus()`
- 严禁对 SSH/WSL/remote 项目做本地文件系统假设
- `project:register` 不探测 git 状态 — 保持 Store 层为纯持久化
- host-aware git 探测留给后续 UI/接入层调用 `project:markGitInitialized`

### 3.3 契约原则

- IPC 参数必须做 Zod 校验
- 返回值直接复用 Store 返回对象
- 不新增字段，不改领域对象语义

## 4. 实施记录

### 4.1 实际修改文件

| 文件 | 动作 |
| ------ | ------ |
| `src/main/ipc/collaboration-teams.ts` | 新增 — 6 个 team.* handlers |
| `src/main/ipc/collaboration-projects.ts` | 新增 — 8 个 project.* handlers |
| `src/main/ipc/collaboration-issues.ts` | 新增 — 6 个 issue.* handlers |
| `src/main/ipc/register-core-handlers.ts` | 修改 — 注册 3 个 register 函数 |
| `src/main/runtime/collaboration/team-store.ts` | 修改 — create 方法添加防御性默认值 |
| `src/main/ipc/collaboration-ipc.test.ts` | 新增 — 11 个 IPC 层测试 |

### 4.2 IPC 清单

#### Team IPC (6 个)

| Channel | 行为 |
| --------- | ------ |
| `team:list` | 返回所有团队成员 |
| `team:get` | 按 id 查询，不存在抛错 |
| `team:create` | Zod 校验后创建 |
| `team:update` | Zod 校验后更新 |
| `team:canDelete` | 返回 `{ canDelete, reasons? }` |
| `team:delete` | 直接调用 Store.delete（内部有 canDelete 校验） |

#### Project IPC (8 个)

| Channel | 行为 |
| --------- | ------ |
| `project:list` | 返回所有项目 |
| `project:get` | 按 id 查询，不存在抛错 |
| `project:register` | Zod 校验后注册（不探测 git） |
| `project:update` | Zod 校验后更新 |
| `project:listMembers` | 列出项目成员 |
| `project:inviteMember` | 邀请成员（roleInProject 默认 'member'） |
| `project:removeMember` | 移除成员（内部有 worktree/issue 校验） |
| `project:markGitInitialized` | 纯持久化更新 git 状态 |

#### Issue IPC (6 个)

| Channel | 行为 |
| --------- | ------ |
| `issue:listByProject` | 按项目列出 Issues |
| `issue:get` | 按 id 查询 |
| `issue:getByWorklineKey` | 按 projectId + worklineKey 查询 |
| `issue:create` | Zod 校验 + owner 属于项目团队 |
| `issue:update` | Zod 校验 + owner invariant（无论是否传 ownerId） |
| `issue:nextIssueNumber` | 获取下一个 Issue 编号 |

### 4.3 参数校验策略

每个 IPC handler 在调用 Store 前先进行 Zod 校验：

```typescript
ipcMain.handle('team:create', (_event, args: unknown) => {
  const input = createTeamMemberSchema.parse(args)  // 校验失败自动抛 ZodError
  return getTeamStore().create(input)
})
```

校验规则：

- `id` / `projectId` / `memberId` / `ownerId` — 非空字符串
- `repoPath` — 非空字符串
- `hostId` / `hostType` — 非空字符串
- `roleInProject` — enum `['owner', 'member']`，默认 `'member'`
- `priority` — enum `['low', 'medium', 'high', 'urgent']`，默认 `'medium'`
- `status` — enum `['open', 'done']`
- `agentType` — 非空字符串（兼容 `WellKnownAgentType | string`）

### 4.4 host-aware git 探测接法

本轮 **未实现** host-aware git 探测，理由：

1. `project:register` 只负责注册项目元数据，不做文件系统探测
2. `project:markGitInitialized` 作为独立 channel 暴露，供后续 UI 层在合适时机调用
3. 真实 git 探测需要复用 Orca 现有 host-aware 能力（SSH/WSL/runtime provider），这属于 UI/接入层的职责

调用时序（未来）：

```
UI 注册项目 → project:register → 返回 project
UI 调用 Orca git provider 探测 → 获得 initialized 状态
UI 调用 project:markGitInitialized → 写回 Store
```

### 4.5 关键发现：Store create 方法需要防御性默认值

**问题**：Store 的 `create` 方法直接访问 `input.personality`、`input.responsibilities` 等字段，当传入 `undefined` 时 SQLite 无法绑定。

**修复**：在 `team-store.ts` 的 `create` 方法中添加防御性默认值：

```typescript
const personality = input.personality ?? ''
const responsibilities = serializeStrings(input.responsibilities)
// ...
```

同时更新 `serializeStrings` / `serializeRecord` 接受 `undefined` 参数。

### 4.6 Zod 版本兼容性

项目使用 Zod 4.4.3，与 Zod 3 的 API 差异：

- `z.record(value)` → `z.record(key, value)`（需两个参数）
- `z.enum` 用法相同

---

## 5. 测试结果

```
Test Files  5 passed (5)
Tests       64 passed (64)
```

测试分布：

- `collaboration-database.test.ts`: 13 tests
- `team-store.test.ts`: 13 tests
- `project-store.test.ts`: 10 tests
- `issue-store.test.ts`: 15 tests
- `collaboration-ipc.test.ts`: 13 tests（新增）

类型检查：`tsc --noEmit -p config/tsconfig.node.json` 通过。

### IPC 测试覆盖

1. handler 已成功注册并可调用 ✅
2. Zod 参数校验生效 ✅（空 name / 空 repoPath / 空 title 均抛错）
3. `project:register` 不会把 git 探测塞回 Store 层 ✅（传入 `/nonexistent/ssh/path` 不报错）
4. `team:canDelete` 能透传约束 ✅
5. `issue:update` 能守住 "owner 必须属于项目团队" invariant ✅
6. 错误路径覆盖 ✅（非法参数、owner 非项目成员、owner invariant 绕过尝试）

---

## 6. 风险与待确认项

1. **测试策略选择**：IPC 测试使用 fake ipcMain 而非 `vi.mock('electron')`，原因是 vitest 的模块解析导致 `ipcMain.handle` mock 无法被 collaboration 模块调用。当前方案直接调用注册函数，覆盖了相同的代码路径。

2. **host-aware git 探测时机**：`project:markGitInitialized` 需要 UI 层在合适时机调用。如果未来需要自动化探测，需在 IPC 层新增一个 `project:probeGit` channel（复用 Orca 现有 git provider）。

3. **team:delete 透传**：`team:delete` channel 直接调用 Store.delete，Store 内部会执行 canDelete 校验并在阻止时抛出异常。这是设计意图 — IPC 层不重复校验。

4. **AgentType schema**：使用 `z.string()` 而非严格 enum，因为 `AgentType = WellKnownAgentType | (string & {})` 是开放类型。

---

## 7. 已沉淀记录

- `docs/team-collaboration/multi-agent-iteration/2026-08-14-round5-collaboration-ipc.md`（本文档）

---

## 8. 建议的下一轮任务

### 选项 A：Renderer 侧 activeView 扩展 + Sidebar 入口

- 在 shared 层定义 `activeView` 类型扩展
- Sidebar 新增 `Issues and PRs` 和 `Teams` 入口
- 为后续 UI 页面铺路

### 选项 B：Teams 页面骨架

- 基于 `team.*` IPC 构建 Teams 列表视图
- 验证 IPC → Renderer 数据流
- 遵循 STYLEGUIDE

### 选项 C：Issues 页面骨架

- 基于 `issue.*` + `project.*` IPC 构建 Issues 视图
- Issue 卡片、状态切换、负责人选择

### 推荐顺序

先 A（基础设施），再 B/C（页面）。因为 activeView 和 Sidebar 是所有页面的共同依赖。
