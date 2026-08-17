# Round 6 - Harness 基础骨架

> 日期: 2026-08-17 | 阶段: M3 Harness 基础层 | 任务: execution-context / harness-engine / agent-runner / stream-event-normalizer

## 1. 本轮目标

在 Round 5 完成协作 IPC 基础上，推进 Harness 基础骨架的第一个最小闭环。

本轮完成 3 件事：

1. **执行上下文快照组装** — 从 project / issue / member / worktree 组装统一上下文
2. **Prompt 分层构建** — systemPrompt（角色/规则）与 userPrompt（场景/任务）分离
3. **轻量 AgentRunner 骨架** — 统一执行接口 + 事件归一化

## 2. 设计原则

- **Harness 不是固定流程模板** — 负责约束、上下文、提示词注入、反馈要求、收敛边界
- **运行时上下文必须显式** — 不能只传一个字符串 prompt
- **Prompt 必须分层** — systemPrompt 放角色与规则，userPrompt 放场景与输入
- **执行器必须可替换** — 不绑定具体 CLI，提供统一接口
- **事件流必须归一** — 为 pipeline-tracker 和评论回写打基础

## 3. 上下文模型定义

### HarnessExecutionContext

```typescript
type HarnessExecutionContext = {
  projectId: string
  projectPath: string
  projectName: string
  hostId: string
  hostType: string
  issueId: string
  issueNumber: number
  issueTitle: string
  worklineKey: string
  memberId: string
  memberName: string
  role: string
  assignmentTask: string
  worktreePath: string
  workMode: 'execute' | 'review' | 'ask'
  isOwner: boolean
}
```

### AgentExecutionPolicy

```typescript
type AgentExecutionPolicy = {
  maxTurns: number
  firstTokenTimeoutMs: number
  idleTimeoutMs: number
  allowedTools: string[]
  requireProgressComment: boolean
}
```

### AgentRunEvent

```typescript
type AgentRunEvent =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; toolName: string; callId: string; input?: unknown }
  | { type: 'tool_result'; toolName: string; callId: string; content: string; isError?: boolean }
  | { type: 'result'; status: 'success' | 'failed'; summary?: string; reason?: string }
```

## 4. Prompt 分层策略

### System Prompt 包含

- 角色与职责（member.name + member.role）
- 启用的技能列表（skills.filter(enabled)）
- 默认 Prompt（member.defaultPrompt）
- 行为规则：
  1. 关键操作后回写进度
  2. 完成后必须总结
  3. 超 scope 需负责人确认
  4. 不要无限膨胀需求
  5. 使用 orca CLI 工具

### User Prompt 包含

- 当前项目（名称、路径、宿主）
- 当前 Issue（编号、标题、工作线、工作目录、工作模式）
- 负责人附加提示（isOwner 时）
- 任务说明（assignmentTask）

## 5. Runner 统一接口

```typescript
interface AgentRunner {
  run(request: AgentRunRequest): AsyncIterable<AgentRunEvent>
}
```

本轮实现的 Runner：

| Runner | 用途 |
|--------|------|
| `MockAgentRunner` | 测试/开发阶段，产出预设事件序列 |
| `FailingAgentRunner` | 模拟失败路径 |
| `TimeoutAgentRunner` | 模拟超时场景 |

## 6. 事件归一化策略

`stream-event-normalizer.ts` 负责：

1. **tool_use → tool_result 配对** — 通过 callId 追踪
2. **孤儿工具调用检测** — 流结束时未配对的 tool_use 产出 warning
3. **metrics 统计** — 总事件数、thinking/text 计数、工具调用计数
4. **失败路径兼容** — 成功/失败都产出统一 result 事件

## 7. 实际修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/shared/team-types.ts` | 修改 | 新增 Harness 运行时类型定义 |
| `src/main/runtime/pipeline/execution-context.ts` | 新增 | 执行上下文快照组装 |
| `src/main/runtime/pipeline/harness-engine.ts` | 新增 | Prompt 分层构建 |
| `src/main/runtime/pipeline/agent-runner.ts` | 新增 | 统一执行接口 + Mock/Failing/Timeout Runner |
| `src/main/runtime/pipeline/stream-event-normalizer.ts` | 新增 | 事件归一化与工具配对 |
| `src/main/runtime/pipeline/pipeline.test.ts` | 新增 | 18 个测试覆盖四层骨架 |

## 8. 测试结果

```
Test Files  6 passed (6)
Tests       89 passed (89)
```

测试分布：

- `collaboration-database.test.ts`: 13 tests
- `team-store.test.ts`: 13 tests
- `project-store.test.ts`: 10 tests
- `issue-store.test.ts`: 15 tests
- `collaboration-ipc.test.ts`: 13 tests
- `pipeline.test.ts`: 25 tests（新增）

类型检查：`tsc --noEmit -p config/tsconfig.node.json` — 通过（无错误）

## 9. 未完成项

- 真实 CLI Agent Runner（如 Claude Code / Codex 适配）
- 与 Renderer 的状态同步
- 持久化运行记录（pipeline-tracker）
- 评论回写闭环
- 收敛规则与阻塞上报

## 10. 下一轮建议

按 ROADMAP 的 E2 系列继续推进：

1. **owner-collaboration 与评论回写闭环** — Agent 执行后自动在 Issue 中反馈进度
2. **pipeline-tracker** — 持久化运行记录，支持查询历史
3. **Agent 真实执行器适配** — 对接 Claude Code 或类似 CLI
4. **收敛规则与阻塞上报** — 当 Agent 卡住或超 scope 时上报

前提是：**先把 Harness 的上下文、执行器和事件流骨架稳定下来**（本轮已完成）。

---

## 11. 审查收口修复（2026-08-17）

对 §11.3 的修复 Prompt 进行实施，修复 4 个审查发现的问题。

### 11.1 修复完成

- ✅ 问题 1：`buildHarnessExecutionContext` 新增成员属于项目团队校验 + worktree 归属校验
- ✅ 问题 2：`worktreePath` 改为显式入参（方案 B），由上层 runtime 解析真实路径
- ✅ 问题 3：新增 `withPolicy` 策略强制层，`StuckAgentRunner` 替代误导性 `TimeoutAgentRunner`
- ✅ 问题 4：文档测试分布已核对更新（collaboration-database: 13, pipeline: 25, 总数 89）

### 11.2 实际修改文件

| 文件 | 改动 |
|------|------|
| `src/main/runtime/pipeline/execution-context.ts` | 新增 member∈project 校验、worktree 归属校验、`worktreePath` 显式入参 + 空路径 fail fast |
| `src/main/runtime/pipeline/agent-runner.ts` | 删除 `TimeoutAgentRunner`，新增 `StuckAgentRunner`（明确配合 withPolicy 使用），新增 `withPolicy` 策略强制层 |
| `src/main/runtime/pipeline/pipeline.test.ts` | 修复 fixture（worktreeId 使用真实 ID 样式 `wt-xxx`），新增 7 条回归测试 |

### 11.3 问题 2 / 3 的方案选择与理由

**问题 2 选择方案 B（最小）**：
- 理由：方案 A 需要 schema 迁移（v4→v5），增加 `worktree_path` 列，这在 worktree 记录创建时需要知道真实路径。但 worktree 创建由 Orca 上层完成，当前协作层无法获取路径。方案 B 将路径解析职责推给上层 host-aware runtime，协作层只负责校验非空，职责清晰且无 schema 变更。

**问题 3 选择方案 A（推荐）**：
- 理由：策略强制是 Harness 的核心职责，不能推迟。`withPolicy` 包装层实现了 idleTimeout（通过 `Promise.race` 真正中断 sleeping runner）、maxTurns 限制、allowedTools 白名单警告。`StuckAgentRunner` 明确配合 withPolicy 使用，不再声称自己验证超时。

### 11.4 withPolicy 实现要点

- 将 async iterator 转为 pull-based（`iterator.next()`），这样才能 race 超时
- `Promise.race([iterator.next(), timeoutPromise])` 实现真正的 idleTimeout 中断
- 每次成功产出事件后重置定时器
- 超出 maxTurns 时产出 failed result 并终止
- allowedTools 非空时产出 warning（不阻止，留给上层决定）

### 11.5 测试结果（含真实分布核对）

```
Test Files  6 passed (6)
Tests       89 passed (89)
```

真实分布核对：

| 文件 | 文档旧值 | 文档新值 | 实际值 |
|------|----------|----------|--------|
| `collaboration-database.test.ts` | 12 | 13 | 13 ✅ |
| `team-store.test.ts` | 13 | 13 | 13 ✅ |
| `project-store.test.ts` | 10 | 10 | 10 ✅ |
| `issue-store.test.ts` | 15 | 15 | 15 ✅ |
| `collaboration-ipc.test.ts` | 13 | 13 | 13 ✅ |
| `pipeline.test.ts` | 18 | 25 | 25 ✅ |
| **总数** | **81** | **89** | **89** ✅ |

类型检查：`tsc --noEmit -p config/tsconfig.node.json` — 通过（无错误）

### 11.6 禁止重犯的错误清单（长期约定）

1. **不得用测试 fixture 掩盖契约缺口**——测试里为了绕开校验而预调用 `inviteMember`、用路径字符串伪装 ID、空对象强转类型，都属于掩盖缺口，必须在测试中显式暴露缺口而不是绕过它
2. **不得有"声称生效但实际没有"的代码**——注释/文档描述的行为必须有对应实现或测试证明；做不到就删掉或明确标注待实现
3. **不得有死代码**——导出的 runner/类/函数至少被一个测试引用，否则删除
4. **不得漏掉既有 invariant**——本项目已确立的硬性约定（成员必须在项目团队、owner 必须在项目团队、删除保护）在新增代码路径里必须同样生效
5. **不得语义混淆**——ID、路径、名称是不同概念，字段映射必须真实反映语义
6. **文档数字必须与实现一致**——测试分布、接口数量、迁移版本，改代码后必须重新核对并更新，不许复制旧数据
7. **不要扩大修复范围**——只修审查指出的问题，不改 UI、不新增 IPC、不重构无关代码

### 11.7 下一轮建议

1. **owner-collaboration 与评论回写闭环** — Agent 执行后自动在 Issue 中反馈进度
2. **pipeline-tracker** — 持久化运行记录，支持查询历史
3. **Agent 真实执行器适配** — 对接 Claude Code 或类似 CLI
4. **收敛规则与阻塞上报** — 当 Agent 卡住或超 scope 时上报

---

## 12. 审查复核（2026-08-17）

### 12.1 复核结论

对上述实现进行代码审查，双 Agent 交叉验证（2/2 确认，无误报）。验证基础：6 个测试文件 82 个测试全绿、`tsc` 通过。以下问题均为逻辑/契约层，非编译错误。

| No. | Issue Title | 严重度 | 位置 |
|-----|-------------|--------|------|
| 1 | `buildHarnessExecutionContext` 未校验执行者属于项目团队 | 高 | `execution-context.ts` L34-L90 |
| 2 | `worktreePath` 取自 `worktree.worktreeId`，把实体 ID 当文件系统路径 | 高 | `execution-context.ts` L86 |
| 3 | `AgentExecutionPolicy` 从未强制执行；`TimeoutAgentRunner` 是误导性死代码 | 中 | `agent-runner.ts` L49-L60 |
| 4 | 文档测试分布错误：`collaboration-database.test.ts` 实际 13 个，文档写 12；分布求和 81 ≠ 总数 82 | 低 | 本文档 §8 |

### 12.2 缺口被测试掩盖的原因（教训）

1. **问题 1**：`pipeline.test.ts` 在调用前预调用 `inviteMember`，绕过了本应被校验的"成员属于项目团队"，绿灯掩盖缺口。
2. **问题 2**：fixture 用 `/wt/...` 路径字符串伪装成 `worktreeId`，并断言 `ctx.worktreePath === worktree.worktreeId`，把错误映射固化进了测试。
3. **问题 3**：`TimeoutAgentRunner` 只 `sleep(idleTimeoutMs + 1000)` 后照常结束，注释声称"验证超时中断"但无任何中断机制，且未被测试引用。

### 12.3 修复 Prompt（已交付代码 Agent，见 §11 修复记录）

以下为修复方案的完整 Prompt，包含 4 个问题的修复要求、验证命令与禁止重犯清单。

---

# 修复 Prompt：Round 6 Harness 基础层审查收口

## 0. 工作目录

`/Users/wang/Documents/work/ranxin/code/rx-cli`

## 1. 背景

Round 6 完成的 Harness 基础骨架（execution-context / harness-engine / agent-runner / stream-event-normalizer）经审查发现 4 个问题。其中 2 个高严重度问题是**契约性缺口**，当前被测试 fixture 掩盖；另有 1 个误导性死代码、1 个文档数字错误。

**当前状态**：6 个测试文件 82 个测试全绿，`tsc` 通过。问题不在编译层，在逻辑/契约层。

## 2. 先阅读的文件

- `docs/team-collaboration/multi-agent-iteration/2026-08-17-round6-harness-foundation.md`
- `src/main/runtime/pipeline/execution-context.ts`
- `src/main/runtime/pipeline/agent-runner.ts`
- `src/main/runtime/pipeline/harness-engine.ts`
- `src/main/runtime/pipeline/stream-event-normalizer.ts`
- `src/main/runtime/pipeline/pipeline.test.ts`
- `src/shared/team-types.ts`
- `src/main/runtime/collaboration/project-store.ts`（`listMembers`）
- `src/main/runtime/collaboration/issue-store.ts`（`assertOwnerInProject` 参考实现）
- `src/main/runtime/collaboration/collaboration-database.ts` 与 `collaboration-database.test.ts`

## 3. 本轮要修复的 4 个问题

### 问题 1（高）：`buildHarnessExecutionContext` 未校验执行者属于项目团队

**位置**：`execution-context.ts` L34-L90

**现状**：只校验了 project 存在、issue 存在、issue 属于 project、member 全局存在；**从未调用 `projectStore.listMembers()` 校验 memberId 属于该项目的 `project_team_members`**。

**影响**：任何全局团队成员都能以任意项目身份组装执行上下文，违反本项目已确立的硬性 invariant（见 `issue-store.ts` 的 `assertOwnerInProject` 和 round4 沉淀记录）。owner invariant 只约束 issue.ownerId，约束不到执行者 memberId。

**修复要求**：
1. 调用 `deps.projectStore.listMembers(input.projectId)`，校验 `input.memberId` 在其中，否则 `throw new Error('Team member is not in the project team: ...')`
2. 同时校验 `input.worktree.memberId === input.memberId`，防止用别人的 worktree 组装上下文
3. 校验顺序：project → issue → issue 归属 project → member 存在 → **member ∈ 项目团队** → worktree 归属

**补回归测试**：
- 非项目团队成员构建上下文 → 抛错
- worktree.memberId 与 input.memberId 不一致 → 抛错
- 现有"正常组装成功"测试保持通过

---

### 问题 2（高）：`worktreePath` 取自 `worktree.worktreeId`，把实体 ID 当文件系统路径

**位置**：`execution-context.ts` L86

**现状**：`worktreePath: input.worktree.worktreeId`。而 `issue_worktrees.worktree_id` 是 Orca worktree **实体 ID**（DB 样例 `'wt-xyz'`），不是目录路径。`harness-engine.ts` L99 把它写进 prompt"你的工作目录: ..."，真实 Agent 会拿一个 ID 当目录去操作，直接失效。

**为什么测试没发现**：`pipeline.test.ts` 的 fixture 用 `'/wt/${issueId}/${memberId}'` 路径字符串伪装成 `worktreeId`，并在 L149 断言 `ctx.worktreePath === worktree.worktreeId`，把错误映射固化进了测试。

**修复要求（二选一，选择后说明理由）**：
- **方案 A（推荐）**：在 `issue_worktrees` 表增加 `worktree_path TEXT` 列（schema 迁移到 v5，沿用 drop-and-recreate 或单表重建均可，需说明选择），创建 worktree 记录时从 Orca worktree 实体写入真实路径；`IssueWorktree` 类型增加 `worktreePath` 字段；`buildHarnessExecutionContext` 映射真实路径，缺路径时 fail fast。
- **方案 B（最小）**：`BuildHarnessContextInput` 增加显式 `worktreePath: string` 入参，由调用方（上层 runtime，host-aware）解析真实路径传入；`buildHarnessExecutionContext` 不再从 `worktreeId` 推导，空路径 fail fast。

**无论哪个方案**：
- 删除测试里"路径字符串伪装 ID"的 fixture 和 `ctx.worktreePath === worktree.worktreeId` 断言
- 测试必须用真实的 ID 样式（如 `'wt-xyz'`）构造 worktree，证明 path 不再取自 ID

---

### 问题 3（中）：`AgentExecutionPolicy` 从未强制执行；`TimeoutAgentRunner` 是误导性死代码

**位置**：`agent-runner.ts` L49-L60

**现状**：
- `maxTurns / idleTimeoutMs / firstTokenTimeoutMs / allowedTools` 全项目无任何强制逻辑
- `TimeoutAgentRunner` 只 `setTimeout(idleTimeoutMs + 1000)` 睡完再 yield result，注释却声称"验证 policy.idleTimeoutMs 能否正确中断执行"——没有任何中断机制
- 该 runner 未被任何测试导入（`pipeline.test.ts` L35 只导入 Mock/Failing）

**修复要求（二选一）**：
- **方案 A（推荐）**：新增一个策略强制层（如 `withPolicy(runner, policy)` async generator wrapper）：
  - 用 `Promise.race` / `AbortController` 实现 idleTimeout 中断
  - 统计事件轮次，超出 `maxTurns` 时产出 `result: failed` 并终止
  - `allowedTools` 非空时，非白名单 `tool_use` 产出 warning（或直接拒绝，按设计说明）
  - 为 `withPolicy` 补测试：`TimeoutAgentRunner` 在 idleTimeout 到达时**真正中断**（不再等到 sleep 结束），并断言中断原因
- **方案 B（最小）**：删除 `TimeoutAgentRunner`，删除其误导性注释；在文档"未完成项"中明确补一条"策略强制（超时/轮次/工具白名单）待实现"

**禁止**：保留一个声称验证超时但没有超时逻辑的 runner。

---

### 问题 4（低）：round6 文档测试分布错误

**位置**：`2026-08-17-round6-harness-foundation.md` L135-L142

**现状**：`collaboration-database.test.ts` 写 12 个，实际 13 个；分布求和 81 ≠ 总数 82。

**修复要求**：改为实际分布（`collaboration-database.test.ts: 13 tests`，总数 82）。改完后用真实命令核对，不许拍脑袋写数字。

---

## 4. 验证命令（必须执行并记录结果）

```bash
PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH" pnpm vitest run src/main/runtime/collaboration/*.test.ts src/main/ipc/collaboration-ipc.test.ts src/main/runtime/pipeline/*.test.ts
PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH" pnpm tsc --noEmit -p config/tsconfig.node.json
```

测试通过后，**重新核对测试分布**（`rg -n "^\s*it\(" <每个测试文件> | wc -l`），把实际数字写进文档，并确认分布之和等于总数。

## 5. 禁止重犯的错误清单（本轮必须自查，且写进你的迭代文档作为长期约定）

1. **不得用测试 fixture 掩盖契约缺口**——测试里为了绕开校验而预调用 `inviteMember`、用路径字符串伪装 ID、空对象强转类型，都属于掩盖缺口，必须在测试中显式暴露缺口而不是绕过它
2. **不得有"声称生效但实际没有"的代码**——注释/文档描述的行为必须有对应实现或测试证明；做不到就删掉或明确标注待实现
3. **不得有死代码**——导出的 runner/类/函数至少被一个测试引用，否则删除
4. **不得漏掉既有 invariant**——本项目已确立的硬性约定（成员必须在项目团队、owner 必须在项目团队、删除保护）在新增代码路径里必须同样生效
5. **不得语义混淆**——ID、路径、名称是不同概念，字段映射必须真实反映语义
6. **文档数字必须与实现一致**——测试分布、接口数量、迁移版本，改代码后必须重新核对并更新，不许复制旧数据
7. **不要扩大修复范围**——只修这 4 个问题，不改 UI、不新增 IPC、不重构无关代码

## 6. 交付物

1. 实际代码修改
2. 新增/更新的测试（含回归测试）
3. 更新后的 `2026-08-17-round6-harness-foundation.md`：新增一节"审查收口修复"，记录 4 个问题的修复方案（含问题 2/3 的方案选择理由）、验证结果、以及**禁止重犯的错误清单**（第 5 节）

## 7. 输出格式

### 修复完成
- xxx

### 实际修改文件
- xxx

### 问题 2 / 3 的方案选择与理由
- xxx

### 测试结果（含真实分布核对）
- xxx

### 风险 / 待确认项
- xxx

### 下一轮建议
- xxx

---

### 12.4 复核通过结论（2026-08-17）

对 §11 修复结果进行复跑复核，双 Agent 交叉验证 + 独立复跑测试。

**结论：Round 6 审查收口通过。**

| No. | 问题 | 修复结果 | 复核证据 |
|-----|------|----------|----------|
| 1 | 执行者未校验属于项目团队 | ✅ 已修复 | `execution-context.ts` 调用 `listMembers` 校验 member ∈ 项目团队 + 校验 worktree 归属执行者；回归测试 2 条（非项目团队成员 / worktree 不属于执行者） |
| 2 | `worktreePath` 取自 `worktree.worktreeId` | ✅ 已修复（方案 B） | `worktreePath` 改为显式入参、空路径 fail fast；fixture 改用真实 ID 样式 `wt-xxx`，断言 path 不再取自 ID |
| 3 | 策略未强制 / `TimeoutAgentRunner` 误导性死代码 | ✅ 已修复（方案 A） | 新增 `withPolicy` 策略强制层（idleTimeout 真实中断 / maxTurns / allowedTools）；`StuckAgentRunner` 替代并配"真中断"测试（elapsed < 800ms 断言） |
| 4 | 文档测试分布错误 | ✅ 已修复 | 分布核对：db 13 / team 13 / project 10 / issue 15 / ipc 13 / pipeline 25 = **89** |

**验证结果**（独立复跑，Node 24.14.0 / pnpm 10.24.0）：

```
Test Files  6 passed (6)
Tests       89 passed (89)
tsc --noEmit -p config/tsconfig.node.json: exit 0
```

**遗留低优先级观察**（不影响本轮收口，建议下一轮处理）：
- `withPolicy` 的"中断"是包装层停止消费，底层 runner 的 `setTimeout` 未取消（无 `AbortController` 传递）。真实 CLI runner 落地时应接线取消机制，避免悬挂的 pending promise。

**Round 6 迭代收口完成**，下一轮按 ROADMAP E2/E4/E5 系列推进（见 §10 / §11.7）。
