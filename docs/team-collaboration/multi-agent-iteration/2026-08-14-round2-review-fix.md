# Round 2 — Review 反馈核对与修复

> 日期: 2026-08-14 | 阶段: M1 后端数据层收敛 | 触发: 外部代码审核反馈

## 1. 本轮目标

不继续新功能开发，而是：
1. 对照 TECH-DESIGN 重新审查当前协作数据层实现
2. 逐条核对 Review 问题（2 阻塞 + 3 建议）
3. 修复阻塞性问题，收敛 schema / shared types 漂移
4. 补齐最小验证测试
5. 沉淀分析结论

## 2. 接入点分析

本轮不动新文件，仅在既有 5 个文件上做收敛：
- `src/shared/team-types.ts` — 按 TECH-DESIGN §3.1 TeamMember 收敛
- `src/main/runtime/collaboration/collaboration-database.ts` — 按 §2.2/§2.3 收敛 schema + 外键策略
- `src/main/runtime/collaboration/team-store.ts` — delete 保护 + canDelete 完整 + update 清空
- 对应测试文件 — 补删除保护、schema 契约测试

## 3. Review 问题核对结果

### 3.1 【阻塞性 1】delete 保护与外键策略 — 成立

**问题**：当前外键全部 `ON DELETE CASCADE`，误删成员会级联删除 Issue/PR/评论/refs。

**核对结论**：
- `delete()` 当前**未强制调用** `canDelete()`，任何调用方都能绕过。
- TECH-DESIGN §3.2 的 `canDelete` 只校验"活跃 worktree 关联活跃 Issue"，范围比当前实现窄，但这是**更精确的业务规则**，我们按设计收敛。
- 外键策略应分层：
  - **业务主体**（issues / pull_requests / issue_worktrees / issue_git_refs 的 member/owner 引用）→ `ON DELETE RESTRICT`（DB 层兜底，配合应用层 canDelete）
  - **评论 / 活动记录**（issue_comments / pr_comments / activity_log）→ `ON DELETE CASCADE`（成员真被删除后，其评论历史随 cascade 移除；若业务需要保留痕迹，后续再改 SET NULL）

**决策**：
1. `delete()` 内部先调 `canDelete()`，不通过直接抛错（应用层强制约束）。
2. 业务主体外键改为 `ON DELETE RESTRICT`（DB 层兜底，防绕过）。
3. 评论表保留 CASCADE。

### 3.2 【阻塞性 2】schema 与 TECH-DESIGN 漂移 — 成立

当前实现基于 PRD 的早期版本，与 TECH-DESIGN §2.2/§2.3 存在实质性漂移。逐表核对：

#### team_members

| 维度 | TECH-DESIGN | 当前实现 | 处理 |
|------|-------------|----------|------|
| role | TEXT NOT NULL DEFAULT '' | **缺失** | 补列 |
| avatar_url | TEXT | **缺失** | 补列 |
| personality | TEXT DEFAULT '' | **缺失** | 补列 |
| responsibilities | TEXT DEFAULT '[]' | ✓ | 保留 |
| capabilities | TEXT DEFAULT '[]' | ✓ | 保留 |
| agent_type | TEXT NOT NULL | ✓ | 保留 |
| agent_model | TEXT NOT NULL | nullable | 改为 NOT NULL |
| agent_config | TEXT DEFAULT '{}' | **缺失** | 补列 |
| skills | TEXT DEFAULT '[]' | ✓ | 保留 |
| default_prompt | TEXT DEFAULT '' | **缺失** | 补列 |
| is_active | INTEGER DEFAULT 1 | 用 status 文本 | **改为 is_active INTEGER**（对齐设计） |
| is_human | 当前自创 | **不在设计** | 移除（设计无此字段） |
| host_type / workspace_access / custom_model_package_dir / identity / status | 当前自创 | **不在设计** | **保留为 Orca 上层扩展**（不影响协作域收敛，但不在 shared types 暴露为"纯 TECH-DESIGN"字段） |
| 时间戳类型 | INTEGER（Unix ms） | TEXT ISO | **维持 TEXT ISO**（与 Orca 现有约定一致；标注为已知偏差） |

**决策**：
- 补齐 role / avatar_url / personality / agent_config / default_prompt / is_active。
- 移除 is_human（设计未要求）。
- host_type / workspace_access / custom_model_package_dir / identity / status 保留为 Orca 上层字段（协作域收敛不删除 Orca 扩展能力），但在 shared types 中明确分层：`TeamMemberCore`（设计字段）+ `TeamMemberOrca`（Orca 扩展）。
- 时间戳维持 TEXT ISO（项目一致性优先）。

#### projects

| 维度 | TECH-DESIGN | 当前实现 | 处理 |
|------|-------------|----------|------|
| name | TEXT NOT NULL | **缺失**（只有 repo_url/owner/repo） | 补列 |
| description | TEXT DEFAULT '' | **缺失** | 补列 |
| workspace_id | TEXT | **缺失** | 补列 |
| default_branch | TEXT DEFAULT 'main' | **缺失** | 补列 |
| git_initialized | INTEGER DEFAULT 1 | **缺失** | 补列 |
| status | TEXT DEFAULT 'active' | **缺失** | 补列 |
| repo_url / owner / repo / workspace_type | 当前自创 | **不在设计** | 保留为 Orca 上层扩展 |
| host_id / host_type / repo_path | ✓ | ✓ | 保留 |

**决策**：
- 补 name / description / workspace_id / default_branch / git_initialized / status。
- repo_url / owner / repo / workspace_type 保留为 Orca 扩展。

#### project_team_members

| 维度 | TECH-DESIGN | 当前实现 | 处理 |
|------|-------------|----------|------|
| role_in_project | TEXT DEFAULT 'member' | 用 role 命名 | 改名对齐 |
| joined_at | INTEGER | TEXT ISO | 维持 TEXT ISO |
| 外键 | 无 cascade | ON DELETE CASCADE | 保留 CASCADE（关系表，删主体应清关系） |

**决策**：role 改名 role_in_project，外键保留 CASCADE。

#### issues

| 维度 | TECH-DESIGN | 当前实现 | 处理 |
|------|-------------|----------|------|
| number | INTEGER NOT NULL | **缺失** | 补列 |
| priority | TEXT DEFAULT 'medium' | **缺失** | 补列 |
| owner_id | TEXT NOT NULL | 用 assignee_id | **改名 owner_id**（对齐设计） |
| workline_state | TEXT DEFAULT 'intake' | **缺失** | 补列 |
| status | TEXT DEFAULT 'open' | DEFAULT 'active' | 改为 'open' |
| 时间戳 | INTEGER | TEXT ISO | 维持 TEXT ISO |

**决策**：补齐 + 改名 owner_id + status 默认值对齐。

#### issue_comments

| 维度 | TECH-DESIGN | 当前实现 | 处理 |
|------|-------------|----------|------|
| author_type | TEXT NOT NULL | **缺失** | 补列 |
| author_name | TEXT NOT NULL | **缺失** | 补列 |
| visibility | TEXT DEFAULT 'project_team' | **缺失** | 补列 |
| updated_at | 设计无此列 | 当前有 | 移除（对齐设计） |

**决策**：补齐 author_type / author_name / visibility，移除 updated_at。

#### pull_requests

| 维度 | TECH-DESIGN | 当前实现 | 处理 |
|------|-------------|----------|------|
| project_id | TEXT NOT NULL | **缺失** | 补列（重要！PR 必须归属项目） |
| number | INTEGER NOT NULL | **缺失** | 补列 |

**决策**：补 project_id + number。

#### issue_worktrees

| 维度 | TECH-DESIGN | 当前实现 | 处理 |
|------|-------------|----------|------|
| worktree_id | TEXT NOT NULL | 用 base_path | **改名 worktree_id** |
| active_ref_name | TEXT | 用 active_refs 数组 | **改名 active_ref_name + 单值** |
| host_id | TEXT NOT NULL | **缺失** | 补列 |
| status | TEXT DEFAULT 'active' | **缺失** | 补列 |

**决策**：按设计收敛（worktree_id / active_ref_name / host_id / status）。

#### issue_git_refs

| 维度 | TECH-DESIGN | 当前实现 | 处理 |
|------|-------------|----------|------|
| ref_name | TEXT NOT NULL | 用 ref | **改名 ref_name** |
| ref_role | TEXT NOT NULL | 用 ref_type | **改名 ref_role** |
| member_id | TEXT | 用 created_by | **改名 member_id** |
| purpose | TEXT DEFAULT '' | 用 parent_ref | **改名 purpose** |
| UNIQUE | (issue_id, ref_name) | 无 | 加唯一约束 |

**决策**：按设计收敛。

#### activity_log

| 维度 | TECH-DESIGN | 当前实现 | 处理 |
|------|-------------|----------|------|
| actor_type | TEXT NOT NULL | **缺失** | 补列 |
| actor_name | TEXT NOT NULL | **缺失** | 补列 |
| 外键 project_id | 无 cascade | ON DELETE CASCADE | 保留 |

**决策**：补 actor_type / actor_name。

### 3.3 【建议性 1】canDelete 查询范围不完整 — 成立

当前 `canDelete` 只查了 project_team_members / issues / pull_requests / issue_worktrees。遗漏：
- `issue_comments.author_id`（评论作者）
- `pr_comments.author_id`（PR 评论作者）
- `issue_git_refs.created_by`（对齐设计后是 member_id）

**决策**：
- 按 TECH-DESIGN §3.2 的真实意图，canDelete **只校验活跃 worktree**（这是唯一"占用物理资源"的阻塞条件）。
- 但 project_membership / issue_assignee / pr_author 这些"软关联"也应阻止（避免出现孤儿数据）。
- **收敛方案**：canDelete 校验 4 类——活跃 worktree、项目成员关系、Issue 负责人、PR 作者。评论作者不阻止（评论是历史痕迹）。

### 3.4 【建议性 2】update 无法清空可选字段 — 成立

当前 `update()` 用 `field ?? existing.field`，一旦写入非空值，无法恢复为 NULL。

**决策**：区分"未传入"（保持旧值）与"显式传入 null/undefined"（清空）。引入哨兵标记或检查 `key in input`。最简方案：在 UpdateTeamMemberInput 中可选字段用 `T | null` 类型，`null` 表示"显式清空"，`undefined` 表示"不更新"。

### 3.5 【建议性 3】测试补齐 — 成立

需补：
1. delete 受保护：delete 有活跃 worktree 的成员应抛错。
2. delete 不级联业务数据：在 RESTRICT 外键下，尝试删除仍负责 Issue 的成员应被 DB 拒绝。
3. schema 契约：断言 TECH-DESIGN 关键列存在（role / owner_id / project_id / number 等）。

## 4. 拟修改文件

| 文件 | 动作 |
|------|------|
| `src/shared/team-types.ts` | 收敛 TeamMember 类型（分层 Core + Orca 扩展） |
| `src/main/runtime/collaboration/collaboration-database.ts` | 全量 schema 重构 + 外键策略分层 |
| `src/main/runtime/collaboration/team-store.ts` | delete 强制 canDelete + update 清空支持 + canDelete 范围收敛 |
| `src/main/runtime/collaboration/collaboration-database.test.ts` | 补 schema 契约测试 |
| `src/main/runtime/collaboration/team-store.test.ts` | 补 delete 保护 + 清空字段测试 |

## 5. 实施说明

见后续"实际修改"章节。

## 6. 验证结果

- ✅ **单元测试**：23/23 通过
  - 数据库 11 个测试（schema 契约 × 6、user_version、单例、RESTRICT 阻塞删除 × 2、CASCADE 删除评论、唯一约束 × 2）
  - Team Store 12 个测试（创建全字段、列表顺序、update 刷新 updatedAt、**update 清空字段 null vs undefined**、更新不存在抛错、canDelete 允许/阻止、**delete 抛错保护**、delete 成功级联成员关系、**delete 不级联业务数据**、**DB 级 RESTRICT 兜底**）
- ✅ **类型检查**：`tsc --noEmit -p config/tsconfig.node.json` 通过（EXIT=0）
- ⏳ 未验证：集成测试（IPC / UI 层未开始）、并发写入压力测试、跨平台构建

## 7. 风险与待确认项

- **时间戳格式偏差**：TECH-DESIGN 用 INTEGER，Orca 用 TEXT ISO。本轮选择维持 TEXT ISO（与 Orca 一致），但需在文档明确标注。
- **Orca 扩展字段**：is_human 被移除，但 host_type/workspace_access 保留为 Orca 上层扩展，通过 shared types 分层避免污染协作域。
- **RESTRICT 外键与 canDelete 的关系**：应用层 canDelete 先校验（给友好提示），RESTRICT 是最后防线（防直接 SQL 绕过）。两者并存，职责清晰。
- **comment 级联删除**：当前决策是成员删除时级联其评论。若业务要求保留评论痕迹（如"已删除成员"），需后续改 SET NULL + 显示占位。本轮先按 CASCADE。

## 8. 已沉淀记录

- `multi-agent-iteration/2026-08-14-round2-review-fix.md`（本文件）— Review 核对结论、修复方案、验证结果

### 实际修改文件清单

| 文件 | 动作 | 关键变更 |
|------|------|----------|
| `src/shared/team-types.ts` | 重构 | TeamMember 收敛到 TECH-DESIGN（role/avatarUrl/personality/agentConfig/defaultPrompt/isActive）；SkillBinding 改为 {skillId, skillName, enabled, config}；UpdateTeamMemberInput 用 Clearable\<T\> 区分 null 清空/undefined 不更新；新增 Issue/Pr/Worktree/ActivityLog/ProjectTeamMember 完整类型；TeamMemberOrca 保留 Orca 上层扩展 |
| `src/main/runtime/collaboration/collaboration-database.ts` | 重构 | user_version 升到 2；team_members 补齐 6 列 + 移除 is_human；projects 补齐 6 列；issues 改 assignee_id→owner_id + 补 number/priority/workline_state + status 默认 'open'；pull_requests 补 project_id/number + issue_id SET NULL；issue_worktrees 改 base_path→worktree_id + active_refs→active_ref_name + 补 host_id/status；issue_git_refs 全量改名对齐 + UNIQUE(issue_id, ref_name)；外键分层：业务主体 RESTRICT，评论 CASCADE |
| `src/main/runtime/collaboration/team-store.ts` | 重构 | delete() 内部强制 canDelete() 抛错；canDelete 范围收敛（活跃 worktree + 项目成员 + Issue 负责人 + PR 作者，不阻塞评论）；update() 用 resolveField/resolveString 支持 null 清空；AgentType/AgentModel 必填 |
| `src/main/runtime/collaboration/collaboration-database.test.ts` | 重构 | 新增 6 个 schema 契约测试（PRAGMA table_info）；新增 2 个 RESTRICT 阻塞测试；新增 CASCADE 测试；新增 issue_git_refs 唯一约束测试 |
| `src/main/runtime/collaboration/team-store.test.ts` | 重构 | makeMember 补齐全部 TECH-DESIGN 字段；新增 update 清空字段测试；新增 delete 抛错保护测试；新增 delete 不级联业务数据测试；新增 DB 级 RESTRICT 兜底测试 |

## 9. 下一轮建议

收敛完成后，进入 ROADMAP 下一任务：**B3 Project Store**（项目接入与 git init 流程）+ **B5 Issue Store**。依赖本轮收敛后的 schema 与类型。
