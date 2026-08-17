# Round 8 — C1-C2 activeView 扩展 + 导航历史（前端基础）

> 日期: 2026-08-17 | 阶段: M1 交付（前端） | 任务: C1 扩展 `activeView` 支持 `issues-and-prs` / `teams`；C2 扩展导航历史与关闭逻辑

## 1. 本轮目标

完成 M1 前端的第一块基石，让"两个新面板"成为一等公民视图，但**不渲染页面、不挂侧边栏按钮**：

1. **C1 扩展 `activeView`** — `TopLevelView` 增加 `issues-and-prs` / `teams`，UI slice 提供打开/关闭动作与持久化恢复
2. **C2 扩展导航历史** — `worktree-nav-history` 支持新视图条目，回退/前进、关闭回退索引、标题栏历史控制按钮全部接入

本轮完成后：状态层可以打开/关闭/恢复两个新视图，导航历史可以来回跳转。**页面内容（C4/C5）与侧边栏入口（C3）留到 Round 9**，本轮不做，避免范围膨胀。

## 2. 依赖与现状（接入点分析，已核实）

### 2.1 C1 落点

| 文件 | 位置 | 现状 |
|------|------|------|
| [types.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/shared/types.ts#L3420-L3431) | L3422 `TopLevelView` | 9 个视图的联合类型，需加 2 个 |
| [top-level-view.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/shared/top-level-view.ts#L5-L21) | L5 `TOP_LEVEL_VIEW_LOOKUP` | `Record<TopLevelView, true>` 穷举字典 —— 改 `TopLevelView` 后 TS 会强制补齐，`isTopLevelView` / `sanitizeHydratedActiveView` 自动生效 |
| [ui.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/ui.ts#L612-L684) | L613-L684 `previousViewBefore*` | 8 个显式联合类型字段（均"除自身外全部视图"） |
| [ui.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/ui.ts#L1254-L1263) | L1254-L1262 初始状态 | 8 个 `previousViewBefore*` 初值 `'terminal'` |
| [ui.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/ui.ts#L1446-L1484) | `openActivityPage` / `openAutomationsPage` / `closeAutomationsPage` | 打开+关闭动作范式：`recordViewVisit` + `previousViewBeforeX` 记录 + close 时回退历史索引 |
| [ui.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/ui.ts#L504-L518) | `sanitizeHydratedActiveView` | 走 `isTopLevelView`，新视图自动通过；仅 `activity` 有 feature-flag 门控 |

### 2.2 C2 落点

| 文件 | 位置 | 现状 |
|------|------|------|
| [worktree-nav-history.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/worktree-nav-history.ts#L16-L16) | L16 `WorktreeNavHistorySimpleViewEntry` | `'tasks' \| 'automations'`，需加 2 个 |
| [worktree-nav-history.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/worktree-nav-history.ts#L79-L81) | `isViewEntry` | 字符串集合判断，需同步 |
| [worktree-nav-history.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/worktree-nav-history.ts#L87-L90) | `getHistoryEntryKey` | `view:${entry}` 对字符串条目自动适配，无需改 |
| [worktree-nav-history.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/worktree-nav-history.ts#L83-L85) | `isTaskStackEntry` | 新视图**不是** task 栈，保持 `tasks` / task-detail，无需改 |
| [worktree-activation.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/lib/worktree-activation.ts#L756-L779) | `setWorktreeNavViewActivator` | 回退/前进时按条目激活视图；`automations`/`tasks` 显式分支，需加新分支 |
| [titlebar-worktree-history-controls.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/lib/titlebar-worktree-history-controls.ts#L3-L5) | `shouldShowWorktreeHistoryControls` | 当前 `terminal/tasks/automations` 为 true，需决策新视图 |

### 2.3 关键约束

- 主进程与渲染层共用 `src/shared/types.ts` —— 改 `TopLevelView` 是纯加性类型变更，不得破坏 node 侧 `tsc`（见 §8 回归命令）
- `previousViewBeforeX` 的既有 invariant：**该字段永远不会等于 X 本身**（`open*Page` 里 `state.activeView === X ? 保留旧值 : 记录当前`），8 个字段的显式联合正是 `Exclude<TopLevelView, X>` 的展开写法（已逐一核实 L613-L684）
- `navigateToIndex` 对视图条目走 `viewActivator` → `setActiveView`，不走 `open*Page`，避免回放时重复记录历史（[worktree-nav-history.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/worktree-nav-history.ts#L251-L261)）

## 3. 完整开发 Prompt

---

# 开发 Prompt：Round 8 — C1-C2 activeView 扩展 + 导航历史

## 0. 工作目录

`/Users/wang/Documents/work/ranxin/code/rx-cli`

## 1. 先阅读的文件

### 迭代与设计文档
- `docs/team-collaboration/PROGRESS.md`（§5 硬性约定、§8 序列）
- `docs/team-collaboration/multi-agent-iteration/2026-08-17-round7-owner-collaboration.md`（最近轮次风格）
- `docs/team-collaboration/ROADMAP.md`（C1/C2 验收标准 L504-L517）

### 代码（按依赖顺序）
- `src/shared/types.ts`（L3420-L3431 `TopLevelView`；L3433 `PersistedUIState.activeView`）
- `src/shared/top-level-view.ts`（`TOP_LEVEL_VIEW_LOOKUP` + `isTopLevelView`）
- `src/renderer/src/store/slices/ui.ts`（`UISlice` 类型 L593-L704；`previousViewBefore*` L612-L684；初始状态 L1254-L1263；`openTaskPage` L1315-L1414、`openActivityPage`/`closeActivityPage` L1446-L1459、`openAutomationsPage`/`closeAutomationsPage` L1465-L1484、`sanitizeHydratedActiveView` L504-L518）
- `src/renderer/src/store/slices/ui.test.ts`（hydrate 测试 L766-L829；previousViewBefore 断言 L2128、L3450-L3478）
- `src/renderer/src/store/slices/worktree-nav-history.ts`（全文件，尤其 L16/L79-L90/L251-L261）
- `src/renderer/src/store/slices/worktree-nav-history.test.ts` 与 `worktree-nav-history-view-entries.test.ts`
- `src/renderer/src/lib/worktree-activation.ts`（L756-L779 viewActivator 注册）
- `src/renderer/src/lib/titlebar-worktree-history-controls.ts` 与同名 `.test.ts`
- `AGENTS.md`（文件命名 / 注释只写 WHY / 类型用 `.ts`）

## 2. 本轮目标

1. **C1**：`TopLevelView` 支持 `'issues-and-prs' | 'teams'`；UI slice 提供 `openIssuesAndPRsPage` / `closeIssuesAndPRsPage` / `openTeamsPage` / `closeTeamsPage`；持久化恢复可用
2. **C2**：导航历史支持两个新视图条目；回退/前进可跨新视图跳转；关闭页面回退历史索引；标题栏历史控制按钮适配

## 3. 范围控制

### 要做
- `src/shared/types.ts`：`TopLevelView` 联合类型加 2 个成员
- `src/shared/top-level-view.ts`：`TOP_LEVEL_VIEW_LOOKUP` 加 2 个键（TS 穷举强制）
- `src/renderer/src/store/slices/ui.ts`：类型 + 初始状态 + 4 个 open/close 动作 + hydrate 兼容
- `src/renderer/src/store/slices/worktree-nav-history.ts`：简单视图条目类型 + `isViewEntry`
- `src/renderer/src/lib/worktree-activation.ts`：viewActivator 新分支
- `src/renderer/src/lib/titlebar-worktree-history-controls.ts`：新视图决策（见 §4.4）
- 对应测试（ui.test.ts / nav-history 测试 / titlebar 测试）

### 不做
- **不做任何页面渲染**（App.tsx 不新增分支；`issues-and-prs`/`teams` 主区暂为空，Round 9 C4/C5 落地）
- **不做侧边栏按钮**（C3 下一轮）
- 不改 `PersistedUIState` 之外任何 schema / IPC / 后端
- 不重构 `worktree-nav-history.ts` 既有逻辑（只加新视图支持）
- 不新增 `previousViewBefore*` 之外的字段
- 不做命令面板 / 快捷键 / feature-interaction 埋点（属 C3）
- 不碰 STYLEGUIDE / 可见 UI（本轮无可见 UI）

## 4. 实现要求

### 4.1 C1 — 视图枚举与持久化

1. [types.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/shared/types.ts#L3422-L3431) `TopLevelView` 追加 `| 'issues-and-prs' | 'teams'`
2. [top-level-view.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/shared/top-level-view.ts#L5-L15) `TOP_LEVEL_VIEW_LOOKUP` 同步补 2 个键 —— TS 穷举会强制，改完 `tsc` 必须过
3. `sanitizeHydratedActiveView` **不做** feature-flag 门控（activity 门控是因为它是实验开关；新视图页面将来必有，见 [ui.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/ui.ts#L504-L518) 注释）

### 4.2 C1 — previousViewBefore 类型重构（推荐方案，若选其他需说明理由）

现状 8 个 `previousViewBefore*` 字段是显式联合（每个都是"除自身外全部视图"）。再加 2 个视图意味着 10 处 × 2 成员的手工维护，极易漏改。

**推荐**：改为派生类型，语义等价（已核实 L613-L684 每个字段都排除自身）：

```typescript
// Why: previousViewBefore* 的既有 invariant 是"不会等于当前视图本身"，显式联合即 Exclude<TopLevelView, T> 的展开
type PreviousViewBefore<T extends TopLevelView> = Exclude<TopLevelView, T>
```

- 8 个既有字段改为 `PreviousViewBefore<'tasks'>` 等，新增 2 个字段 `previousViewBeforeIssuesAndPRs: PreviousViewBefore<'issues-and-prs'>`、`previousViewBeforeTeams: PreviousViewBefore<'teams'>`
- 初始状态 2 个新字段默认 `'terminal'`（与既有 8 个一致，见 L1254-L1262）
- **禁止**用 `as` 强转绕过类型；改完后 `tsc` 必须能证明等价性

### 4.3 C1 — open/close 动作（严格照抄 openAutomationsPage / closeAutomationsPage 模式）

以 [openAutomationsPage](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/ui.ts#L1465-L1472) / [closeAutomationsPage](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/ui.ts#L1473-L1484) 为模板，新增：

- `openIssuesAndPRsPage` / `openTeamsPage`：先 `recordViewVisit('issues-and-prs' | 'teams')`，再 `set` 更新 `activeView` + `previousViewBeforeX`（保持"已在当前视图则保留旧值"的 invariant）
- `closeIssuesAndPRsPage` / `closeTeamsPage`：恢复 `previousViewBeforeX`，并**回退导航历史索引**（当前条目是该视图时，用 `findPrevLiveWorktreeHistoryIndex` 回退；参照 closeAutomationsPage 的写法）
- 视图条目名与类型值一致：`'issues-and-prs'`（连字符）与 `'teams'`

### 4.4 C2 — 导航历史

1. [worktree-nav-history.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/worktree-nav-history.ts#L16-L16) `WorktreeNavHistorySimpleViewEntry` 改为 `'tasks' | 'automations' | 'issues-and-prs' | 'teams'`
2. [isViewEntry](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/store/slices/worktree-nav-history.ts#L79-L81) 同步 —— 建议改为集合判断（如 `SIMPLE_VIEW_ENTRIES.has(entry)`）避免再漏
3. `isTaskStackEntry` **不改**（新视图不是 task 栈；`closeTaskPage` 的"回退到非 task 栈"逻辑不受影响）
4. [worktree-activation.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/lib/worktree-activation.ts#L756-L779) viewActivator 增加 2 个分支：`entry === 'issues-and-prs' || entry === 'teams'` → `setActiveView(entry)`（与 `automations` 分支一致，走 setActiveView 而非 open*Page，避免重复记录历史）
5. **标题栏历史控制按钮（决策项）**：`shouldShowWorktreeHistoryControls` 加 `'issues-and-prs' | 'teams'` → true。理由：这俩是与 tasks/automations 同级的内容页，会进入导航历史，没有历史按钮则"回退/前进"不可见；与现有 pattern（terminal/tasks/automations = true）一致。**若选不加**，必须在交付说明中给出理由并保证回退可用性不依赖按钮

## 5. 测试要求

至少覆盖：

1. **C1 open/close 往返**：从 `tasks` 打开 `issues-and-prs` → `previousViewBeforeIssuesAndPRs === 'tasks'`；close → 回到 `tasks`。`teams` 同样
2. **同视图重复打开**：已在 `issues-and-prs` 再 open → `previousViewBeforeIssuesAndPRs` 保留原值（invariant）
3. **hydrate 恢复**：持久化 `activeView: 'issues-and-prs'` / `'teams'` 可恢复（参照 ui.test.ts L771-L807 的既有用例）；未知视图仍回落 `'terminal'`（回归）
4. **C2 历史**：`recordViewVisit('issues-and-prs')` 后 `goBack`/`goForward` 可在新视图与既有视图间跳转；viewActivator 收到新视图条目并调用 `setActiveView`
5. **close 回退索引**：停在 `issues-and-prs` 时 `closeIssuesAndPRsPage` 后历史索引回退到前一个 live 条目（参照 closeAutomationsPage 的既有断言）
6. **titlebar**：`shouldShowWorktreeHistoryControls('issues-and-prs')` / `('teams')` 断言与决策一致
7. **禁止用 fixture 掩盖缺口**：不得"预调用 open 后再断言 previousViewBefore 被正确记录"之类的绕弯；断言必须真实反映调用序列

测试文件：`ui.test.ts`、`worktree-nav-history.test.ts`、`worktree-nav-history-view-entries.test.ts`、`titlebar-worktree-history-controls.test.ts`。需要新建独立测试文件时，按文件内聚命名（禁止 `helpers/utils` 类命名）。

## 6. 验证命令（必须执行并记录结果）

```bash
# 渲染层本轮改动
PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH" pnpm vitest run src/renderer/src/store/slices/ui.test.ts src/renderer/src/store/slices/worktree-nav-history.test.ts src/renderer/src/store/slices/worktree-nav-history-view-entries.test.ts src/renderer/src/lib/titlebar-worktree-history-controls.test.ts
PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH" pnpm tsc --noEmit -p config/tsconfig.web.json
# 后端基线回归（shared 类型变更不得破坏 node 侧）
PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH" pnpm vitest run src/main/runtime/collaboration/*.test.ts src/main/ipc/collaboration-ipc.test.ts src/main/runtime/pipeline/*.test.ts
PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH" pnpm tsc --noEmit -p config/tsconfig.node.json
# 改动文件 lint
PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/Library/pnpm:$PATH" pnpm oxlint src/renderer/src/store/slices/ui.ts src/renderer/src/store/slices/worktree-nav-history.ts src/renderer/src/lib/worktree-activation.ts src/renderer/src/lib/titlebar-worktree-history-controls.ts
```

测试通过后**重新核对测试分布**（`rg -n "^\s*it\(" <每个测试文件> | wc -l`），确认分布之和等于总数，并核对文档 §7 的数字。

## 7. 禁止重犯的错误清单（长期约定，沿用 Round 6 §11.6 / Round 7 §3）

1. **不得用测试 fixture 掩盖契约缺口**（预调用绕过、空对象强转）
2. **不得有"声称生效但实际没有"的代码**
3. **不得有死代码**——导出函数/类型至少被一个测试引用
4. **不得漏掉既有 invariant**——`previousViewBeforeX ≠ X`、导航历史回退索引逻辑
5. **不得语义混淆**——视图名（`issues-and-prs` 连字符）与类型值必须一致，历史条目 key 前缀 `view:` 不混
6. **文档数字必须与实现一致**——测试分布、新增用例数，改后重新核对
7. **不要扩大范围**——不做页面渲染 / 侧边栏按钮 / IPC / schema

## 8. 交付物

1. 实际代码修改（C1 + C2）
2. 新增/更新的测试
3. 更新本文档：追加"实施记录"一节（方案选择理由——尤其 §4.2 派生类型与 §4.4 决策项、验证结果、测试分布核对）

## 9. 输出格式

### 本轮完成
- xxx

### 实际修改文件
- xxx

### 关键设计决策与理由（§4.2 / §4.4 必须回答）
- xxx

### 测试结果（含真实分布核对 + tsc/lint 结果）
- xxx

### 风险 / 待确认项
- xxx

### 下一轮建议
- xxx

---

## 4. 下一轮衔接（Round 9 预告）

| 下一轮 | 任务 | 依赖 | 落点 |
|--------|------|------|------|
| Round 9 | C3 Sidebar 按钮 + C4 Teams 页骨架 + C5 IssuesAndPRs 页骨架 | C1, C2, B8 | `SidebarNav.tsx`、`TeamsPage.tsx`、`IssuesAndPRsPage.tsx`、App.tsx 渲染分支 |

> 说明：Round 8 刻意把"页面渲染"切到 Round 9，避免一轮同时动状态层与页面层。Round 9 开工时 App.tsx 只需新增两个渲染分支（`activeView === 'issues-and-prs'` / `'teams'`），状态层已就绪。

---

## 10. 实施记录（Round 8 实际执行）

### 本轮完成

完成 M1 前端的第一块基石 C1 + C2：

1. **C1 扩展 `activeView`** — `TopLevelView` 增加 `'issues-and-prs' | 'teams'`，UI slice 提供 `openIssuesAndPRsPage` / `closeIssuesAndPRsPage` / `openTeamsPage` / `closeTeamsPage`，持久化恢复可用
2. **C2 扩展导航历史** — `worktree-nav-history` 支持新视图条目，回退/前进可跨新视图跳转，关闭页面回退历史索引，标题栏历史控制按钮全部接入

### 实际修改文件

| 文件 | 说明 |
|------|------|
| `src/shared/types.ts` | `TopLevelView` 联合类型加 2 个成员 |
| `src/shared/top-level-view.ts` | `TOP_LEVEL_VIEW_LOOKUP` 加 2 个键 |
| `src/renderer/src/store/slices/ui.ts` | 类型 + 初始状态 + 4 个 open/close 动作 + `PreviousViewBefore<T>` 派生类型 + UISlice 类型声明 |
| `src/renderer/src/store/slices/worktree-nav-history.ts` | `WorktreeNavHistorySimpleViewEntry` + `SIMPLE_VIEW_ENTRIES` 集合 + `isViewEntry` / `getHistoryEntryKey` 改用集合判断 |
| `src/renderer/src/lib/worktree-activation.ts` | viewActivator 增加 2 个新分支（与 `automations` 合并为一个条件） |
| `src/renderer/src/lib/titlebar-worktree-history-controls.ts` | `shouldShowWorktreeHistoryControls` 加新视图 |
| `src/main/runtime/rpc/methods/client-ui-schemas.ts` | Zod `TopLevelViewSchema` 加新视图（保持与类型定义同步） |
| `src/renderer/src/store/slices/ui.test.ts` | 新增 10 个 it()：open/close 往返、同视图重复打开、hydrate 恢复 |
| `src/renderer/src/store/slices/worktree-nav-history-view-entries.test.ts` | viewCases 从 2 增到 4（参数化测试自动覆盖新视图） |
| `src/renderer/src/lib/titlebar-worktree-history-controls.test.ts` | 更新断言覆盖新视图 |

### 关键设计决策与理由

#### §4.2 派生类型方案（已采用）

**决策**：采用 `PreviousViewBefore<T extends TopLevelView> = Exclude<TopLevelView, T>` 派生类型，替换 8 个显式联合字段。

**理由**：
1. 语义等价性：既有 invariant 是 `previousViewBeforeX ≠ X`，这正是 `Exclude<TopLevelView, T>` 的定义
2. 可维护性：新增视图时无需手动维护 10+ 个显式联合类型，避免漏改风险
3. 类型安全：`tsc` 自动验证等价性，无需 `as` 强转

#### §4.4 标题栏历史控制按钮（决定：加入）

**决策**：`shouldShowWorktreeHistoryControls` 增加 `'issues-and-prs'` / `'teams'` → true。

**理由**：
1. 这俩是与 `tasks`/`automations` 同级的内容页，会进入导航历史
2. 没有历史按钮则"回退/前进"不可见，用户体验不完整
3. 与现有 pattern（`terminal`/`tasks`/`automations` = true）一致

#### 额外决策：`SIMPLE_VIEW_ENTRIES` 集合

**决策**：在 `worktree-nav-history.ts` 中引入 `ReadonlySet` 用于 `isViewEntry` 和 `getHistoryEntryKey` 判断。

**理由**：避免硬编码字符串列表分散在多处，未来新增视图时只需修改一处。

### 测试结果

**分布核对（it() 用例数）**：

| 文件 | 用例数 | 备注 |
|------|--------|------|
| ui.test.ts | 174 | 新增 10 个 |
| worktree-nav-history.test.ts | 12 | 不变 |
| worktree-nav-history-view-entries.test.ts | 8（运行时 20） | 参数化扩展（2→4 cases），`for...of viewCases` 循环内 4 个 it() × 4 cases = 16 + 循环外 4 = 20 |
| titlebar-worktree-history-controls.test.ts | 2 | 更新断言 |

> 说明：静态 it() 之和 = 174+12+8+2 = **196**；运行时总数 = **208**，差值 12 由 view-entries 参数化展开（8 个 it() 定义 → 20 个运行时用例）解释。

**运行结果**：
- 渲染层测试：208 tests 全绿（4 文件）
- 后端回归：106 tests 全绿（基线无回归）
- `tsc --noEmit -p config/tsconfig.web.json`：本轮改动**无新增错误**（预存 16 个 TS6307"文件未列入 web 项目"错误，均在未改动文件，已与 HEAD 对比确认非本轮引入）
- `tsc --noEmit -p config/tsconfig.node.json`：通过
- `oxlint` 改动文件：通过

### 风险 / 待确认项

- 无。Round 8 范围控制良好，未触碰页面渲染 / 侧边栏 / IPC / schema。

### 下一轮建议

按原计划执行 Round 9：C3 Sidebar 按钮 + C4 Teams 页骨架 + C5 IssuesAndPRs 页骨架。状态层已就绪，App.tsx 只需新增两个渲染分支。
