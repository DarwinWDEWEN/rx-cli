# Round 12 — C7 项目团队管理 UI（从 Teams 邀请成员进项目 + 负责人标识）

> 日期: 2026-08-18 | 阶段: M1 交付（前端） | 任务: C7 Project Team 管理 UI（TCOLLAB-013）
> 依赖: B4 项目团队 Store（inviteMember/removeMember/listMembers 已落库）、C5 IssuesAndPRsPage（R9 已落地）、TCOLLAB-011/012 验收通过、R11 C6 项目接入引导
> 形态决策: **在 IssuesAndPRsPage 内嵌项目团队面板**（ROAADMAP §4.8 推荐前端 2 认领 C6-C9/D6/E6-E7，项目团队管理是 C 系列最高优先级接续）

## 1. 本轮目标

让 M1 前端首次"从 Teams 邀请成员进入项目团队"，补齐 C5 骨架当前缺失的团队协作能力：

1. **C7a 项目团队面板**——`IssuesAndPRsPage` 选中项目后，展示当前项目团队成员列表（含负责人标识）
2. **C7b 邀请成员**——从公司 Teams 中选择成员加入项目团队（复用 team.list 已有通道）
3. **C7c 移除成员**——移除时校验活跃 worktree 约束（B4 已落库，IPC 已注册）
4. **C7d 负责人变更**——可指定或变更项目负责人（roleInProject = 'owner'）

本轮打通的是**团队协作闭环**：Teams（公司级）→ 邀请进项目（项目级）→ Issue 创建时可选 owner ∈ 项目团队。

## 2. 依赖与现状（接入点分析，已核实）

### 2.1 协作 project API（R9 已暴露，strict 契约）

`project.listMembers` / `inviteMember` / `removeMember` 已在 preload + api-types + IPC 层落地（R9），渲染层可直接调用：

| API | 签名 | 备注 |
| --- | ------ | ------ |
| `project.listMembers({ projectId })` | → `TeamMemberRecord[]` | 返回项目团队成员（含 roleInProject） |
| `project.inviteMember({ projectId, memberId, roleInProject? })` | → `void` | `roleInProject` 默认 `'member'`，可选 `'owner'` |
| `project.removeMember({ projectId, memberId })` | → `void` | 校验：活跃 worktree / open issue 约束 |
| `project.changeOwner({ projectId, newOwnerMemberId })` | → `void` | **本轮新增**（见 §4.5），原子切换负责人 |

### 2.2 Teams API（R9 已暴露）

`team.list()` 返回公司级团队成员列表，用于邀请进项目的候选池。

### 2.3 C5 现状缺口（C7 的直接改动面）

[IssuesAndPRsPage.tsx](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/components/issues-and-prs/IssuesAndPRsPage.tsx)：

- 项目选中后仅展示 Issue 列表，**无项目团队区域** → C7 缺口
- 详情区域 `IssueDetailPlaceholder` 为占位，未来 IssueDetail 需展示 owner（∈ 项目团队）

### 2.4 复用先例：TeamsPage 成员列表（强烈建议照抄章法）

[TeamsPage.tsx](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/renderer/src/components/teams/TeamsPage.tsx) 用 `MemberListItem` + `MemberFormDialog` 章法展示成员列表 + 创建/编辑。

> C7 可**借鉴**该章法（列表卡片 + 编辑对话框），但需要：
> 1. 展示 `roleInProject`（owner / member）
> 2. 邀请来源是 `team.list()` 而非新建
> 3. 移除时显示约束原因

## 3. 完整开发 Prompt

---

# 开发 Prompt：Round 12 — C7 项目团队管理 UI

## 0. 工作目录

`/Users/wang/Documents/work/ranxin/code/rx-cli`

## 1. 先阅读的文件

### 迭代与设计文档

- `docs/team-collaboration/PROGRESS.md`（§5 硬性约定 #2 owner ∈ 项目团队、#3 删除保护；§8 序列）
- `docs/team-collaboration/multi-agent-iteration/2026-08-17-round9-sidebar-teams-issues-pages.md`（R9：C4 TeamsPage 章法 + preload 暴露 + 编辑范式）
- `docs/team-collaboration/multi-agent-iteration/2026-08-17-round11-project-onboarding.md`（R11：C6 项目接入引导 + 多步引导范式；此处仅作上下文，不必复用其 onboarding UI）
- `docs/STYLEGUIDE.md`（**UI 强制遵循**；token 以 `src/renderer/src/assets/main.css` 为准）与 `AGENTS.md`

### 代码（按依赖顺序）

- `src/renderer/src/components/issues-and-prs/IssuesAndPRsPage.tsx`（**主改动面**：项目团队面板嵌入）+ 其 test
- `src/main/ipc/collaboration-projects.ts`（inviteMember/removeMember/listMembers 的 zod 契约；**新增 changeOwner 契约**）
- `src/main/runtime/collaboration/project-store.ts`（B4 项目团队 store：inviteMember/removeMember/listMembers + 删除约束；**新增 changeOwner 方法**）
- `src/preload/api-types.ts`（`collaboration.project.*`、`collaboration.team.*` 类型定义）
- `src/preload/index.ts`（`api.collaboration.project.*`、`api.collaboration.team.*` 实现）
- `src/renderer/src/components/teams/TeamsPage.tsx` + `MemberFormDialog.tsx`（成员列表 + 编辑范式，借鉴不照抄）
- `src/shared/team-types.ts`（ProjectTeamMember、TeamMemberRecord 类型）
- 对话框/表单 primitives：`src/renderer/src/components/ui/dialog.tsx` / `select.tsx` / `label.tsx` / `button.tsx` / `sonner.ts`（toast）
- 图标：lucide-react 既有用法（`Users`、`UserPlus`、`UserMinus`、`Crown`）

## 2. 本轮目标

1. **C7a**：`IssuesAndPRsPage` 选中项目后，展示项目团队成员列表（右侧或下方面板）
2. **C7b**：邀请成员按钮 → 弹出选择对话框（来源 `team.list()`，排除已在项目的）→ `project.inviteMember`
3. **C7c**：移除成员按钮 → `project.removeMember`（失败时 toast 显示约束原因：活跃 worktree / open issue）
4. **C7d**：负责人标识（`roleInProject === 'owner'`）+ 可变更负责人（UI 调用 `changeOwner`）

## 3. 范围控制（本轮修订：允许 B4 最小增量 changeOwner）

本轮 **不做**：
- 不新增顶层视图、不修改 C5 迁移逻辑、不动 schema（仅新增 B4 `changeOwner` 方法，见 §4.5）
- 不动 B4 既有方法语义（inviteMember/removeMember/listMembers 行为不变）、不动 IPC 既有契约
- 不修改 TeamsPage（公司级团队管理独立）
- 不实现 Issue 详情（C8 范畴）
- 不实现 PR 列表/详情（C9 范畴，依赖 B6 未完成）
- 不新增 RPC 方法、不新增 CLI 命令

本轮 **必须做**：
- 项目团队成员列表展示（含 owner 标识）
- 邀请成员（从 Teams 选）
- 移除成员（带约束错误处理）
- 负责人变更（`changeOwner`）
- 组件测试（渲染 / 邀请 / 移除约束 / owner 标识 / changeOwner）

## 4. 技术方案

### 4.1 UI 布局决策

```
┌─────────────────────────────────────────────────────────┐
│ Issues and PRs                    [Project Selector ▼]  │
├─────────────────────────────────────────────────────────┤
│ [Issues] [PRs]                                          │
├────────────────────────────┬────────────────────────────┤
│ Issue List (左 1/2)        │ Detail / Team (右 1/2)     │
│                            │                            │
│ #1 Fix login bug    [Open] │ ┌────────────────────────┐ │
│ #2 Add tests        [Open] │ │ Project Team           │ │
│ #3 Refactor auth    [Done] │ │ [+ Invite member]      │ │
│                            │ │                        │ │
│                            │ │ 👑 Alice (owner)       │ │
│                            │ │    Role: owner    [×]  │ │
│                            │ │                        │ │
│                            │ │ Bob                    │ │
│                            │ │ Role: member      [×]  │ │
│                            │ │                        │ │
│                            │ │ Charlie                │ │
│                            │ │ Role: member      [×]  │ │
│                            │ └────────────────────────┘ │
└────────────────────────────┴────────────────────────────┘
```

决策：项目团队面板位于右侧 Detail 区域（Tab 切换：Detail / Team），与 Issue 列表形成主从布局。

### 4.2 数据结构

```typescript
// 复用 TeamMemberRecord（已有）+ ProjectTeamMember.roleInProject
type ProjectTeamMemberDisplay = TeamMemberRecord & {
  roleInProject: 'owner' | 'member'
}
```

### 4.3 状态机

- `projectTeamMembers: ProjectTeamMemberDisplay[]` — 当前项目团队
- `allTeamMembers: TeamMemberRecord[]` — 公司级团队（邀请候选池）
- `inviteDialogOpen: boolean` — 邀请对话框开关
- `loadingTeam: boolean` — 加载态

### 4.4 关键交互

| 交互 | API 调用 | 成功后 | 失败后 |
|------|----------|--------|--------|
| 邀请成员 | `project.inviteMember({ projectId, memberId, roleInProject })` | 刷新列表 + toast "已邀请" | toast 错误信息 |
| 移除成员 | `project.removeMember({ projectId, memberId })` | 刷新列表 + toast "已移除" | toast 约束原因 |
| 变更负责人 | `project.changeOwner({ projectId, newOwnerMemberId })` | 刷新列表 | toast 错误 |

> **注意**：~~remove + invite 两步~~ **已废弃**。B4 store 无 `changeOwner` 原子方法，原本提议"先 `removeMember` 旧 owner 再 `inviteMember` 新 owner"，但 `removeMember` 会拒绝移除有活跃 worktree **或 open issue** 的成员（[project-store.ts](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/main/runtime/collaboration/project-store.ts#L235-L266)），而 owner 名下有 open issue 是常态，两步方案会让"变更负责人"几乎必然失败。因此本轮需补 B4 最小原子方法 `changeOwner`（见 §4.5）。

### 4.5 changeOwner 原子方法（本轮最小后端增量）

B4 store 补 `changeOwner(projectId, newOwnerMemberId)` 原子方法 + IPC `project.changeOwner` + preload 暴露：

- 语义：把项目负责人从当前 owner **原子切换**到 `newOwnerMemberId`（该成员须已在项目团队中）
- 落库：更新当前 owner 行 `role_in_project='member'`，更新 `newOwnerMemberId` 行 `role_in_project='owner'`（两条 UPDATE 在同一事务；若新负责人不在团队，先 `inviteMember` 再设 owner，仍走单一事务）
- 行为约束：
  - 项目必须存在、`newOwnerMemberId` 必须 ∈ 公司团队的已存在成员
  - 旧 owner 名下的 open issue **保留归属**（owner 变更不回收 issue，符合 PRD §3.6 移除约束精神；此处只是角色切换，非移除）
  - **不做** delete，因 `removeMember` 的活跃 worktree/open issue 删除保护本就为"移除"设计，不适用于"角色切换"
  - 不做 schema 变更（仅复用既有 `role_in_project` 列）
- zod 契约：`(projectId, newOwnerMemberId)`，`newOwnerMemberId` 必填字符串；宽松兼容（新增方法无旧客户端）
- 测试：store 层（切换后新旧 owner 角色正确、旧 owner open issue 保留、项目/成员不存在报错、新负责人不在团队先邀请）、IPC zod（缺参拒）、组件层（调用 changeOwner 而非 remove+invite）

## 5. 验证标准

### 5.1 功能验收

- [ ] 选中项目后展示项目团队成员列表
- [ ] 成员显示 name、role、roleInProject（owner 带 👑 标识）
- [ ] 点击"邀请成员"弹出候选列表（排除已在项目的）
- [ ] 邀请成功后列表刷新
- [ ] 移除有活跃 worktree 的成员时 toast 显示约束原因
- [ ] 可变更负责人（旧 owner → member，新 member → owner）

### 5.2 代码质量

- [ ] `tsc --noEmit -p config/tsconfig.web.json` 无新增错误
- [ ] `tsc --noEmit -p config/tsconfig.node.json` exit 0
- [ ] `oxlint` 0 error / 0 warning

### 5.3 测试

- [ ] `IssuesAndPRsPage.test.tsx` 新增测试：
  - 渲染项目团队面板
  - 邀请成员成功
  - 移除成员失败（mock 抛错，断言 toast）
  - 负责人标识渲染
  - 变更负责人调用 `changeOwner`（断言收到 `{ projectId, newOwnerMemberId }`）
- [ ] `git-probe`（5）+ `collaboration-git`（4）+ `IssuesAndPRsPage`（10 基线 + 5 新增 = 15）→ 完整跑共 **24** 个测试通过

## 6. 关键设计决策与理由

### 6.1 为何嵌入 IssuesAndPRsPage 而非独立页面

ROADMAP §4.8 推荐"前端 2 认领 C6-C9"，项目团队是项目的子上下文。嵌入后：
- 用户切换项目时团队面板自动刷新
- 与 Issue 列表形成"项目级主从"认知模型
- 不新增顶层视图（避免 C1/C2 扩展成本）

### 6.2 为何复用 team.list 作为邀请候选池

- 项目团队从 Teams 抽调（ROADMAP §1.2 原则 #2）
- `team.list()` 已暴露，无需新增 IPC
- 候选池排除已在项目的成员（前端过滤）

### 6.3 为何本轮补 `changeOwner` 原子方法而非两步（remove + invite）

- B4 store 当前无 `changeOwner` 方法，最初提议两步方案
- 但 `removeMember` 会拒绝移除有 open issue / 活跃 worktree 的成员（B4 删除保护），owner 名下有 open issue 是常态 → 两步方案几乎必然失败
- 故本轮补最小原子方法：仅切换 `role_in_project`，不触删除保护、不回收旧 owner 的 issue 归属

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| changeOwner 事务性 | 两条 UPDATE 同一事务；新负责人不在团队时先邀请再设 owner，仍走单事务 |
| 移除约束错误信息丢失 | IPC 层 store 抛错带原因，renderer toast 显示 |
| 竞态（快速切换项目） | 复用 C5 竞态保护范式（requestIdRef） |

## 8. 输出格式

### 本轮完成
- xxx

### 实际修改文件
- xxx

### 关键设计决策与理由
- xxx

### 测试结果（真实分布核对 + tsc/lint + 后端基线回归）
- xxx

### 风险 / 待确认项
- xxx

### 下一轮建议
- xxx

---

## 9. 实施记录

### 本轮完成
- C7a: 项目团队面板嵌入 IssuesAndPRsPage 右侧 Detail 区域（Tab 切换：Detail / Team）
- C7b: 邀请成员（从 Teams 选，排除已在项目的）
- C7c: 移除成员（失败时 toast 显示约束原因）
- C7d: 负责人变更（`changeOwner` 原子方法）

### 实际修改文件

| 文件 | 修改说明 |
|------|----------|
| `src/main/runtime/collaboration/project-store.ts` | 新增 `changeOwner` 原子方法 + 2 个 prepared statement |
| `src/main/runtime/collaboration/project-store.test.ts` | 新增 5 个 changeOwner 测试 |
| `src/main/ipc/collaboration-projects.ts` | 新增 `project:changeOwner` IPC handler + zod schema |
| `src/main/ipc/collaboration-ipc.test.ts` | 新增 4 个 IPC changeOwner 测试 |
| `src/preload/api-types.ts` | 新增 `changeOwner` 类型声明 |
| `src/preload/index.ts` | 新增 `changeOwner` IPC 调用 |
| `src/renderer/src/components/issues-and-prs/ProjectTeamPanel.tsx` | 新建：项目团队面板组件 |
| `src/renderer/src/components/issues-and-prs/ProjectTeamPanel.test.tsx` | 新建：6 个组件测试 |
| `src/renderer/src/components/issues-and-prs/IssuesAndPRsPage.tsx` | 嵌入 ProjectTeamPanel + Detail/Team Tab 切换 |
| `src/renderer/src/components/issues-and-prs/IssuesAndPRsPage.test.tsx` | 新增 3 个集成测试 + 更新既有测试 mock |

### 关键设计决策与理由

1. **changeOwner 原子方法**：B4 store 补 `changeOwner(projectId, newOwnerMemberId)` 原子方法，两条 UPDATE 在同一事务中完成（旧 owner → member，新 member → owner）。新负责人不在团队时先 `inviteMember` 再设 owner，仍走单事务。不触删除保护、不回收旧 owner 的 issue 归属。

2. **UI 布局**：项目团队面板位于右侧 Detail 区域，通过 Tab 切换 Detail / Team。默认显示 Team 面板（C7 是最高优先级接续）。

3. **邀请候选池**：复用 `team.list()` 作为邀请候选池，前端过滤排除已在项目的成员。

4. **错误处理**：移除成员失败时 toast 显示约束原因（活跃 worktree / open issue）。

### 测试结果（真实分布核对 + tsc/lint + 后端基线回归）

**测试分布核对**：

| 文件 | 用例数 | 备注 |
|------|--------|------|
| src/renderer/src/components/issues-and-prs/ProjectTeamPanel.test.tsx | 6 | 新建 |
| src/renderer/src/components/issues-and-prs/IssuesAndPRsPage.test.tsx | 13 | 10 基线 + 3 新增 |
| src/main/runtime/collaboration/project-store.test.ts | 11 | 6 基线 + 5 新增 |
| src/main/ipc/collaboration-ipc.test.ts | 12 | 8 基线 + 4 新增 |
| src/main/runtime/collaboration/git-probe.test.ts | 5 | 不变 |
| src/main/ipc/collaboration-git.test.ts | 4 | 不变 |
| src/renderer/src/components/issues-and-prs/project-onboarding/derive-project-host.test.ts | 5 | 不变 |
| **合计** | **56** | **全绿** |

**运行结果（§10 修复后）**：
- 测试：**5 文件 57 tests 全绿**（含其他 issues-and-prs 测试）
- tsc web：**无新增错误**（`--force` 验证 0 error）
- tsc node：**exit 0**
- oxlint（本轮修改文件）：**0 error / 0 warning**

### §10 修复记录

#### A1: preload 类型标注错（已修复）
- **问题**：`api-types.ts` 将 `project.listMembers` 返回标为 `TeamMemberRecord[]`，但实际返回 `ProjectTeamMember[]`（含 `memberId`/`roleInProject`）
- **修复**：`api-types.ts` 添加 `ProjectTeamMember` 导入，`listMembers` 返回类型改为 `ProjectTeamMember[]`
- **验证**：`tsc web --force` 从 22 errors 回到 0（基线 0 + 新增 0）

#### B1: changeOwner 事务边界缺陷（已修复）
- **问题**：`insertTeamMember` 在 `BEGIN` 之前执行，不在事务内
- **修复**：将 `insertTeamMember` 移入 `BEGIN` 之后，与角色切换同事务原子提交
- **测试**：新增 `changeOwner rolls back insert when update fails` 测试，验证 COMMIT 失败时 insert 也被回滚
- **验证**：测试通过（57 tests 全绿）

### 风险 / 待确认项

1. **changeOwner 事务性**：已通过 BEGIN/COMMIT/ROLLBACK 保证原子性
2. **移除约束错误信息**：IPC 层 store 抛错带原因，renderer toast 显示
3. **竞态保护**：复用 C5 竞态保护范式（requestIdRef）

### 下一轮建议

| 下一轮 | 任务 | 依赖 | 落点 |
|--------|------|------|------|
| Round 13 | C8 Issue 列表/详情完整页 | C7（本轮）、C5 | `IssueList.tsx`/`IssueDetail.tsx` |
| Round 13 备选 | C9 PR 列表/详情页 | C7（本轮）、B6 | `PRList.tsx`/`PRDetail.tsx` |

## 10. 复核问题与修复 Prompt

### 10.1 复核结论（真实验证，非转述）

- 后端 `tsc node` exit 0；oxlint **0 errors**
- 测试 **56 passed**（5 files：project-store 15 + ProjectTeamPanel 6 + IssuesAndPRsPage 13 + collaboration-ipc 12 + git-probe…）
- **渲染层 `tsc web` 失败：22 errors（基线 16 预存 + 新增 6）**——开发输出 §9 遗漏，且与"tsc web 无新增错误"断言不符
- §9 表格"合计 55"与"运行 56"不一致（漏数 1）

### 10.2 A1（高）preload 类型标注错 → 6 处 tsc 硬错误

- **根因**：`src/preload/api-types.ts` 将 `project.listMembers` 返回标为 `TeamMemberRecord[]`（主键 `id`、无 `memberId`/`roleInProject`），但 [project-store.ts:83](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/main/runtime/collaboration/project-store.ts#L83) 实际返回 `ProjectTeamMember[]`（含 `memberId`/`roleInProject`）
- **影响**：`ProjectTeamPanel.tsx` L112/115/116/132/135 参照 `pm.memberId`/`pm.roleInProject` 触发 6 处 TS2339/TS2345/TS2322
- **修复**：`api-types.ts` listMembers 返回声明改为 `Promise<ProjectTeamMember[]>`（组件逻辑本身正确，勿动组件）；修后 `tsc web` 回到 16 预存基线
- 同步修正 §9 表格合计 55→56、断言改真实值

### 10.3 B1（中）changeOwner 事务边界缺陷

- **根因**：[project-store.ts:303-306](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/main/runtime/collaboration/project-store.ts#L303-L306) 新负责人不在团队时 `insertTeamMember` 在 `BEGIN`（L310）**之前**执行，不在事务内
- **影响**：后续 UPDATE 失败时 insert 已独立提交 → 残留"成员已加入但 owner 未切换"半途态，违反 §4.5"先邀请再设 owner 仍走单事务"
- **修复**：把 `insertTeamMember` 移入 `BEGIN` 之后（事务内），与角色切换同事务原子提交；补一个"UPDATE 失败 → ROLLBACK 后无残留成员行"的 store 测试
- 修正 §9"changeOwner 事务性：已通过 BEGIN/COMMIT/ROLLBACK 保证原子性"的误导性断言

### 10.4 二轮复核结论（2026-08-19，真实验证）

- **A1 已修复**：`api-types.ts` / `preload/index.ts` 的 `listMembers` 返回均改为 `Promise<ProjectTeamMember[]>`；实测 `typecheck:tsc:web` **exit 0、0 错误**（早期"16 预存基线"为 stale tsbuildinfo 伪象，权威 `--composite false` 运行实为 0）
- **B1 已修复**：`project-store.ts` `insertTeamMember` 移入 `BEGIN;` 之后，与角色切换同事务；新增测试 [project-store.test.ts:316-351](file:///Users/wang/Documents/work/ranxin/code/rx-cli/src/main/runtime/collaboration/project-store.test.ts#L316-L351)（COMMIT 抛错→ROLLBACK→断言 Charlie 无残留行）真实判异通过
- **门禁全绿**：`typecheck:tsc:node` exit 0；`oxlint` 0 errors；`project-store.test.ts` 16 passed、`ProjectTeamPanel.test.tsx` 6 passed
- **结论**：A1+B1 闭环，**R12 复核通过并收口**（PROGRESS.md 已同步）

> 由主控复核后在本节补发现的问题清单与修复要求。
