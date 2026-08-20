# Round 15 — M1 后端收口：B7 git-ref 注册器 + A5 activity-log + B2 agent-config 语义层

> 里程碑：M1（Teams + 项目接入 + IssuesPRs 基础）后端收口。C 系列前端（R8-R14）已全部落地、PR 数据通道（B6 最小版，R14）已闭环；本轮补上 M1 后端最后三项缺口 **B7 / A5 / B2**，让 `issue_git_refs` 与 `activity_log` 两张已有表真正有 store 可读可写、让 `team_members.agent_config`/`skills` 有独立语义层，为 M2（D 系列 worktree 分配）铺底。纯后端逻辑本轮，**零 IPC、零前端、零 DDL**。

## 1. 本轮目标

- **B7**：新建 `issue-git-ref-store.ts`（文档落点 `git-ref-registry.ts`），对已有 `issue_git_refs` 表提供读写，支撑 owner/worktree/PR 源 ref 管理。
- **A5**：新建 `activity-log-store.ts`，对已有 `activity_log` 表提供写入与按项目查询，作为协作域审计日志。
- **B2**：新建 `agent-config.ts` + `skill-binding.ts` 语义层，在 `team-store` 已实现的列级读写之上，提供 Agent/Skill 可用性与绑定校验逻辑。
- 全部复用既存表/类型/Store 范式，**不改 DDL、不升 SCHEMA_VERSION、不建 IPC/preload、不动前端**。

## 2. 依赖与现状（接入点分析，已核实）

### 2.1 数据库表已就绪，无需迁移

`src/main/runtime/collaboration/collaboration-database.ts`：

- `issue_git_refs` 表（L193-206）：`id/issue_id/ref_name/ref_role/member_id/purpose/status/created_at/updated_at`，唯一索引 `idx_issue_git_refs_name(issue_id, ref_name)`，`FOREIGN KEY issue_id → issues ON DELETE CASCADE`，`member_id → team_members ON DELETE SET NULL`。
- `activity_log` 表（L208-220）：`id/project_id/actor_type/actor_id/actor_name/action/target_type/target_id/metadata(DEFAULT '{}')/created_at`，索引 `idx_activity_project(project_id, created_at DESC)`，`FOREIGN KEY project_id → projects ON DELETE CASCADE`。
- `team_members` 表（L47-68）已含 `agent_config TEXT DEFAULT '{}'`、`skills TEXT DEFAULT '[]'`、`agent_model`。
- `SCHEMA_VERSION = 5` 保持不变，**本次零 DDL / 零迁移**。

### 2.2 类型已就绪

`src/shared/team-types.ts` 已定义：

- `IssueGitRef`（L205-215）：`id/issueId/refName/refRole('owner'|'member'|'release'|'experiment')/memberId?/purpose/status/createdAt/updatedAt`
- `ActivityLog`（L217-228）：`id/projectId?/actorType/actorId/actorName/action/targetType?/targetId?/metadata:Record<string,unknown>/createdAt`
- `TeamMember.agentConfig: Record<string, unknown>`（L28）、`UpdateTeamMemberInput.agentConfig?`（L88）、`SkillBinding`（L10-15）

### 2.3 参照范式（照 issue-comment-store 抄）

`src/main/runtime/collaboration/issue-comment-store.ts` 是最近 B7/A5 的参照形态：

- const-object store + `CreateXStoreDeps` 依赖注入 + `createXStore(deps)` + `getXStore()` 懒单例 + `__resetXStoreForTests()`
- ID 前缀：team `tm_` / issue `iss_` / pr `pr_` / comment `ic_`
- 时间戳：`new Date().toISOString()`（ISO TEXT，非文档的 INTEGER 毫秒）
- 数组/Record JSON 列：`serializeStrings`/`deserializeStrings`/`serializeRecord`/`deserializeRecord`（team-store L12-42）
- snake→camel：`rowToX()` 显式映射
- 业务校验：先查关联实体再 insert，避免裸 `SQLITE_CONSTRAINT`

### 2.4 已核实空缺（避免重复实现）

`src/main/runtime/collaboration/` 现有 `collaboration-database / git-probe / issue-comment-store / issue-store / pr-store / project-store / team-store`。**`issue_git_refs` 与 `activity_log` 目前只有建表；无人读写。`agent-config.ts` / `skill-binding.ts` 不存在。** 三者均需从零新增。

## 3. 完整开发 Prompt

# 开发 Prompt：Round 15 — M1 后端收口（B7 + A5 + B2）

## 0. 工作目录

`/Users/wang/Documents/work/ranxin/code/rx-cli`

## 1. 先阅读的文件

- `src/main/runtime/collaboration/issue-comment-store.ts` + `.test.ts`（B7/A5 主参照范式）
- `src/main/runtime/collaboration/team-store.ts`（ID/serialize helper/单例模式参照；B2 复用的列读写来源）
- `src/main/runtime/collaboration/issue-store.ts` + `pr-store.ts`（跨 store 校验 `assertOwnerInProject` 模式）
- `src/shared/team-types.ts`（`IssueGitRef`/`ActivityLog`/`TeamMember`/`SkillBinding`）
- `src/main/runtime/collaboration/collaboration-database.ts`（`getCollaborationDb()` 单例 + 表结构）
- `docs/team-collaboration/PROGRESS.md` §5（硬性约定 + 禁止重犯清单）

## 2. 本轮目标

纯后端 store + 语义层 + 单测，全部复用既存表/类型/范式，**不改 DDL、不升版本、零 IPC 接线、零前端、零 preload 改动**。

## 3. 范围控制

**做：**

- B7 `issue-git-ref-store.ts`：`create` / `listByIssue` / `ensureOwnerRef` / `ensureWorktreeRef` / `getPreferred` / `getPreferredPrSourceRef`（或等价最小集，见 §4.1 约定）+ 单测。
- A5 `activity-log-store.ts`：`log`（写入） / `listByProject` / `get`（可选） + 单测。
- B2 `agent-config.ts` + `skill-binding.ts`：在 `team-store` 列级读写之上提供语义层（见 §4.3）+ 单测。
- 在 `src/main/runtime/collaboration/` 一个确认了新增文件清单后写对应的 `.test.ts`。

**不做（明确留作后续，防扩大范围）：**

- **不新增 DB 表、不改列、不升 `SCHEMA_VERSION`、不写迁移**。
- **不接 IPC**（`collaboration:*.`、preload `api-types.ts`/`index.ts`）——本轮无前端消费者，B7/A5/B2 先做 store 层，D 系列接入时再暴露通道。
- **不接前端**任何组件 / 页面 / 翻译文案。
- **不做 D1-D7 worktree 分配 / terminal 启动 / PR 真实 git 拉通**——B7 只是 ref 注册器，不创建真实分支。
- **不重复 team-store 的列级 CRUD**（agent_config/skills 的 insert/update/read 已在 team-store），B2 只补语义校验与可用性查询，不在新文件里重写 insert/update。
- **不引入假数据/占位 fixture 掩盖缺失**——方法真实读写 DB，空数据返回空数组而非编造。

## 4. 技术方案

### 4.1 B7 `issue-git-ref-store.ts`

- 方法（职责对齐 TECH-DESIGN `gitRefRegistry` 设计稿，但以实用最小集为准）：
  - `create(input: CreateIssueGitRefInput): IssueGitRef` — 校验 `issueId` 存在（先查 issue，避免裸约束）；插入；冲突（同 issue+refName）抛明确错误或语义化处理。
  - `listByIssue(issueId): IssueGitRef[]`
  - `ensureOwnerRef(issueId, memberId)` — 对 `refRole='owner'` 的幂等确保（存在则返回，不存在则建），供 D1 用。
  - `ensureWorktreeRef(issueId, memberId)` — 同上去中心化 worktree ref。
  - `getPreferred(issueId, refRole?)` / `getPreferredPrSourceRef(issueId)` — 返回最优先候选（供 PR 源分支用）。
  - `get(id)` + `listByRefName(projectId?, refName)`（可选）。
  - 至少覆盖：`create`、`listByIssue`、`ensureOwnerRef`、`ensureWorktreeRef`、`getPreferred`、`getPreferredPrSourceRef`。若评估某方法 D 系列用不到，可在 Prompt 里删除并说明。
- ID 前缀 `iref_`（注意不要与 records 前缀冲突），时间戳 ISO，`refRole` 用 `team-types` 联合类型。
- 行映射 `rowToGitRef(row)` 显式 camel（snake→camel，含 `issue_id→issueId`、`member_id→memberId`、`ref_role→refRole`），**禁止 `as unknown as IssueGitRef`**（沿用 R14 pr-store 教训）。
- 校验 `memberId`：若传入，确认 ∈ `issue` 所属项目团队（可经 project-store / issue 持有者复核，避免孤立 member_id）。

### 4.2 A5 `activity-log-store.ts`

- `log(input: ActivityLogInput): ActivityLog` — 写入一行，`metadata` 经 `serializeRecord`，自动补 `createdAt`/`id`（前缀 `al_`）。`projectId` 可选（公司级全局事件可为空）。
- `listByProject(projectId, opts?): ActivityLog[]` — 按 `created_at DESC` 排序；`opts.limit` 可选。
- `get(id)` — 可选。
- 行映射 `rowToActivity(row)` 显式 camel（含 `project_id→projectId`、`actor_type→actorType`、`target_type→targetType`、`metadata` 经 `deserializeRecord` 还原为对象），**禁止裸 `as`**。
- 不做其他 store 的自动埋点（本轮 store 独立，调用方接入在哪取决于 D 系列/现有 store 回填，未要求前不四处 insert）。

### 4.3 B2 `agent-config.ts` + `skill-binding.ts`（语义层）

- **不在新文件重写列级 CRUD**，复用 `team-store` 的 `TeamMemberRecord`/`getTeamStore()` 拿到 `agentConfig`/`skills`/`agentModel`/`agentType`。
- `agent-config.ts`：
  - `isAgentAvailable(memberId)` — 依据 `isActive`/`agentModel` 非空/`agentConfig` 中必要键（如 `runtime`）判断成员是否可被指派执行任务。
  - `resolveAgentModel(memberId)` — 返回生效 model（`agentModel` 或 `agentConfig` 覆盖，缺省策略说明）。
  - `getEffectivePrompt(memberId)` — `default_prompt` + `agentConfig.prompt` 覆盖合成。
  - 校验策略需明确"缺省值"来源与优先级，避免与 team-store/DDL 默认值双重真相源（PROGRESS 硬性约定 #4）。
- `skill-binding.ts`：
  - `parseSkillBindings(memberId)` — 解析 `skills` JSON 为 `SkillBinding[]`（容错非法 JSON）。
  - `hasSkill(memberId, skillId)` / `listSkillsByCategory(memberId?)` 之类语义查询。
  - 绑定校验：若 `SkillBinding` 结构含 `enabled/tier` 之类字段，校验遵循既存 type；缺省合理默认并说明。

### 4.4 文件名与单例约定

- 文件：`issue-git-ref-store.ts` / `activity-log-store.ts` / `agent-config.ts` / `skill-binding.ts`（均放 `src/main/runtime/collaboration/`）。
- 单例：`getIssueGitRefStore()`、`getActivityLogStore()` 懒创建 + `__resetXStoreForTests()`；`agent-config`/`skill-binding` 用纯函数 + 显式 `StoreType`（或 deps）参数，不强制单例状态（若为纯函数则依赖 `getTeamStore()`）。
- 不新增 `helpers/utils` 等泛型文件（PROGRESS 命名约定）。

## 5. 测试要求

- `issue-git-ref-store.test.ts`：create 成功 + 重复 refName 冲突/语义 + listByIssue 排序 + ensureOwnerRef/ensureWorktreeRef 幂等 + getPreferred/getPreferredPrSourceRef 选首 + 未知 issue/memberId 抛错 + snake→camel 字段一致（`issueId`/`memberId`/`refRole` 校验）。
- `activity-log-store.test.ts`：log 写入 + listByProject 排序（created_at DESC）+ projectId 过滤 + metadata 经 serialize/deserialize 往返一致（对象↔JSON）+ 空项目返回 []。
- `agent-config.test.ts` / `skill-binding.test.ts`：可用性判断（isActive/model/缺省键）、model 覆盖优先级、非法 skills JSON 容错、hasSkill/listByCategory。
- **禁止 fixture 掩盖**：每条测试走真实 `getCollaborationDb()`（或注入 in-memory db），断言返回业务类型字段为 camelKey（如 `issueId`/`projectId`/`refRole`），不裸 `as`。
- 分布数字：文档 §9 必须与各文件 `it(` 计数一致，收口前跑真实 vitest 核对总数 = 各之和。

## 6. 验证命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH"
pnpm vitest run src/main/runtime/collaboration/issue-git-ref-store.test.ts src/main/runtime/collaboration/activity-log-store.test.ts src/main/runtime/collaboration/agent-config.test.ts src/main/runtime/collaboration/skill-binding.test.ts --config config/vitest.config.ts
pnpm tsc --noEmit -p config/tsconfig.node.json
pnpm oxlint
```

## 7. 禁止重犯清单（PROGRESS §5，逐条自查）

1. 不用 fixture/占位掩盖契约缺口（方法真实读写 DB，断言 camelKey 字段）。
2. 无虚假声明（每方法真实实现+测试，不留声称未测的代码）。
3. 无死代码（不建未使用的方法；若设计稿方法本轮用不到，删除并说明）。
4. 不漏 invariant（snake→camel 行映射必须 `rowToX`，禁止裸 `as unknown as`）。
5. 不语义混淆（`issueId`/`projectId`/`refRole` 命名与 team-types 完全一致，不引入拼写变体）。
6. 文档数字与实现一致（§9 分布 = 真实 `it(` 计数）。
7. 不扩大范围（零 DDL / 零 IPC / 零前端 / 零版本升级）。
8. Store 默认值与 DDL 默认值统一（B2 缺省策略单一真相源，避免与 `'{}'`/`'[]'` 默认双重漂移）。

## 8. 输出格式

### 本轮完成

### 实际修改文件

### 关键设计决策与理由

### 测试结果（真实分布核对 + tsc/lint）

### 风险与下一轮建议

---

## 决策记录：关键设计决策与理由（负责人侧）

1. **纯后端本轮，零 IPC/前端**：B7/A5/B2 均无前端消费者，接 IPC 只会引入"无 UI 的空通道"；D 系列接入 worktree 时才暴露，避免 YAGNI。
2. **B7/A5 复用既存表 + issue-comment-store 范式**：表/类型已 backfill 进 schema v5，本轮只需 store + 测试，杜绝过度设计和重复建表。
3. **B2 只补语义层不碰列 CRUD**：`team-store` 已完整实现 agent_config/skills 列读写（TCOLLAB-003）；B2 的价值在"可用性/绑定/合成"逻辑，重复 CRUD 会是死代码。

## 风险记录：风险与缓解（负责人侧）

| 风险 | 缓解 |
| ------ | ------ |
| B7 方法集过大（设计稿 ensureOwnerRef/ensureWorktreeRef/getPreferred 等） | 以 D 系列实用最小集为准，删未用方法并说明 |
| B2 与 team-store 缺省值双重真相源 | 单一来源策略：agentConfig 覆盖 > agentModel > DDL 默认；文档明示优先级 |
| row 映射再用裸 `as`（R14 教训重演） | 强制 `rowToX` + 测试断言 camel 键 |
| activity_log 无调用方（U 场景不足） | 本轮做 store + 单测，埋点回填在 D 系列/调用方接入时决定 |
| `--composite false` 全量 web tsc 慢 | 用权威命令验证，避免 stale tsbuildinfo 误判 |

---

## 9. 测试分布（开发 Agent 填，收口时核对真实 vitest）

<!-- 下表数字必须以运行时 `it(` 实际计数为准，禁止手填虚值；总计 = 各文件之和 -->
| 文件 | 用例数 |
| ------ | -------- |
| `issue-git-ref-store.test.ts` | 11 |
| `activity-log-store.test.ts` | 10 |
| `agent-config.test.ts` | 19 |
| `skill-binding.test.ts` | 21 |
| **新增总计** | **61** |

既有 tests（本目录 7 文件）78 + 新增 61 = **139**。

**验证命令结果：**

- `pnpm vitest run src/main/runtime/collaboration --config config/vitest.config.ts` → **139 passed (11 files)**
- `pnpm tsc --noEmit -p config/tsconfig.node.json` → **0 error**
- `pnpm oxlint src/main/runtime/collaboration` → **0**

## 10. 复核结论

### ✅ R15 复核通过（零阻塞问题，收口）

真实验证：后端 collaboration 目录 **139 passed**（11 files），分布精确吻合（78 既有 + 61 新增）；`tsc`(node) 0、目录 `oxlint` 0。范围完全符合（纯后端 4 store + 4 测试，零 DDL / 零 IPC / 零前端 / 零版本升级）。

逐项核查记录：

1. **B7 `issue-git-ref-store.ts`**：`rowToGitRef` 显式 snake→camel 映射（issueId/memberId/refRole），无裸 `as`；`ensureOwnerRef`/`ensureWorktreeRef` 幂等；`getPreferred`/`getPreferredPrSourceRef` 取最新优先；未知 issue 抛「Issue not found」、重复 refName 抛「already exists」——业务校验 + 关联实体预查兼备。
2. **A5 `activity-log-store.ts`**：`log` 序列化 metadata（serializeRecord/deserializeRecord 往返一致），`listByProject` 按 created_at DESC，projectId 过滤与空集返回正确。
3. **B2 `agent-config.ts` + `skill-binding.ts`**：只补语义层、未重复 team-store 列级 CRUD；可用性/模型覆盖优先级与 team-types 字段名完全一致；非法 skills JSON 容错回退。
4. **防 fixture 掩盖传导**：测试走真实 in-memory DB + 前置依赖 store（team/project/issue）真实构建；`issue-git-ref-store.test.ts` 明确断言 snake_case 字段 `undefined`（camel-only），正是 R14 pr-store 教训的回归护栏。
5. **数字一致**：文档 §9 分布 11+10+19+21=61，与真实 `it(` 计数吻合，无漂移。

**R15 收口完成**（M1 后端 B7/A5/B2 补齐，M1 后端 100%）。后续 D 系列 worktree 分配即可基于 B6/B7 真实数据闭环。
