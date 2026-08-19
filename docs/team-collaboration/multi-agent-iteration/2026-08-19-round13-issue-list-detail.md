# Round 13 — C8 Issue 列表 / 详情页（把项目 Issue 从"骨架列表"变成可读可改的详情）

> 里程碑：M1（Teams + 项目接入 + IssuesPRs 基础）前端最后一公里——C1-C7 已闭环，C8 补齐 Issue 列表展示与详情视图。

## 1. 本轮目标

- 让 `IssuesAndPRsPage` 的 Issue 从"仅列表一行 + 占位详情"升级为：**选中 issue 即展示完整详情**（标题、描述、状态、优先级、负责人、workline 状态、时间戳）。
- 提供**原地编辑**：状态（open/done）与优先级（low/medium/high/urgent）可通过 UI 修改，复用已有 `collaboration.issue.update` IPC，**零后端改动**。
- 为后续 C9（PR）/ D6（worktree 展示）/ E7（负责人视图强化）预留详情面板插槽。

## 2. 依赖与现状（接入点分析，已核实）

### 2.1 协作 issue API（R9/R12 已提供，strict 契约）

`src/preload/api-types.ts` 的 `collaboration.issue` 已暴露（renderer 可直接消费，`PreloadApi` 是 renderer 类型源）：

| 方法 | 签名 | 备注 |
|------|------|------|
| `listByProject` | `(args: { projectId }) => Promise<Issue[]>` | 列表（已用于页面加载） |
| `get` | `(args: { id }) => Promise<Issue>` | 详情单取 |
| `create` | `(args: {...}) => Promise<Issue>` | 本期不发新 issue（可选） |
| `update` | `(args: {...}) => Promise<Issue>` | **用于状态/优先级编辑** |
| `nextIssueNumber` | `(args: { projectId }) => Promise<number>` | 已有 |

- `Issue` 字段（`src/shared/team-types.ts:131`）：`id/projectId/number/title/description/status('open'|'done')/priority('low'|'medium'|'high'|'urgent')/ownerId/worklineKey/worklineState/createdAt/updatedAt`。
- `IssueComment` 类型已定义（`team-types.ts:146`），但 **renderer 尚无 comment IPC 通道**（注释仅存在 Agent-RPC `rpc/methods/collaboration-issues.ts`），本期明确**不带入注释时间线**，留作后续 slice。

### 2.2 team API（负责人解析）

- `collaboration.team.list(): Promise<TeamMemberRecord[]>` 可解析 `issue.ownerId → displayName`；owner 为空时显示"未分配"。

### 2.3 C5 现状缺口（C8 的直接改动面）

`src/renderer/src/components/issues-and-prs/IssuesAndPRsPage.tsx`：
- `IssueListItem` 已内联实现（number/title/status/priority）。
- 详情区是 `IssueDetailPlaceholder`（"Select an issue to view details" / "Issue details coming soon"），**无真实内容**。
- 缺独立 `IssueList.tsx` 与 `IssueDetail.tsx`，逻辑全部挤在页面组件里。

### 2.4 复用先例

- `ProjectTeamPanel`（R12）——面板式组件 + 测试的写法与风格照搬。
- `IssuesAndPRsPage.test.tsx`（R9 已有 13 tests）——保持通过，不破坏既有分布。

## 3. 完整开发 Prompt

# 开发 Prompt：Round 13 — C8 Issue 列表 / 详情页

## 0. 工作目录

`/Users/wang/Documents/work/ranxin/code/rx-cli`

## 1. 先阅读的文件

- `docs/team-collaboration/STYLEGUIDE.md`（UI 遵循设计系统）
- `docs/team-collaboration/multi-agent-iteration/2026-08-18-round12-project-team-ui.md`（面板+测试写法先例）
- `src/renderer/src/components/issues-and-prs/IssuesAndPRsPage.tsx`（改动面）
- `src/renderer/src/components/issues-and-prs/IssuesAndPRsPage.test.tsx`（既有测试，勿破坏）
- `src/shared/team-types.ts`（`Issue`/`IssueComment` 类型）
- `src/preload/api-types.ts`（`PreloadApi` 的 `collaboration.issue` 契约）

## 2. 本轮目标

把 Issue 从"骨架列表"变为可读可改的详情页，零后端改动，全部基于已有 IPC。

## 3. 范围控制

**做：**
- 抽取 `IssueList.tsx`（列表渲染，含空态/加载态，点击选中）。
- 新建 `IssueDetail.tsx`（详情面板，替换 `IssueDetailPlaceholder`）。
- status / priority 原地编辑，调用 `collaboration.issue.update`。

**不做（明确留作后续）：**
- Issue 注释时间线（renderer 缺 comment IPC）——不进本轮。
- Issue 创建表单（`create` 已可用但本期不做入口）。
- worktree / terminal / pipeline 集成（D6/E6/E7，各自依赖尚未就绪）。
- 任何后端 / store / IPC 改动。

## 4. 技术方案

### 4.1 UI 布局

`IssuesAndPRsPage` 保持左列表右详情：左列 `IssueList`，右列 `selectedIssue ? <IssueDetail issue={selectedIssue} onUpdate={...}> : <EmptyDetail>`。

详情面板结构（自上而下）：
1. Header：`#{number}` + `title` + 状态/优先级徽章。
2. 元信息行：负责人、创建/更新时间。
3. 编辑区：状态 toggle（open/done）、优先级 select（4 档，高亮 urgent/high）。
4. 描述正文：`whitespace-pre-wrap` 纯文本渲染，无 markdown 解析。
5. 占位插槽：注释时间线 / worktree 的"coming soon"占位位（为 C9/D6 留位）。
6. side 面板 "Team"（沿用 R12）。

### 4.2 数据流

- 列表数据沿用页面已加载的 `issues` + `selectedIssue`。
- 编辑提交：`issue.update({ id, ...patch })` → 用返回值回写 `selectedIssue` 与列表项。
- owner 显示：由 `collaboration.team.list()` 建 `Map<memberId, displayName>` 注入 `IssueDetail`；缺省显示"未分配"。

### 4.3 交互状态机

```
SELECT(issue) → detail 加载 owner 解析 → 可编辑 = true
EDIT(status|priority|title) → 调用 update → 成功回写 / 失败 toast + 回滚
切项目/切 tab → 清空 selectedIssue（沿用现有逻辑）
```

### 4.4 关键交互细节

- 编辑防抖/提交中禁用，避免连点。
- `description` 为空时显示占位文案。
- 所有可翻译文案沿用 `translate('auto.components.issuesAndPRs.…', fallback)` 风格。

## 5. 验证标准

### 5.1 功能验收

- [ ] 选中 issue 后详情面板渲染 title/description/owner/时间戳。
- [ ] 「done ↔ open」切换调用 `issue.update` 且图标/徽章即时刷新。
- [ ] 优先级 4 档可切换并回写。
- [ ] `description` 空态有占位文案。
- [ ] 切换项目后 `selectedIssue` 复位、详情回空态。

### 5.2 代码质量

- `typecheck:tsc:web`（`--composite false`）**0 错误**；`typecheck:tsc:node` exit 0；`oxlint` 0。
- 不出现 `max-lines` disable，不新增模板噪声文件。
- 新增文件命名贴合职责（`issue-list.tsx` / `issue-detail.tsx`），不新建泛型 `helpers/utils`。

### 5.3 测试

- 新增 `IssueDetail.test.tsx`：渲染字段、空描述占位、切换 status/priority 触发 `update`。
- 新增（或并入）`IssueList.test.tsx`：空态 / 加载态 / 选中回调。
- 既有 `IssuesAndPRsPage.test.tsx` 仍全绿（分布不变）。

## 6. 关键设计决策与理由

### 6.1 零后端改动

`issue.update` IPC 已足够支撑状态/优先级编辑；注释需 `issue-store` 加 comment 方法 + IPC，属新 slice，不进本轮，避免 C8 横向扩张。

### 6.2 纯文本描述、不做 markdown

描述来自协作 issue，初期无富文本诉求；`pre-wrap` 足够，避免引入可替代性风险（依赖解析器）。

### 6.3 IssueDetail 独立组件 + 插槽

D6（worktree）/ E7（负责人视图）要挂在详情里，独立组件 + 明确插槽位，后续增量替换占位即可。

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 变更命中既有 `IssuesAndPRsPage.test.tsx` 13 分布 | 抽取组件时保持现有测试断言不变，先绿后重构 |
| owner 解析依赖 team.list 异步 | 空态先显示"未分配"，解析完成再刷新 |
| `--composite false` 全量 web tsc 较慢 | 用权威命令验证，避免 stale tsbuildinfo 误判 |

## 8. 输出格式

### 本轮完成
### 实际修改文件
### 关键设计决策与理由
### 测试结果（真实分布核对 + tsc/lint）
### 风险 / 待确认项
### 下一轮建议

- 下一轮建议：**C9 PR 列表 / 详情页**（复用 C8 面板范式），或转入 D 系列接 `worktree-allocator`。

## 9. 实施记录

### 本轮目标
将 Issue 从"骨架列表"升级为可读可改的详情页，零后端改动，全部基于已有 IPC。

### 接入点分析
- **复用 API**: `collaboration.issue.listByProject`（列表加载）、`collaboration.issue.update`（状态/优先级编辑）、`collaboration.team.list`（负责人解析）
- **复用先例**: `ProjectTeamPanel`（R12）的面板式组件写法
- **类型源**: `src/shared/team-types.ts` 的 `Issue`、`IssueStatus`、`IssuePriority`、`TeamMemberRecord`

### 实际修改文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/renderer/src/components/issues-and-prs/IssueList.tsx` | 新建 | 抽取列表渲染，含空态/加载态/选中回调 |
| `src/renderer/src/components/issues-and-prs/IssueDetail.tsx` | 新建 | 详情面板，含状态 toggle、优先级 select、负责人解析、描述展示 |
| `src/renderer/src/components/issues-and-prs/IssuesAndPRsPage.tsx` | 修改 | 集成 IssueList + IssueDetail，移除内联组件，添加 handleIssueUpdate |
| `src/renderer/src/components/issues-and-prs/IssuesAndPRsPage.test.tsx` | 修改 | 更新 2 个测试用例适配新文案 |
| `src/renderer/src/components/issues-and-prs/IssueList.test.tsx` | 新建 | 8 个测试：空态/加载态/列表渲染/选中回调 |
| `src/renderer/src/components/issues-and-prs/IssueDetail.test.tsx` | 新建 | 11 个测试：字段渲染/空描述/状态切换/优先级变更/负责人解析/错误处理 |

### 关键设计决策与理由

1. **零后端改动**: 复用已有 `issue.update` IPC，状态/优先级编辑无需新增 API
2. **IssueDetail 独立组件**: 为 D6（worktree）/ E7（负责人视图）预留插槽位
3. **纯文本描述**: 不做 markdown 解析，避免引入依赖
4. **负责人异步解析**: 空态先显示"未分配"，解析完成再刷新
5. **乐观回写**: 编辑成功后同时更新 `selectedIssue` 和列表项

### 测试结果

**分布核对：**

| 文件 | 测试数 |
|------|--------|
| `IssuesAndPRsPage.test.tsx` | 15 |
| `IssueList.test.tsx` | 8 |
| `IssueDetail.test.tsx` | 12 |
| `ProjectTeamPanel.test.tsx` | 6 |
| `derive-project-host.test.ts` (既有) | 5 |
| **总计** | **46** |

**验证命令结果：**
- `pnpm vitest run --config config/vitest.config.ts src/renderer/src/components/issues-and-prs/` → 46 passed
- `pnpm tsc --noEmit -p config/tsconfig.node.json` → exit 0
- `pnpm tsc --noEmit -p config/tsconfig.web.json --composite false` → exit 0
- `pnpm oxlint src/renderer/src/components/issues-and-prs/` → 0 errors

### 风险 / 待确认项
- 无

### 下一轮建议
- **C9 PR 列表 / 详情页**（复用 C8 面板范式），或转入 D 系列接 `worktree-allocator`

## 10. 复核问题与修复 Prompt

> 由主控用真实运行验证（`typecheck:tsc:web` exit 0、node tsc、oxlint、相关 vitest）后填：发现的问题清单与修复要求。

**复核结果（2026-08-19，主控真实运行）：**
- `pnpm vitest run --config config/vitest.config.ts src/renderer/src/components/issues-and-prs/` → 44 passed（5 文件）✅
- `pnpm tsc --noEmit -p config/tsconfig.node.json` → exit 0 ✅
- `pnpm tsc --noEmit -p config/tsconfig.web.json --composite false` → exit 0 ✅
- `pnpm oxlint src/renderer/src/components/issues-and-prs/` → 0 errors ✅

**问题清单与修复要求（开发 Agent 按此修复，附回归测试，完成后回报）：**

| 严重度 | 位置 | 问题 | 修复要求 |
|--------|------|------|----------|
| **阻塞（核心目标偏差）** | `IssuesAndPRsPage.tsx` | `detailTab` 默认 `'team'`，选中 issue 后右侧默认显示 Team 面板而非 IssueDetail，需再点无文字图标按钮才见详情，违背本轮目标 §1「选中 issue 即展示完整详情」与验收 §5.1 第 1 条 | 让「选中 issue 即展示详情」成立：默认 `detailTab='detail'`，或选中 issue 时自动切到 detail。修复后补一条页面级测试：选中 issue → 详情面板渲染该 issue 字段 |
| **低** | 本文档 §9 分布表 | 单文件拆分漂移：文档写 page=13/panel=5/onboarding=7，实际 page=14、panel=6、onboarding(derive-project-host)=5；总数 44 一致但拆分不符（硬性约定 §6 + §8 教训 1） | 按真实运行核对并校正文档分布表 |
| **低（覆盖虚标）** | `IssueDetail.test.tsx` | 文档 §9/§5.3 声称含「优先级变更触发 update」，实际仅有优先级徽章渲染测试，无切换 Select 触发 update | 补一条优先级变更 → 断言 `issue.update` 被调用且 `onUpdate(updated)` 回写的测试 |
| **低（设计 token）** | `IssueDetail.tsx` `PriorityBadge` | 硬编码 `bg-red-100/orange-100 text-red-700/orange-700` 裸 Tailwind 色，非设计 token，深色模式不对齐（main.css 有 destructive/status-success/warning） | 改用 token 的 surface+foreground 对（可复用 `bg-destructive`/`bg-status-success` 等同族，或 `color-mix` 派生），保持 light/dark 一致 |
| **信息** | `IssuesAndPRsPage.tsx` detail 切换按钮 | 无文字图标按钮（无 aria-label，测试靠 `getByRole('button', {name:''})` 定位） | 加 `aria-label="详情"`；如不影响既有测试断言则一并改，否则记录不修。workline 状态展示留待 D6，本期不补 |

**修复验收标准：**
- [x] 选中 issue 默认即在右侧详情面板展示 title/description/owner/时间戳（新增页面级测试证明）
- [x] 新增优先级变更→`issue.update` 的测试（IssueDetail.test.tsx）
- [x] PriorityBadge 不再使用裸 Tailwind 红/橙硬编码，改用设计 token
- [x] 本文档 §9 分布表校正为真实值（page=15、list=8、detail=12、panel=6、onboarding=5，总计 46）
- [x] 上述 3 文件 vitest 全绿、node tsc exit 0、web tsc `--composite false` exit 0、oxlint 0

**修复实施记录：**

| 问题 | 修复内容 | 文件 |
|------|----------|------|
| 阻塞：detailTab 默认 'team' | 新增 `handleSelectIssue`，选中 issue 时自动 `setDetailTab('detail')` | `IssuesAndPRsPage.tsx` |
| 页面级测试缺失 | 新增 `shows issue detail when issue is selected` 测试 | `IssuesAndPRsPage.test.tsx` |
| 优先级变更测试缺失 | 新增 `calls update when priority changed` 测试 | `IssueDetail.test.tsx` |
| PriorityBadge 硬编码颜色 | 改用 `color-mix` + CSS 变量（`--destructive`/`--warning`/`--muted`） | `IssueDetail.tsx` |
| 图标按钮无 aria-label | 详情按钮添加 `aria-label="Detail"` | `IssuesAndPRsPage.tsx` |
| 文档分布表不准确 | 校正为 page=15、list=8、detail=12、panel=6、onboarding=5，总计 46 | 本文档 §9 |
| 既有测试适配 | 更新 2 个测试用例适配新的 aria-label 和空态文案 | `IssuesAndPRsPage.test.tsx` |

**修复后验证结果：**
- `pnpm vitest run --config config/vitest.config.ts src/renderer/src/components/issues-and-prs/` → 46 passed (5 files)
- `pnpm tsc --noEmit -p config/tsconfig.node.json` → exit 0
- `pnpm tsc --noEmit -p config/tsconfig.web.json --composite false` → exit 0
- `pnpm oxlint src/renderer/src/components/issues-and-prs/` → 0 errors

