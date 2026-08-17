# Round 7 — E4 Agent 评论回调与负责人总结识别

> 日期: 2026-08-17 | 阶段: M3 Pipeline | 任务: E4 `owner-collaboration.ts`（含本地评论 Store）

## 1. 本轮目标

在 Round 6 Harness 基础骨架（execution-context / harness-engine / agent-runner / stream-event-normalizer）之上，完成 **E4 Agent 评论回调与负责人总结识别** 的最小闭环：

1. **本地 Issue 评论 Store** — 基于已有 `issue_comments` 表，提供评论 CRUD 与列表
2. **执行结果总结** — 从归一化事件流提炼 Agent 执行总结
3. **评论回写闭环** — Agent 执行完成后自动在 Issue 评论中反馈进度/结果
4. **负责人总结识别（基础版）** — 负责人身份识别与总结评论生成

本轮完成后，系统具备"Agent 干活 → 自动回写 Issue 评论 → 团队可见进度"的闭环能力。

## 2. 依赖与现状

### 2.1 已具备（Round 5 / Round 6）

| 能力 | 文件 | 说明 |
|------|------|------|
| 协作 IPC | `src/main/ipc/collaboration-*.ts` | team.* / project.* / issue.* |
| 上下文快照 | `src/main/runtime/pipeline/execution-context.ts` | 含成员 ∈ 项目团队校验 |
| Prompt 分层 | `src/main/runtime/pipeline/harness-engine.ts` | systemPrompt / userPrompt |
| 策略强制 | `src/main/runtime/pipeline/agent-runner.ts` | withPolicy（idleTimeout / maxTurns / allowedTools） |
| 事件归一化 | `src/main/runtime/pipeline/stream-event-normalizer.ts` | tool_use ↔ tool_result 配对、metrics |
| `issue_comments` 表 | `collaboration-database.ts` | schema 已建，无 Store 层 |

### 2.2 当前缺口

- 协作模块**没有本地评论 Store**——现有 `addIssueComment` 均为 GitHub/Linear/Jira 等外部 provider 的 IPC，与本地协作库无关
- **没有执行结果 → 评论的自动链路**

### 2.3 设计约束（来自 TECH-DESIGN / PRD）

- 评论默认**项目团队可见**，不做内外隔离（TECH-DESIGN L448）
- 负责人是**推荐的对外同步者**，不是唯一可写评论者（TECH-DESIGN L449）
- 系统只提供协作骨架：Issue、评论、worktree、terminal、PR、状态流转（TECH-DESIGN L480）
- Harness 规则已包含"任务完成后必须评论总结"（TECH-DESIGN L739）

## 3. 完整开发 Prompt

---

# 开发 Prompt：Round 7 — E4 Agent 评论回调与负责人总结识别

## 0. 工作目录

`/Users/wang/Documents/work/ranxin/code/rx-cli`

## 1. 先阅读的文件

### 迭代与设计文档
- `docs/team-collaboration/multi-agent-iteration/2026-08-17-round6-harness-foundation.md`（重点 §3 上下文模型、§5 Runner 接口、§11 修复记录、§12.4 复核结论）
- `docs/team-collaboration/TECH-DESIGN.md`（重点：`issue_comments` 表结构 L194、评论可见性设计 L448-L449、协作骨架 L480、评论规则 L607-L609）
- `docs/team-collaboration/PRD.md`（评论与负责人机制）

### 代码
- `src/main/runtime/pipeline/execution-context.ts`
- `src/main/runtime/pipeline/harness-engine.ts`
- `src/main/runtime/pipeline/agent-runner.ts`（withPolicy）
- `src/main/runtime/pipeline/stream-event-normalizer.ts`
- `src/main/runtime/pipeline/pipeline.test.ts`
- `src/main/runtime/collaboration/collaboration-database.ts`（`issue_comments` 表）
- `src/main/runtime/collaboration/issue-store.ts`（Store 范式参考）
- `src/main/runtime/collaboration/team-store.ts` / `project-store.ts`（注入与测试范式）
- `src/shared/team-types.ts`

## 2. 本轮目标

完成 E4 最小闭环，4 件事：

1. **IssueCommentStore** — 本地 `issue_comments` 表的 Store 层
2. **summarizeRun** — 从归一化事件提炼执行总结
3. **评论回写闭环** — Agent 执行完成后自动回写 Issue 评论
4. **负责人总结识别（基础版）** — 识别执行者是否为负责人并生成对应总结

## 3. 范围控制

### 要做
- `src/main/runtime/collaboration/issue-comment-store.ts`（新）
- `src/main/runtime/pipeline/owner-collaboration.ts`（新）
- 必要的 shared types 扩展（`IssueComment` 若有缺口）
- 对应测试

### 不做
- 不做 UI / Renderer
- 不做评论权限隔离（按设计：项目团队均可见即可）
- 不做 pipeline-tracker（E5 下一轮）
- 不做收敛规则引擎（F1）
- 不接真实 CLI runner（仍用 Mock / 现有 runner）
- 不改 `issue_comments` 表 schema（除非发现必需缺口，需说明理由）
- 不新增 IPC（本轮 Store 层 + pipeline 层闭环；IPC 留给后续 UI 轮次）

## 4. 实现要求

### 4.1 IssueCommentStore

参考 `issue-store.ts` 的范式（显式依赖注入 + `__resetXxxForTests`）：

- `createComment(issueId, authorId, authorType, body)` — 校验 Issue 存在、author 存在
- `listByIssue(issueId)` — 按 created_at ASC 返回，支持分页（可选）
- 返回对象字段与 `issue_comments` 表 + `PrComment` 类型风格一致
- 遵循既有 invariant 模式：author 必须存在（全局团队成员）；**不做**"必须属于项目团队"的评论写入拦截（按设计：负责人是推荐同步者，不封堵成员评论，TECH-DESIGN L609）
- ID 生成沿用既有 `tm_${randomBytes(8).toString('hex')}` 风格（用本地短 ID，如 `ic_` 前缀）

### 4.2 summarizeRun

输入归一化后的运行结果（`collectNormalizedEvents` 的输出），输出结构化总结：

- 运行状态（success / failed）
- 产出摘要（最后一个 text / result.summary）
- 工具调用统计（次数、成功/失败）
- 孤儿工具告警数
- 耗时（可选，若事件流有时间戳；没有就不虚构）

**禁止**：不要用 LLM 生成总结——本轮是确定性规则总结（Harness 原则：系统落库负责事实，角色行为由 Prompt 驱动）。

### 4.3 评论回写闭环（owner-collaboration.ts 核心）

提供 `postRunComment` 类函数，组装并写入评论：

```
run Agent（withPolicy 包裹）→ 归一化事件 → summarizeRun → 回写 Issue 评论
```

- 评论正文包含：执行者、角色、结果状态、总结、工具统计
- 执行者身份（memberId / memberName）来自 HarnessExecutionContext
- **不自动改 Issue 状态**（status 流转属于负责人决策，本轮不做自动化状态迁移；如需更新，走既有 `issue-store.update` 由上层决定）

### 4.4 负责人总结识别（基础版）

- `isOwner` 已在 HarnessExecutionContext 中（由 issue.ownerId 推导，Round 6 已实现）
- 基础版：执行者是负责人时，评论标注 `[负责人]`；非负责人时标注 `[成员]`
- **不要**本轮就实现"负责人自动识别 Agent 行为是否合规"等复杂逻辑——那是 M4 收敛阶段的事

## 5. 测试要求

至少覆盖：

1. IssueCommentStore：创建成功 / Issue 不存在抛错 / author 不存在抛错 / 列表按时间排序
2. summarizeRun：成功路径提炼 / 失败路径（reason 保留）/ 空事件流处理
3. 评论回写闭环：执行 MockAgentRunner 后产生一条评论，正文包含执行者与结果
4. 负责人 vs 成员：`[负责人]` / `[成员]` 标注正确
5. 至少一个错误路径（如回写时 Issue 已被删除）
6. 禁止用 fixture 掩盖缺口（沿用 Round 6 §11.6 错误清单）

推荐测试位置：
- `src/main/runtime/collaboration/issue-comment-store.test.ts`
- `src/main/runtime/pipeline/owner-collaboration.test.ts`（或并入现有 pipeline.test.ts，按文件内聚选择）

## 6. 验证命令（必须执行并记录结果）

```bash
PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH" pnpm vitest run src/main/runtime/collaboration/*.test.ts src/main/ipc/collaboration-ipc.test.ts src/main/runtime/pipeline/*.test.ts
PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH" pnpm tsc --noEmit -p config/tsconfig.node.json
```

测试通过后**重新核对测试分布**（`rg -n "^\s*it\(" <每个测试文件> | wc -l`），确认分布之和等于总数。

## 7. 禁止重犯的错误清单（长期约定，沿用 Round 6 §11.6）

1. **不得用测试 fixture 掩盖契约缺口**
2. **不得有"声称生效但实际没有"的代码**
3. **不得有死代码**——导出的函数/类至少被一个测试引用
4. **不得漏掉既有 invariant**——成员必须在项目团队、owner 必须在项目团队、删除保护
5. **不得语义混淆**——ID、路径、名称是不同概念
6. **文档数字必须与实现一致**——测试分布、接口数量、迁移版本
7. **不要扩大修复范围**——只做本轮目标，不做 UI、不新增 IPC、不重构无关代码

## 8. 交付物

1. 实际代码修改
2. 新增/更新的测试
3. 更新本文档（`2026-08-17-round7-owner-collaboration.md`）：实施记录、方案选择理由、验证结果、测试分布核对

## 9. 输出格式

### 本轮完成
- xxx

### 实际修改文件
- xxx

### 关键设计决策与理由
- xxx

### 测试结果（含真实分布核对）
- xxx

### 风险 / 待确认项
- xxx

### 下一轮建议
- xxx

---

## 4. 下一轮衔接（E5 预告）

Round 7 收口后，按 ROADMAP 继续：

| 下一轮 | 任务 | 依赖 | 落点 |
|--------|------|------|------|
| Round 8 | E5 Pipeline 追踪器 | D1, E1, E2c, E4 | `pipeline-tracker.ts` 持久化运行记录 |
| Round 8/9 | E1 Pipeline CLI | B5, B6, D3 | `pipeline-cli.ts` 标准化 Agent 沟通 |
| Round 9+ | E6 Pipeline 可视化 UI / E7 负责人视图强化 | E5, C8 | Renderer |

> 注：E1（Pipeline CLI）尚未实现，E5 依赖链中的 E1 若构成硬阻塞，需在 Round 8 前评估是否先做 E1 最小版（仅 `orca issue comment` / `orca issue update` 两个命令的最小闭环）。

---

## 10. 实施记录（2026-08-17）

### 10.1 本轮完成

- ✅ IssueCommentStore — 本地 `issue_comments` 表的 Store 层（创建/获取/列表）
- ✅ summarizeRun — 从归一化事件流提炼确定性执行总结（不用 LLM）
- ✅ 评论回写闭环 — Agent 执行完成后自动在 Issue 评论中反馈进度/结果
- ✅ 负责人总结识别（基础版）— `[负责人]` / `[成员]` 标注

### 10.2 实际修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/main/runtime/collaboration/issue-comment-store.ts` | 新增 | issue_comments 表的 Store 层 |
| `src/main/runtime/pipeline/owner-collaboration.ts` | 新增 | summarizeRun + postRunComment |
| `src/main/runtime/collaboration/issue-comment-store.test.ts` | 新增 | 7 个测试 |
| `src/main/runtime/pipeline/owner-collaboration.test.ts` | 新增 | 9 个测试 |

### 10.3 关键设计决策与理由

**IssueCommentStore 校验策略**：
- Issue 必须存在（防止评论挂在已删除的 Issue 上）
- Author 必须是真实团队成员（全局存在），但不要求属于项目团队 — 按 TECH-DESIGN L609，成员可评论 Issue
- 不拦截非项目团队成员的评论写入 — 与既有设计保持一致

**summarizeRun 总结策略**（确定性规则，不用 LLM）：
- 优先使用 `result.summary`
- 失败时使用 `result.reason`
- 回退到最后一段 `text` 事件
- 统计工具调用次数、成功/失败、孤儿数量

**评论回写闭环**：
- 评论正文包含：执行者、角色、结果状态、总结、工具统计
- `[负责人]` / `[成员]` 标注由 `context.isOwner` 推导
- 不自动改 Issue 状态（status 流转属于负责人决策）

### 10.4 测试结果（含真实分布核对）

```
Test Files  8 passed (8)
Tests       105 passed (105)
```

真实分布核对：

| 文件 | 实施时 | 审查收口后 | 实际值 |
|------|--------|------------|--------|
| `collaboration-database.test.ts` | 13 | 14 | 14 ✅ |
| `team-store.test.ts` | 13 | 13 | 13 ✅ |
| `project-store.test.ts` | 10 | 10 | 10 ✅ |
| `issue-store.test.ts` | 15 | 15 | 15 ✅ |
| `collaboration-ipc.test.ts` | 13 | 13 | 13 ✅ |
| `pipeline.test.ts` | 25 | 25 | 25 ✅ |
| `issue-comment-store.test.ts` | 7 | 7 | 7 ✅（新增） |
| `owner-collaboration.test.ts` | 9 | 9 | 9 ✅（新增） |
| **总数** | **105** | **106** | **106** ✅ |

类型检查：`tsc --noEmit -p config/tsconfig.node.json` — 通过（无错误）

### 10.5 风险 / 待确认项

- summarizeRun 是确定性规则总结，后续如需更丰富的总结（如"做了哪些具体变更"）可能需要引入 LLM 或更复杂的规则
- 评论回写闭环目前由上层显式调用 `postRunComment`，尚未与 Agent 执行器自动串联（可在后续轮次中封装为 `runAgentWithComment` 高级函数）

### 10.6 下一轮建议

1. **Pipeline 追踪器（E5）** — 持久化运行记录，支持查询历史
2. **Agent 真实执行器适配** — 对接 Claude Code 或类似 CLI
3. **评论回写自动化** — 将 postRunComment 与 Agent 执行器串联，实现真正的"执行 → 自动回写"闭环
4. **收敛规则与阻塞上报** — 当 Agent 卡住或超 scope 时上报

---

## 11. 审查收口修复（2026-08-17）

### 11.1 修复完成

- ✅ 问题 A：删除测试中 `worktreePath: worktree.worktreeId` 的语义混淆，使用 `makeContext` 默认真实路径
- ✅ 问题 B：统一 `authorType` 默认值为 `'agent'`（DDL + store），迁移 v4→v5

### 11.2 实际修改文件

| 文件 | 改动 |
|------|------|
| `src/main/runtime/pipeline/owner-collaboration.test.ts` | 删除 L238 `worktreePath: worktree.worktreeId`，改用默认真实路径 |
| `src/main/runtime/collaboration/collaboration-database.ts` | `author_type` DDL 默认 `'user'`→`'agent'`，`SCHEMA_VERSION` 4→5，补 v4→v5 迁移 |
| `src/main/runtime/collaboration/collaboration-database.test.ts` | `user_version` 断言 4→5，新增 DDL 默认值验证测试 |

### 11.3 测试结果（含真实分布核对 + 迁移版本）

```
Test Files  8 passed (8)
Tests       106 passed (106)
```

真实分布核对：

| 文件 | 旧值 | 新值 | 实际值 |
|------|------|------|--------|
| `collaboration-database.test.ts` | 13 | 14 | 14 ✅ |
| `team-store.test.ts` | 13 | 13 | 13 ✅ |
| `project-store.test.ts` | 10 | 10 | 10 ✅ |
| `issue-store.test.ts` | 15 | 15 | 15 ✅ |
| `collaboration-ipc.test.ts` | 13 | 13 | 13 ✅ |
| `pipeline.test.ts` | 25 | 25 | 25 ✅ |
| `issue-comment-store.test.ts` | 7 | 7 | 7 ✅ |
| `owner-collaboration.test.ts` | 9 | 9 | 9 ✅ |
| **总数** | **105** | **106** | **106** ✅ |

迁移版本：`SCHEMA_VERSION` 4 → 5（v4→v5 迁移：drop-and-recreate，对齐 `issue_comments.author_type` 默认 `'agent'`）

类型检查：`tsc --noEmit -p config/tsconfig.node.json` — 通过（无错误）

### 11.4 风险 / 待确认项

- 无阻塞风险。v4→v5 迁移采用 drop-and-recreate 策略（与 v1→v2、v3→v4 一致），适用于 pre-release 阶段。

---

## 12. 审查复核（2026-08-17）

### 12.1 复核结论

对上述实现进行代码审查，双 Agent 交叉验证（2/2，无误报）。验证基础：8 个测试文件 105 个测试全绿、`tsc` 通过。核心闭环通过，无阻塞问题。

| No. | Issue Title | 严重度 | 结论 |
|-----|-------------|--------|------|
| A | `owner-collaboration.test.ts` L238 用 `worktree.worktreeId` 覆盖 `worktreePath`（fixture 语义混淆，违反"worktreePath ≠ ID"约定） | 低 | 修复（见 §11） |
| B | `issue-comment-store.ts` 默认 `authorType 'agent'` vs DDL `DEFAULT 'user'`（双重真相源） | 低 | 修复（见 §11） |
| C | `requireProgressComment` 未强制执行；评论回写为"结束后一条"而非执行中 | 信息 | 观察项（文档 §10.5 已注明，属 E4 范围外） |
| D | 评论正文使用 ✅/❌ emoji | 信息 | 可接受（STYLEGUIDE 无 emoji 禁令） |
| E | `postRunComment` 不校验 issue 属于 project | 信息 | 可接受（依赖上游 `buildHarnessExecutionContext` invariant，分层正确） |

### 12.2 修复 Prompt（A + B，已交付代码 Agent，见 §11 修复记录）

---

# 修复 Prompt：Round 7 审查收口（A + B）

## 0. 工作目录

`/Users/wang/Documents/work/ranxin/code/rx-cli`

## 1. 先阅读的文件

- `docs/team-collaboration/multi-agent-iteration/2026-08-17-round7-owner-collaboration.md`
- `src/main/runtime/pipeline/owner-collaboration.test.ts`
- `src/main/runtime/collaboration/issue-comment-store.ts`
- `src/main/runtime/collaboration/issue-comment-store.test.ts`
- `src/main/runtime/collaboration/collaboration-database.ts`（`issue_comments` 表 DDL + migrate）
- `src/main/runtime/collaboration/collaboration-database.test.ts`

## 2. 本轮要修复的 2 个问题

### 问题 A：测试 fixture 语义混淆

**位置**：`owner-collaboration.test.ts` L238

**现状**：
```typescript
const ctx = makeContext({
  ...
  worktreePath: worktree.worktreeId   // ❌ worktreeId 是实体 ID，不是路径
})
```

`makeWorktree` 的 `worktreeId` 是 `'wt-${memberId}-xyz'`（实体 ID 样式），却被当作 `worktreePath` 传入。这违反了项目已确立的约定（`execution-context.ts` L25-L27 注释：worktreePath 是文件系统真实路径，不是实体 ID），且测试直接构造 context 绕过了 `buildHarnessExecutionContext` 的 fail-fast。

**影响**：不影响任何断言（`postRunComment` 不读 worktreePath），但会误导后续读者，且与 Round 6 §11.6 错误清单第 5 条"不得语义混淆"冲突。

**修复要求**：
- 删除 `worktreePath: worktree.worktreeId` 覆盖（`makeContext` 默认已是真实路径 `/home/user/workspaces/wt-m1`），或改为显式真实路径（如 `makeWorktreePath(member.id)` 风格）
- 若该测试不再需要 `worktree` 变量，可一并清理 `setupIssueWithMember` 中多余的部分（worktree 实体本身仍需保留在 fixture 供构造，判断后决定）

### 问题 B：authorType 默认值双重真相源

**位置**：
- `issue-comment-store.ts` L96：`input.authorType ?? 'agent'`
- `collaboration-database.ts` L128：`author_type TEXT NOT NULL DEFAULT 'user'`

**现状**：store 默认 `'agent'`（表意"Agent 自动回写"），DDL 默认 `'user'`（表意"人工评论"）。当前 store 总是显式传值所以无运行时错误，但 DDL 默认是"死配置"——未来任何省略 `author_type` 的裸 SQL / 迁移 / 种子会静默得到 `'user'`，与 store 契约相反。

**修复要求（推荐方案，若选其他方案需说明理由）**：
- 统一为 `'agent'`：将 `issue_comments.author_type` 的 DDL 默认值改为 `'agent'`，同时保留 store 的 `?? 'agent'`
- **必须同步 SCHEMA_VERSION v4 → v5** 并补迁移：沿用既有模式（schema 未发布阶段可 drop-and-recreate，参考 v3→v4 的写法），并更新 `collaboration-database.test.ts` 中 `user_version` 断言（4 → 5）
- 保持 `issue-comment-store.test.ts`"默认 authorType 为 agent"测试通过
- 在 `collaboration-database.test.ts` 补充/确认 DDL 默认值断言（直接对 `issue_comments` 做缺省 INSERT 验证默认值为 `'agent'`）

## 3. 禁止重犯的错误清单（沿用 Round 6 §11.6，必须自查）

1. 不得用测试 fixture 掩盖契约缺口
2. 不得有"声称生效但实际没有"的代码
3. 不得有死代码
4. 不得漏掉既有 invariant
5. 不得语义混淆（ID ≠ 路径）
6. **文档数字必须与实现一致**——测试分布、迁移版本（4→5）改后必须重新核对并更新 round7 文档 §10.4
7. 不要扩大修复范围——只修 A、B

## 4. 验证命令（必须执行并记录结果）

```bash
PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH" pnpm vitest run src/main/runtime/collaboration/*.test.ts src/main/ipc/collaboration-ipc.test.ts src/main/runtime/pipeline/*.test.ts
PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH" pnpm tsc --noEmit -p config/tsconfig.node.json
```

测试通过后**重新核对测试分布**（`rg -n "^\s*it\(" <每个测试文件> | wc -l`），确认分布之和等于总数，并更新文档 §10.4。

## 5. 交付物

1. 实际代码修改（A + B）
2. 测试更新
3. 更新 round7 文档 §10.4（若测试分布/版本变化）并新增一节"审查收口修复"记录 A/B 修复结果

## 6. 输出格式

### 修复完成
- xxx

### 实际修改文件
- xxx

### 测试结果（含真实分布核对 + 迁移版本）
- xxx

### 风险 / 待确认项
- xxx

---
