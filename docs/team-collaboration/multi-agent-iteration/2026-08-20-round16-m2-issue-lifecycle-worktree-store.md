# Round 16 — M2 起步纯后端：D1 Issue 生命周期引擎 + D3 Issue-Worktree 登记 store

> 里程碑：**M2**（Issue 驱动开发 + Worktree 自动分配）。M1（R15 收口）已后端 100% + 前端基础 C1-C9，B5（IssueStore）/ B7（git-ref store）/ A5（activity-log store）三项前置于 D1/D3 的能力全部就绪。本轮用纯后端两个闭环切入 D 系列：**D1** 在既有 `issues` 表上做生命周期引擎（工作线初始化 + owner ref 登记 + 事件埋点），**D3** 在既有 `issue_worktrees` 表上做 Worktree 登记 store。两张表均已建表（**零 DDL、零迁移**）；D2（worktree 分配器）与 D4（terminal/Agent 启动）依赖 Orca Runtime，是更重的一跳，留后续轮次。本轮**零 IPC、零前端、零真实 git/terminal 调用**。
>
> 决策来源：R16 范围经 AskUserQuestion 由用户选定「D1 + D3 后端（推荐）」。

## 1. 本轮目标

- **D1**：新建 `issue-lifecycle.ts`，对既有 `issues` 表提供工作线初始化与生命周期事件：
  - `initIssueLine(issueId)` — 幂等：确认 issue 存在，初始化/归还 issue 工作线（`workline_state` → `planning`），并为 owner 调用 B7 `ensureOwnerRef` 登记 owner ref，同时写一条 activity-log（A5）事件。
  - `assignWorktree(issueId, memberId)` 的准备性校验（D2 分配器未做前，D1 提供「成员 ∈ 项目团队」校验，供后续 D3/D2 复用）。
  - 生命周期事件：`onStatusChange` / `recordEvent` 之类埋点（经 A5 `activity-log-store.log` 落库）。
  - **不接真实 git / terminal / worktree 实体创建**（本轮 D1 只管「工作线元数据 + ref 登记 + 事件日志」，真实 worktree 由 D2/D4 接 Orca Runtime）。
- **D3**：新建 `issue-worktree-store.ts`，对既有 `issue_worktrees` 表提供读写：
  - `register(input)` / `create` — 登记一个 IssueWorktree（issue_id/member_id/worktree_id/host_id/status），幂等（唯一索引 `(issue_id, member_id)`，同成员同 issue 只允许一个，重复显式抛错）。
  - `listByIssue(issueId)` / `listByMember(memberId)` / `getByIssueAndMember(issueId, memberId)` / `update`（status/terminal_id/active_ref_name）/ `get(id)`。
  - `rowToWorktree` 显式 snake→camel 映射，**禁止裸 `as unknown as IssueWorktree`**（沿用 R14/R15 教训）。
- 全部复用既存表/类型/Store 范式，**不改 DDL、不升 SCHEMA_VERSION、不建 IPC/preload、不动前端、不调用 Orca Runtime**。

## 2. 依赖与现状（接入点分析，已核实）

### 2.1 数据库表已就绪，无需迁移

`src/main/runtime/collaboration/collaboration-database.ts`：

- `issues` 表（L104-124）：`id/project_id/number/title/description/status/priority/owner_id/workline_key/workline_state/created_at/updated_at`。`workline_state` 已存在（IssueStore.create 默认写 `'intake'`）。
- `issue_git_refs` 表（L193-206）：`.../ref_name/ref_role/member_id/purpose/status/...`，唯一索引 `idx_issue_git_refs_name(issue_id, ref_name)`，`FOREIGN KEY issue_id → issues ON DELETE CASCADE`。
- `issue_worktrees` 表（L176-191）：`id/issue_id/member_id/worktree_id/terminal_id/active_ref_name/host_id/status(DEFAULT 'active')/created_at/updated_at`，**唯一索引 `idx_issue_worktrees_member(issue_id, member_id)`**，`FOREIGN KEY issue_id → issues ON DELETE CASCADE`、`member_id → team_members ON DELETE RESTRICT`。
- `activity_log` 表（L208-220）：`.../project_id/actor_type/actor_id/actor_name/action/target_type/target_id/metadata/created_at`。
- `SCHEMA_VERSION = 5` 保持不变，**本次零 DDL / 零迁移**。

### 2.2 类型已就绪

`src/shared/team-types.ts` 已定义：

- `Issue`（L131-144）：含 `worklineKey`、`worklineState: string`。
- `IssueWorktree`（L192-203）：`id/issueId/memberId/worktreeId/terminalId?/activeRefName?/hostId/status/createdAt/updatedAt`。
- `IssueGitRef`（L205-215）：`.../refName/refRole('owner'|'member'|'release'|'experiment')/memberId?/purpose/status/...`。
- `ActivityLog`（L217-228）、`ProjectTeamMember`（L230-235）。

### 2.3 前置 Store API（R15 已就绪，D1/D3 直接调用）

- **B7 `issue-git-ref-store.ts`**（R15）：`create` / `get` / `listByIssue` / `ensureOwnerRef(issueId, memberId)`（幂等）/ `ensureWorktreeRef` / `getPreferred` / `getPreferredPrSourceRef`。D1 用 `ensureOwnerRef`。
- **A5 `activity-log-store.ts`**（R15）：`log(input)`（自动补 id `al_` + createdAt + metadata serialize）/ `get` / `listByProject`。D1 埋点用 `log`。
- **B5 `issue-store.ts`**：`get(id)`、`update({id, worklineState,...})`（`assertOwnerInProject` 已在 update/create 内置）、`getByWorklineKey`。D1 用 `get` + `update`。
- **B4 项目团队**（project-store）：`listMembers(projectId)` 返回 `ProjectTeamMember[]`（`memberId`）。D1 校验「成员 ∈ 项目团队」用。

### 2.4 已核实空缺（避免重复实现）

`src/main/runtime/collaboration/` 现有 11 个 store/service 文件。**`issue-lifecycle.ts` 与 `issue-worktree-store.ts` 均不存在；`issue_worktrees` 表目前只有建表、无人读写。** 两者均需从零新增。

### 2.5 明确不做（防扩大范围）

- **不接 Orca Runtime**：不调用 `createManagedWorktree` / `createTerminal` / git 命令。D1 只做「工作线 + ref 登记 + 事件」元数据闭环；D3 只做「issue_worktrees 表登记」，`register` 需要真实 worktreeId 时由调用方（未来 D2）传入字符串，本轮不生成真实 worktree。
- **不加 D2 worktree 分配器 / D4 terminal/Agent 启动**：留后续 Round（依赖 Orca Runtime，范围更大）。
- **不改 DDL / 不升 SCHEMA_VERSION / 不写迁移**：两张表均已建好。
- **不接 IPC / preload / 前端**：本轮无 UI 消费者，D6（Issue 详情 worktree 展示）时再暴露通道。
- **不重复 team-store / issue-store 列级 CRUD**：D1 只在既有 issue-store 之上做「流程/事件」层，不重写 issues 表 insert/update。

## 3. 完整开发 Prompt

# 开发 Prompt：Round 16 — M2 起步纯后端（D1 + D3）

## 0. 工作目录

`/Users/wang/Documents/work/ranxin/code/rx-cli`

## 1. 先阅读的文件

- `src/main/runtime/collaboration/issue-worktree-store.ts`（若已存在，否则新建）——D3 是本轮主要落点
- `src/main/runtime/collaboration/issue-store.ts` + `.test.ts`（B5：D1 复用 get/update 的参照）
- `src/main/runtime/collaboration/issue-git-ref-store.ts` + `.test.ts`（B7：D1 用 ensureOwnerRef；亦是 rowToX 显式映射 + 幂等 ensure 的参照）
- `src/main/runtime/collaboration/activity-log-store.ts` + `.test.ts`（A5：D1 埋点 log 调用）
- `src/main/runtime/collaboration/issue-comment-store.ts`（最近最成熟的 rowToX + 懒单例 + __reset 范式参照）
- `src/main/runtime/collaboration/project-store.ts`（B4 `listMembers` 用于成员校验）
- `src/shared/team-types.ts`（`Issue`/`IssueWorktree`/`IssueGitRef`/`ActivityLog`/`ProjectTeamMember`）
- `src/main/runtime/collaboration/collaboration-database.ts`（`getCollaborationDb()` 单例 + 表结构）
- `docs/team-collaboration/PROGRESS.md` §5（硬性约定 + 禁止重犯清单）

## 2. 本轮目标

纯后端两个闭环，全部复用既存表/类型/范式，**零 DDL / 零迁移 / 零 IPC / 零前端 / 零 Orca Runtime 调用**：

- **D1** `issue-lifecycle.ts`：Issue 生命周期引擎（工作线初始化 + owner ref 登记 + activity-log 事件埋点）。
- **D3** `issue-worktree-store.ts`：对既有 `issue_worktrees` 表的登记/查询/更新 store。

## 3. 范围控制

**做：**

- D1 `issue-lifecycle.ts`：`initIssueLine(issueId)` / 生命周期事件埋点 / 成员项目团队校验（供 D2/D3 复用）+ 单测。
- D3 `issue-worktree-store.ts`：`register`（幂等）/ `create` / `listByIssue` / `listByMember` / `getByIssueAndMember` / `update` / `get` + 单测。
- 各自 `.test.ts` 放在 `src/main/runtime/collaboration/`。

**不做（明确留作后续，防扩大范围）：**

- **不调用 Orca Runtime / git / terminal / worktree 实体创建**——D1/D3 都只做元数据层；`issue-worktree-store.register` 的 `worktreeId`/`hostId` 由调用方入参传入字符串，不生成真实 worktree。
- **不建 D2 worktree-allocator、不做 D4 terminal/Agent 启动**。
- **不改 DDL、不升 `SCHEMA_VERSION`、不写迁移、不新建表**（`issue_worktrees` 已存在）。
- **不接 IPC**（`collaboration:*`、preload `api-types.ts`/`index.ts`）——D6 展示时再暴露。
- **不接前端**任何组件 / 页面 / 翻译文案。
- **不重复 issue-store 的 issues 表 CRUD**——D1 只做流程/事件层，复用 `issue-store.get/update`。
- **不引入假数据/占位 fixture 掩盖缺失**——方法真实读写 DB，空数据返回空数组 / `undefined` / `null`，不编造。

## 4. 技术方案

### 4.1 D1 `issue-lifecycle.ts`

- 职责：既有 `issues` 表之上的一层「工作线 + 生命周期」服务；不做真实 worktree/git。
- 建议结构（deps 注入，便于单测隔离）：
  - `createIssueLifecycle(deps: { issueStore?, gitRefStore?, worktreeStore?, activityLogStore?, projectStore? })`，默认走 `getXStore()` 懒单例；提供 `getIssueLifecycle()` + `__resetIssueLifecycleForTests()`。
  - `initIssueLine(issueId, opts?: { actor?: { id, name, type } })`：
    - 先 `issueStore.get(issueId)`，不存在抛「Issue not found」。
    - 幂等：若 `workline_state` 已在 `['planning','in_progress','review']` 等有效推进态，直接返回当前 issue（不重复推进）；否则 `issueStore.update({id, worklineState:'planning'})`。
    - 调 `gitRefStore.ensureOwnerRef(issueId, issue.ownerId)` 登记 owner ref（B7 已幂等）。
    - 写一条 A5 `activityLogStore.log({ projectId, actorType, actorId, actorName, action:'issue.line.initialized', targetType:'issue', targetId:issueId, metadata:{ worklineKey, worklineState } })`（actor 缺省用 owner 信息）。
    - 返回 `{ issue, ownerRef }` 或等价结构。
  - 生命周期事件埋点 helper：`recordLifecycleEvent(issue, action, opts)`（内部走 `activityLogStore.log`，供状态变更等复用）。
  - 成员校验 helper：`assertMemberInProject(issueId, memberId)`（经 `issueStore.get` 取 projectId + `projectStore.listMembers` 校验），供 D2/D3 复用；不在项目团队抛明确错误。
- 状态推进语义：`IssueStatus` 目前 `'open'|'done'`；`workline_state` 是字符串（TECH-DESIGN stress `intake/planning/in_progress/review/blocked/done/cancelled`）。D1 只负责写 `workline_state`（不做完整状态机），D2/D4 再补全。

### 4.2 D3 `issue-worktree-store.ts`

- 方法（职责对齐 ROADMAP D3「创建成员 worktree 并登记映射」，以本轮最小集为准）：
  - `register(input: RegisterWorktreeInput): IssueWorktree` — 唯一登记：先查 `(issue_id, member_id)` 是否已存在（幂等：存在即返回既有；或在入参标记 `ifNotExists` 时返回既有，重复抛错——二选一并在测试断言）；校验 issue 存在、member ∈ `team_members` 存在；插入。
    - `RegisterWorktreeInput`：`issueId/memberId/worktreeId/hostId/terminalId?/activeRefName?/status?`。
  - `create(input)`（别名，等价 register，二取一，避免重复方法，详见下）。
  - `listByIssue(issueId): IssueWorktree[]`
  - `listByMember(memberId): IssueWorktree[]`
  - `getByIssueAndMember(issueId, memberId): IssueWorktree | null`
  - `update(input: { id, status?, terminalId?, activeRefName? }): IssueWorktree`
  - `get(id): IssueWorktree | null`
- **方法去重约定**：`register` 与 `create` 语义可能重叠，请选一个对外主方法（建议 `register` 表述幂等唯一性），另一个若纯别名则不要重复实现（PROGRESS 死代码约定）。若评估某方法 D 系列用不到，删去并说明。
- ID 前缀 `iw_`（注意与 `iref_` 区分），时间戳 ISO。
- 行映射 `rowToWorktree(row)` 显式 camel（snake→camel，含 `issue_id→issueId`、`member_id→memberId`、`worktree_id→worktreeId`、`terminal_id→terminalId`、`active_ref_name→activeRefName`、`host_id→hostId`），**禁止 `as unknown as IssueWorktree`**（沿用 R14/R15 教训）。
- 唯一冲突：`(issue_id, member_id)` 唯一索引已存在，显式预查 + 明确错误信息（同 issue 同成员一个 worktree，即 M2-3「每个 Issue 每个成员只有一个 worktree」）。

### 4.3 单例与命名约定

- 文件：`issue-lifecycle.ts` / `issue-worktree-store.ts`（均放 `src/main/runtime/collaboration/`）。
- 单例：`getIssueLifecycle()`、`getIssueWorktreeStore()` 懒创建 + `__resetXForTests()`；与既有 store 一致。
- 不在新文件重写 DB 准备语句时，可自由；但应复用 `getCollaborationDb()` 与既有 store。不新增 `helpers/utils` 泛型文件。
- 跨 store 校验：D1/D3 一律先查关联实体（issue/member/project）再写，避免裸 `SQLITE_CONSTRAINT`。

## 5. 测试要求

- `issue-worktree-store.test.ts`：
  - register 成功 + 返回 camelKey 字段（`issueId`/`memberId`/`worktreeId`/`hostId`）。
  - 同 issue+member 重复登记：幂等返回既有（或明确抛错，二选一，测试对齐所选语义）。
  - listByIssue / listByMember / getByIssueAndMember / get 过滤正确；未找到返回 `[]`/`null`。
  - update 改 status/terminalId/activeRefName 生效。
  - 未知 issue / 未知 member 抛明确错误（先查关联实体）。
  - **snake_case 字段 undefined 断言**：从 rowToWorktree 返回对象断言 `issue_id`/`worktree_id` 等 snake 键不存在（R14/R15 回归护栏）。
- `issue-lifecycle.test.ts`：
  - initIssueLine 建 planning state + 建 owner ref（ensureOwnerRef 幂等：二次调用不重复建）+ 写 activity-log 事件。
  - 幂等性：二次 init 不重复推进 state、不重复建 ref、可重复埋点（或按设计去重后断言）。
  - 未知 issue 抛错；成员 ∈ 项目团队校验通过/拒绝。
  - assertMemberInProject：owner/member 在项目团队通过，非项目成员抛明确错误。
- **禁止 fixture 掩盖**：走真实 `getCollaborationDb()`（或注入 in-memory db）+ 前置依赖 store 真实构建（team/project/issue 真实落库）；断言 camelKey，不裸 `as`。
- 分布数字：文档 §9 必须与各文件 `it(` 计数一致，收口前跑真实 vitest 核对总数 = 各之和。

## 6. 验证命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH"
pnpm vitest run src/main/runtime/collaboration/issue-lifecycle.test.ts src/main/runtime/collaboration/issue-worktree-store.test.ts --config config/vitest.config.ts
pnpm tsc --noEmit -p config/tsconfig.node.json
pnpm oxlint
```

## 7. 禁止重犯清单（PROGRESS §5，逐条自查）

1. 不用 fixture/占位掩盖契约缺口（方法真实读写 DB，断言 camelKey + snake undefined）。
2. 无虚假声明（每方法真实实现 + 测试，不留声称未测的代码）。
3. 无死代码（不建未使用方法；`register`/`create` 二选一，不重复实现纯别名）。
4. 不漏 invariant（snake→camel 行映射必须 `rowToWorktree`，禁止裸 `as unknown as`）。
5. 不语义混淆（`issueId`/`memberId`/`worktreeId`/`hostId` 命名与 team-types 完全一致）。
6. 文档数字与实现一致（§9 分布 = 真实 `it(` 计数）。
7. 不扩大范围（零 DDL / 零 IPC / 零前端 / 零版本升级 / 零 Orca Runtime 调用）。
8. 幂等 ensure 语义与 B7 `ensureOwnerRef` 对齐（同 issue 同 member 一个 worktree = M2 验收标准）。

## 8. 输出格式

### 本轮完成

### 实际修改文件

### 关键设计决策与理由

### 测试结果（真实分布核对 + tsc/lint）

### 风险与下一轮建议

---

## 决策记录：关键设计决策与理由（负责人侧）

1. **本轮只做 D1 + D3 元数据层，不碰 Orca Runtime**：D2/D4 的 `createManagedWorktree`/`createTerminal` 是重依赖且有跨宿主复杂性与启动副作用，先以两张已建表的元数据闭环进入 M2，把「分配器/terminal」留给后续独立轮，符合「小步快跑」与范围收敛。
2. **复用 B5/B7/A5，不重造**：D1 直接在 `issue-store.get/update` + `git-ref-store.ensureOwnerRef` + `activity-log-store.log` 之上编排，避免三套重复实现。
3. **`issue_worktrees` 既有唯一索引即 M2-3 硬约束**：`(issue_id, member_id)` 唯一索引天然保证「每 Issue 每成员一个 worktree」，D3 只需显式预查给清晰错误，无需额外逻辑。
4. **D1 不建完整状态机**：`workline_state` 推进语义（intake→planning→in_progress→review→done）由后续轮补齐，本轮只做「初始化 + ref 登记 + 埋点」最小闭环，防止范围膨胀。

## 风险记录：风险与缓解（负责人侧）

| 风险 | 缓解 |
|------|------|
| D1/D3 无真实 worktree/git 调用，验收停留在元数据 | 本轮明确是「M2 起步元数据层」；D2/D4 接 Orca Runtime 时补真实闭环，文档明示边界 |
| `register`/`create` 方法重复（死代码） | 二选一对外主方法，另一个不重复实现并说明 |
| row 映射再用裸 `as`（R14 教训重演） | 强制 `rowToWorktree` + 测试断言 camel 键 + snake undefined |
| 唯一索引冲突信息不友好 | 显式预查 `(issue_id, member_id)` 并抛明确错误 |
| workline_state 推进语义未定 | 本轮仅初始化 + 幂等，完整状态机留 D2/D4；文档明示 |

---

## 9. 测试分布（开发 Agent 填，收口时核对真实 vitest）

<!-- 下表数字必须以运行时 `it(` 实际计数为准，禁止手填虚值；总计 = 各文件之和 -->
| 文件 | 用例数 |
|------|--------|
| `issue-lifecycle.test.ts` | 11 |
| `issue-worktree-store.test.ts` | 13 |
| **新增总计** | **24** |

既有 tests（collaboration 目录 11 文件）139 + 新增 24 = **163 总计（13 文件）**。

## 10. 复核结论（负责人收口）

**R16 复核通过**（零阻塞问题，已收口）。

- **D3 `issue-worktree-store.ts`**：真实走 in-memory DB + 前置依赖 store 真实构建（team/project/issue 真实落库）；`rowToWorktree` 显式 snake→camel 映射，无裸 `as unknown as`；`register` 先查 issue/member 存在性再写，并显式预查 `(issue_id, member_id)` 唯一约束抛明确错误（幂等抛错语义，符合文档选项 B）；ID 前缀 `iw_`；`update` 保留空字段不回退。**未实现 `create` 纯别名**（文档 §4.2 允许二选一），避免死代码。
- **D1 `issue-lifecycle.ts`**：deps 注入 + 懒单例 + `__resetIssueLifecycleForTests`；`initIssueLine` 幂等（仅当 `workline_state` 非有效推进态才推进 planning，owner ref 经 B7 `ensureOwnerRef` 幂等，activity-log 事件埋点）；`recordLifecycleEvent`/`assertMemberInProject` 均真实实现并有测试。零 Orca Runtime/IPC/前端/DDL 调用，未越界。
- **测试分布核对**：issue-lifecycle=11、issue-worktree-store=13，合计 24；真实 vitest 实测 **163 tests（13 文件）** 全绿（139 既有 + 24 新增），分布与文档一致。
- **质量门禁**：`tsc --noEmit -p config/tsconfig.node.json` exit 0，oxlint exit 0。
- **snake_case 字段 undefined 回归护栏**：worktree-store 测试逐字段断言 `issue_id`/`host_id`/`active_ref_name` 等 snake 键不存在（R14/R15 教训延续）。
- 无扩大范围：未建 D2/D4、未改 DDL/SCHEMA_VERSION、未建 IPC/preload、未接 Orca Runtime。
