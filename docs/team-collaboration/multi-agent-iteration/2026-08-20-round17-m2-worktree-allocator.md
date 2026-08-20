# Round 17 — M2 推进：D2 Worktree 分配器（纯后端，Orca Runtime 经注入 seam 隔离）

> 里程碑：**M2**（Issue 驱动开发 + Worktree 自动分配）。R16 已落地 **D1**（issue-lifecycle）与 **D3**（issue-worktree-store），B5/B7/A5 全就绪。本轮实现 **D2 分配器**：给定 Issue + 成员，决策「为谁建 worktree、建什么 ref、如何登记」，并把真实 `createManagedWorktree`（Orca Runtime）隔离在**可注入 seam** 之后——生产默认桩明确**抛「未接线」错误**（D4 接线前不静默假跑），测试注入 fake。分配器逻辑（成员校验 → 每成员唯一 ref → D3 登记 → 幂等）真实落库可测。**零 DDL、零 IPC、零前端、零真实 worktree/terminal 调用**，沿用 R15/R16 低风险纯后端模式。
>
> 决策来源：R17 范围经 AskUserQuestion 由用户选定「D2 worktree 分配器（推荐）」。

## 1. 本轮目标

- **D2**：新建 `worktree-allocator.ts`，提供分配编排（纯后端 + 注入 seam）：
  - `allocateWorktree(issueId, memberId, opts?)` — 原子化分配单个成员的 worktree：
    1. 校验 issue 存在（`issueStore.get`）；
    2. 校验成员 ∈ issue 项目团队（复用 **D1 `assertMemberInProject`**）；
    3. **幂等**：`worktreeStore.getByIssueAndMember` 已存在即返回既有（不重复建/不抛错），维持「每 Issue 每成员一个 worktree」；
    4. 经注入 seam `createWorktree` 创建（返回 `{ worktreeId, hostId }`）；
    5. 保证 per-member git ref（见 §4.3 B7 校正）；
    6. `worktreeStore.register({ issueId, memberId, worktreeId, hostId, terminalId?, activeRefName?, status })`；
    7. 写一条 D1 生命周期事件（`recordLifecycleEvent`，action `worktree.allocated`）。
  - `listForIssue(issueId)` / `listForMember(memberId)`（委托 D3）。
  - `seam` 类型 `CreateWorktreeHandler` + 单例 `getWorktreeAllocator()` + `__resetWorktreeAllocatorForTests()`。
- **B7 一处小校正（in-domain，直接支撑 D2）**：`ensureWorktreeRef` 当前用 `selectByIssueAndRole(issueId, 'member')` 做幂等预查，**返回的是该 issue 的第一个 member ref，而非当前 memberId 的 ref**——第二、第三个成员分配时会拿到第一个成员的 ref（refName=`worktree/{第一个memberId}`），破坏 M2-3「每成员独立 worktree/ref」。R17 改为按 `(issue_id, ref_name)`（`worktree/${memberId}`）幂等预查，保证 per-member。
- 全部纯后端，**不改 DDL、不升 SCHEMA_VERSION、不建 IPC/preload、不动前端、不真实调用 Orca Runtime**。

## 2. 依赖与现状（接入点分析，已核实）

### 2.1 前置能力（R15/R16 已就绪，直接调用）

- **B7 `issue-git-ref-store.ts`**：`create(input)`（含 per-`ref_name` 幂等预查，抛清晰错误）、`ensureOwnerRef(issueId, memberId)`、`ensureWorktreeRef(issueId, memberId)`、`getPreferred`。**注意**：`ensureWorktreeRef` 现有的幂等预查按 `issue+role='member'` 取首条，多成员时返回首成员 ref（缺陷，R17 §1 校正）。
- **D1 `issue-lifecycle.ts`**：`initIssueLine` 、`assertMemberInProject(issueId, memberId)`（经 `projectStore.listMembers` 校验）、`recordLifecycleEvent(issue, action, opts)`。D2 复用 `assertMemberInProject` 与 `recordLifecycleEvent`。
- **D3 `issue-worktree-store.ts`**：`register`（抛错：issue 不存在/member 不存在/`(issue_id, member_id)` 重复）、`getByIssueAndMember`、`listByIssue`、`listByMember`、`get`、`update`。D2 用 `register` + `getByIssueAndMember` + list。
- **B5 `issue-store.ts`**：`get(id)`。
- **B4 项目团队**（project-store）：`listMembers(projectId)` 返回 `ProjectTeamMember[]`。

### 2.2 Orca Runtime 接入点（隔离 seam）

- `createManagedWorktree` 位于 `src/main/runtime/orca-runtime.ts`（RPC 层代理），返回 `Promise<{ worktree: { id: string; ... } }>`，入参含 `name`/`startup`/root 等（宿主相关）。
- R17 **不直接引用** Orca Runtime 模块；定义最小 `CreateWorktreeHandler` seam，由调用方（未来 D4/接线处）在注册分配器时注入真实的 `createManagedWorktree` 适配。本轮生产默认桩**抛「worktree runtime not wired (D4)」**，杜绝在未接线时静默假跑。

### 2.3 类型（`src/shared/team-types.ts`，已就绪）

- `IssueWorktree`：`issueId/memberId/worktreeId/terminalId?/activeRefName?/hostId/status/...`。
- `IssueGitRef`：`refName/refRole/memberId?/...`（`refRole`含 `'owner'|'member'`）。

### 2.4 已核实空缺

`src/main/runtime/collaboration/` 现 13 个文件（13 tests 文件 / 163 tests）。**`worktree-allocator.ts` 不存在，需新增**；`worktree-allocator.test.ts` 同。

### 2.5 明确不做（防扩大范围）

- **不真实调用 Orca Runtime**：`CreateWorktreeHandler` 默认桩抛错；不 import `orca-runtime` 模块；真实接线（把 RPC `createManagedWorktree` 适配进 seam）属 **D4**，留后续轮。
- **不做 D4 terminal/Agent 启动**（启动 terminal + 绑定 Agent）。
- **不改 DDL / 不升 SCHEMA_VERSION / 不写迁移 / 不新建表**。
- **不接 IPC / preload / 前端**。
- **不引入假数据/占位 fixture 掩盖缺失**——`allocateWorktree` 真实落库，`worktreeId`/`hostId` 来自注入 seam 的返回值（测试用 fake 返回确定值），不编造。
- **不新写 team/issue 表 CRUD**——全部委托既有 store。

## 3. 完整开发 Prompt

# 开发 Prompt：Round 17 — D2 Worktree 分配器（纯后端，注入 seam）

## 0. 工作目录

`/Users/wang/Documents/work/ranxin/code/rx-cli`

## 1. 先阅读的文件

- `src/main/runtime/collaboration/worktree-allocator.ts`（若已存在，否则新建）——本轮回合主要落点
- `src/main/runtime/collaboration/issue-worktree-store.ts` + `.test.ts`（D3：register/getByIssueAndMember/list，幂等唯一性）
- `src/main/runtime/collaboration/issue-lifecycle.ts` + `.test.ts`（D1：assertMemberInProject / recordLifecycleEvent，deps 注入 + 懒单例 + __reset 范式参照）
- `src/main/runtime/collaboration/issue-git-ref-store.ts` + `.test.ts`（B7：ensureWorktreeRef + **需校正 per-member 幂等**）
- `src/main/runtime/collaboration/issue-store.ts`（B5 get）、`project-store.ts`（B4 listMembers）
- `src/shared/team-types.ts`（`IssueWorktree`/`IssueGitRef`/`ProjectTeamMember`）
- `docs/team-collaboration/PROGRESS.md` §5（硬性约定 + 禁止重犯清单）

## 2. 本轮目标

新建 **`worktree-allocator.ts`**：纯后端分配编排，真实落库；Orca Runtime 经 **`CreateWorktreeHandler` 注入 seam** 隔离（测试注入 fake，生产默认桩抛「not wired」）。

## 3. 范围控制

**做：**

- `worktree-allocator.ts` + `worktree-allocator.test.ts`（放 `src/main/runtime/collaboration/`）。
- `CreateWorktreeHandler` seam 类型 + 单例 `getWorktreeAllocator()` + `__resetWorktreeAllocatorForTests()`。
- **B7 `ensureWorktreeRef` per-member 幂等校正**（in-domain 小修，直接支撑 D2，见 §4.3）+ 对应多成员测试。

**不做（明确留作后续，防扩大范围）：**

- **不真实调用 Orca Runtime / git / terminal / worktree 实体创建**——`allocateWorktree` 经注入 seam 拿 `{ worktreeId, hostId }`；生产默认桩 `new Error('worktree runtime not wired (D4)')`。
- **不做 D4 terminal/Agent 启动、不做 D5 负责人集成、不改前端/IPC/DDL/SCHEMA_VERSION**。
- **不引入占位 fixture**——方法真实读写 DB，空数据返回 `[]`/`null`，不编造。

## 4. 技术方案

### 4.1 seam 定义

```ts
export type CreateWorktreeHandler = (input: {
  issueId: string
  memberId: string
  worktreeName: string   // 建议 refName 派生，如 `wt/${memberId}` 或与 D3 register.activeRefName 对齐
}) => Promise<{ worktreeId: string; hostId: string }>
```

- `createWorktree` 默认实现：`async () => { throw new Error('worktree runtime not wired (D4)') }`；测试通过 `vi.fn().mockResolvedValue({ worktreeId:'wt_…', hostId:'host-local' })` 注入。
- seam 作为 `createWorktreeAllocator({ worktreeStore?, gitRefStore?, issueStore?, lifecycle?, createWorktree? })` 的 deps 之一；缺省走懒单例。

### 4.2 `allocateWorktree(issueId, memberId, opts?)` 编排顺序（须在测试逐点断言）

1. `issueStore.get(issueId)`，不存在抛「Issue not found」。
2. `lifecycle.assertMemberInProject(issueId, memberId)`（成员 ∈ issue 项目团队），不在抛明确错误。
3. **幂等**：`worktreeStore.getByIssueAndMember(issueId, memberId)` 已存在 → 直接返回既有 `IssueWorktree`（不重复建、不抛——维持 M2-3 每 Issue 每成员一个）。
4. 经 seam `createWorktree({ issueId, memberId, worktreeName })` 拿 `{ worktreeId, hostId }`。
5. **per-member ref**：`gitRefStore.ensureWorktreeRef(issueId, memberId)`（校正后保证返回当前成员 ref；refName=`worktree/${memberId}`）。
6. `worktreeStore.register({ issueId, memberId, worktreeId, hostId, status:'active' })`；如 `opts.terminalId`/`opts.activeRefName` 提供则一并写入。
7. `lifecycle.recordLifecycleEvent(issue, 'worktree.allocated', { metadata:{ memberId, worktreeId, hostId } })` 埋点。
8. 返回 `{ worktree, ref }`。

- `listForIssue(issueId)` / `listForMember(memberId)`：纯委托 `worktreeStore.listByIssue/listByMember`。
- 拒绝跨项目分配：某 `memberId` 不在该 issue 项目的团队 → 步骤 2 拦截。

### 4.3 B7 `ensureWorktreeRef` per-member 校正（in-domain 必要小修）

- **现状（缺陷）**：[issue-git-ref-store.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/main/runtime/collaboration/issue-git-ref-store.ts) `ensureWorktreeRef` 用 `selectByIssueAndRole.get(issueId, 'member')` 做幂等预查 → 拿的是该 issue 的**第一个** member ref，第二个成员调用会错误返回第一个成员的 ref（`refName=worktree/{firstMember}`）。
- **改法**：幂等预查改为按 `(issue_id, ref_name)`（`ref_name='worktree/'+memberId`）查询（复用 `create` 内已有的 `selectByIssueAndRefName` 逻辑）；命中返回之，否则创建 `{ refName:`worktree/${memberId}`, refRole:'member', memberId, purpose:'member-worktree' }`。行为与 `ensureOwnerRef` 的幂等（owner per issue）一致，且多成员各自独立。
- **必加测试**：同一 issue 两个不同成员分别 `ensureWorktreeRef` → 返回各自 `refName`/`memberId`，互不串扰；`gitRefStore.listByIssue` 含两条 member ref。

### 4.4 单例 / 命名 / 编码约定

- 单例：`getWorktreeAllocator()` 懒创建 + `__resetWorktreeAllocatorForTests()`；与既有 store 一致。
- 文件不命名泛型 `helpers/utils`；不新增公共基础设施文件。
- 跨 store 校验一律**先查关联实体再写**（issue/member/project），避免裸 `SQLITE_CONSTRAINT`。
- 不重复实现 D3 register 的幂等——分配器只管「决策 + 编排」，唯一性交给 D3 + 预查。

## 5. 测试要求（`worktree-allocator.test.ts`）

走真实 in-memory DB + 前置依赖 store 真实构建（team/project/issue 真实落库）+ 注入 fake `createWorktree`：

- allocateWorktree 成功：fake 被调用且入参正确；`worktreeStore.register` 落库（返回对象含 `issueId/memberId/worktreeId/hostId`，**断言 camelKey**）；`gitRefStore.listByIssue` 含该成员 `member` ref。
- **幂等**：同 issue+member 二次 allocateWorktree → 返回既有 worktree，**fake createWorktree 未被二次调用**（断言调用次数 1）。
- 未知 issue → 抛「Issue not found」。
- 成员不在 issue 项目团队 → 抛明确错误（拒绝跨项目分配）。
- **多成员 per-member**：两个不同成员各 allocate 一次 → 各建各的 worktree + 各建各的 ref（refName 含各自 memberId），互不串扰（同时回归验证 B7 校正）。
- listForIssue / listForMember 过滤正确；未找到返回 `[]`。
- 无 fake createWorktree 时（默认桩）调用 allocate 抛「not wired」错误。
- **snake_case 字段 undefined 断言**：从 D3 register 返回对象断言 `issue_id`/`worktree_id` 等 snake 键不存在（R14/R15/R16 回归护栏延续）。

**禁止 fixture 掩盖**：`createWorktree` 用 fake 返回确定 `{worktreeId, hostId}`（非空字符串本次随机 ID），其余全部真实落库；断言 camel + snake-undefined，不裸 `as`。

## 6. 验证命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH"
pnpm vitest run src/main/runtime/collaboration/worktree-allocator.test.ts src/main/runtime/collaboration/issue-git-ref-store.test.ts --config config/vitest.config.ts
pnpm tsc --noEmit -p config/tsconfig.node.json
pnpm oxlint
```

（`issue-git-ref-store.test.ts` 需补 per-member 多成员用例，确保 B7 校正有回归护栏。）

## 7. 禁止重犯清单（PROGRESS §5，逐条自查）

1. 不用 fixture/占位掩盖契约缺口；断言 camelKey + snake-undefined。
2. 无虚假声明（每方法真实实现 + 测试）。
3. 无死代码；`allocateWorktree`/`listForIssue`/`listForMember` 均被测试覆盖。
4. row 映射必须显式（复用 D3 `rowToWorktree`），禁止裸 `as unknown as`。
5. 命名与 team-types 完全一致（`issueId`/`memberId`/`worktreeId`/`hostId`）。
6. 文档 §9 分布 = 真实 `it(` 计数。
7. 不扩大范围（零 DDL / 零 IPC / 零前端 / 零版本升级 / 零真实 Orca Runtime 调用）。
8. B7 `ensureWorktreeRef` per-member 幂等必须修复并有回归测试（M2-3 验收：每成员独立 worktree/ref）。

## 8. 输出格式

### 本轮完成

### 实际修改文件

### 关键设计决策与理由

### 测试结果（真实分布核对 + tsc/lint）

### 风险与下一轮建议

---

## 决策记录：关键设计决策与理由（负责人侧）

1. **Orca Runtime 隔离在注入 seam 后者后**：`allocateWorktree` 只依赖 seam 返回 `{ worktreeId, hostId }`；生产默认桩抛「not wired」，测试注入 fake。这使得分配器逻辑（校验/幂等/per-member ref/登记/埋点）完全在纯后端单测覆盖，真实 `createManagedWorktree` 接线延后到 D4，把「关键一跳」从本轮剥离。
2. **幂等优先于重复报错**：D3 `register` 对同 issue+member 是抛错；分配器先 `getByIssueAndMember` 命中即返回，把「重复分配」降级为幂等成功，符合 M2-3「每 Issue 每成员一个 worktree」的声明式保障。
3. **B7 `ensureWorktreeRef` per-member 校正纳入本轮**：它是 D2 直接依赖、且破坏 M2-3 的既有缺陷，属 in-domain 小修（改幂等预查键 + 补多成员测试），一并闭环；否则分配器对第二成员会拿到错误的 refName。
4. **跨项目拒绝**：成员必须 ∈ issue 项目团队（复用 D1 `assertMemberInProject`），防止把公司级成员分配给无关 project 的 issue。

## 风险记录：风险与缓解（负责人侧）

| 风险 | 缓解 |
|------|------|
| 分配器无真实 worktree，验收偏逻辑层 | 明确本轮是「分配编排」；D4 接线真实 `createManagedWorktree` 时补 E2E，语义边界文档明示 |
| B7 `ensureWorktreeRef` 校正影响既有调用方 | 仅改幂等预查键（`owner`/无 memberId 语义不变）；补多成员回归测试；`issue-git-ref-store.test` 保持绿 |
| seam 生产默认桩抛错被误用 | 桩异常信息含「(D4)」，接线处（future D4）替换为真实适配；测试必测默认桩路径 |
| 幂等返回既有 vs D3 抛错语义混淆 | 分配器内统一「命中即返回」，register 的重抛仅作兜底，测试断言两种路径 |

---

## 9. 测试分布（开发 Agent 填，收口时核对真实 vitest）

<!-- 下表数字必须以运行时 `it(` 实际计数为准，禁止手填虚值；总计 = 各文件之和 -->
| 文件 | 用例数 |
|------|--------|
| `worktree-allocator.test.ts` | 11 |
| `issue-git-ref-store.test.ts`（新增 per-member 用例后合计） | 12（11→+1） |
| **新增/变动合计** | **12** |

既有 tests（collaboration 目录 13 文件）163 + 新增 12 = **175 总计**（14 文件）。

## 10. 复核结论

**结论：通过（不需修复 Prompt）。**

- **范围控制**：零 DDL / 零 SCHEMA_VERSION / 零 IPC / 零 preload / 零前端 / 零真实 Orca Runtime/git/terminal 调用。全部落在 `worktree-allocator.ts`（新增）+ `issue-git-ref-store.ts`（B7 per-member 小修）。
- **契约核对**：`allocateWorktree` 8 步与文档 §4.2 逐条一致（issue 校验 → `assertMemberInProject` → `getByIssueAndMember` 幂等返回 → seam create → `ensureWorktreeRef` per-member → `register` → `recordLifecycleEvent('worktree.allocated')` → `{worktree, ref}`）。`CreateWorktreeHandler` seam / `WorktreeAllocatorDeps` 注入 / 默认桩抛「not wired (D4)」/ 懒单例 + `__resetWorktreeAllocatorForTests()` 全部落地。
- **B7 校正落地**：`ensureWorktreeRef` 幂等预查改为 `selectByIssueAndRefName(issueId, 'worktree/'+memberId)`（per-member），第二成员不再拿到首成员 ref；有专门多成员回归用例（`ensureWorktreeRef is per-member`）。
- **回归护栏延续**：snake_case 字段 undefined 断言、显式映射（禁裸 `as`）、空数据返回 `[]`/`null`，均在本轮测试覆盖。
- **质量门禁**：
  - vitest：**14 文件 / 175 tests 全绿**（R17 新增 12：allocator 11 + git-ref-store +1）。
  - node tsc：`tsc --noEmit -p config/tsconfig.node.json` 零错误。
  - oxlint：`pnpm oxlint` 及 R17 涉及文件 `audit:code-quality:native` 零告警。
  - **预存告警（非本轮引入，未阻断）**：`pnpm run lint` 全链中的 `audit:code-quality:native` 检测到 3 个 `import(no-duplicates)` 告警，均在更早提交 `d75e34d5c` 已有文件（`issue-comment-store.test.ts:15`/`owner-collaboration.test.ts:20`/`pipeline.test.ts:20`），与 R17 无 git 关联（已用 stash 隔离验证 R17 文件剔除后同样告警）。可留后续清理轮（合并重复 `import type`），不建议本轮扩大范围处理。
- **文档数字一致性**：§9 分布 = 运行时真实 `it(` 计数；测试基线 13→14 文件、163→175 tests。
