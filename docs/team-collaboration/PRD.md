# Orca 团队协作功能 - 产品需求文档 (PRD)

> 版本: v3.1 | 日期: 2026-08-14 | 状态: 修订版

---

## 1. 概述

### 1.1 背景

Orca 现有的核心能力：

| 能力 | 位置 | 描述 |
|------|------|------|
| 文件夹管理 | 项目视图 | 打开文件夹即项目 |
| Git Worktree | 项目视图 | 创建/管理/删除 worktree |
| Terminal + PTY | 终端面板 | 多终端并行 |
| Agent 运行 | 终端内 | Claude/Codex/Kimi/OpenCode 等 |
| Git Issues/PRs | Tasks 面板 | 对接 GitHub/GitLab 远程 Issue/PR |

**缺失的能力**：

- 没有"公司团队"层来统一管理人员和 Agent 配置
- 没有"项目团队"概念——从公司团队抽调人员组成项目小组
- 没有基于 Git 的 Issue 驱动 Worktree 自动分配机制
- 缺少项目级的 Issue/PR 管理视图（独立于 Tasks）
- 缺少 Git 初始化引导，打开文件夹后不能自然进入协作流程
- Agent 之间缺少标准化的协作 harness

### 1.2 愿景

> **公司团队 → 项目团队 → Issue 驱动 → 自动开发**

1. 在公司 **Teams** 中定义人员（配置 Agent/Model/Skills）
2. 在 **Issues and PRs** 中按项目管理需求和 PR
3. 为每个 Project 组建**项目团队**（成员来自公司 Team）
4. 用户提交 Issue → 单一负责人对接 → Team 自动完成开发

### 1.3 设计原则

| 原则 | 描述 |
|------|------|
| Teams 是公司级 | 成员可跨项目、跨 Issue 拥有多个 worktree |
| 项目团队从 Teams 抽调 | 项目成员必须是公司 Teams 中的成员 |
| Project 与 Orca 一致 | 打开的文件夹即项目；未初始化 Git 时提示 `git init` |
| Git 驱动协作 | 所有衍生能力以 Git 仓库为前提 |
| 推荐单一联系人 | 默认由负责人对外沟通，但不做硬性权限隔离 |
| 项目团队全员可见 | Issue/PR 评论默认对项目团队成员可见 |
| 复用 Tasks 能力 | 不修改 Tasks，创建并列的 Issues and PRs 面板 |
| 复用 Orca 宿主能力 | 本地、SSH、WSL、多宿主执行沿用 Orca 现有能力 |
| Harness 是运行时约束层 | 通过上下文注入、Prompt 规则、评论回写和收敛策略引导协作，而非硬编码审批流 |

---

## 2. 核心概念模型

### 2.1 三层结构

```
┌─────────────────────────────────────────────────────────┐
│  Company Teams (公司团队)                                 │
│  ┌───────────────────────────────────────────────────┐  │
│  │ 成员 A: 产品经理                                    │  │
│  │   ├── Agent: Kimi CLI  |  Model: K3                │  │
│  │   ├── Skills: [需求分析, 文档撰写]                   │  │
│  │   └── Prompt: "你是资深产品经理..."                   │  │
│  ├───────────────────────────────────────────────────┤  │
│  │ 成员 B: 全栈工程师                                  │  │
│  │   ├── Agent: OpenCode  |  Model: Deepseek V4 Flash  │  │
│  │   ├── Skills: [代码编写, 测试, 重构]                 │  │
│  │   └── Prompt: "你是全栈工程师..."                     │  │
│  ├───────────────────────────────────────────────────┤  │
│  │ 成员 C: UI 设计师                                   │  │
│  │   ├── Agent: OpenCode  |  Model: 多模态模型          │  │
│  │   ├── Skills: [UI设计, 样式编写]                     │  │
│  │   └── Prompt: "你是UI设计师..."                      │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                               │
│              组建项目团队 │ (从 Teams 抽调)               │
│                          ▼                               │
├─────────────────────────────────────────────────────────┤
│  Project Alpha 项目团队                                   │
│  ├── 负责人: 成员 A (产品经理)                             │
│  ├── 开发: 成员 B (全栈工程师)                            │
│  └── 设计: 成员 C (UI 设计师)                             │
│                          │                               │
├─────────────────────────────────────────────────────────┤
│  Project Beta 项目团队                                    │
│  ├── 负责人: 成员 B (全栈工程师)                          │
│  └── 开发: 成员 A (产品经理，兼修内容系统)                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Teams（公司团队）

**Teams 是机器级/公司级的，管理所有人员配置**。

| 属性 | 描述 |
|------|------|
| 成员姓名 | 显示名称 |
| 角色 | PM / Dev / Designer / QA / SRE 等 |
| Agent 类型 | Claude Code / Codex / Kimi CLI / OpenCode / Cursor 等 |
| 模型 | K3 / Deepseek V4 Flash / Sonnet / 多模态模型 等 |
| Skills | 绑定的 Skill 列表 |
| 默认 Prompt | 角色 prompt 模板 |
| 性格特质 | 性格描述（影响 Agent 行为） |
| 职责范围 | 负责的工作类型 |
| 能力标签 | 技能标签 |

**关键约束**：
- Team 成员**不绑定特定 worktree**——worktree 是项目/Issue 级的
- 删除成员前，必须关闭该成员在所有项目/Issue 中的所有 worktree
- 一个成员可同时参与多个项目、多个 Issue

### 2.3 Issues and PRs（项目级需求管理）

**与 Tasks 并列的新面板，按已接入 Git 的 Orca 项目管理 Issue 和 PR**。

```
┌─────────────────────────────────────────────────────────┐
│  [Tasks]  [Issues and PRs]  [Teams]                      │
├─────────────────────────────────────────────────────────┤
│  Issues and PRs                                         │
│  ┌─────────┬──────────────────────────────────────────┐ │
│  │ Projects│  Project Alpha                           │ │
│  │         │  ┌────────────────────────────────────┐  │ │
│  │  Alpha ─┤  │ Issues    PRs    Team    Activity   │  │ │
│  │  Beta   │  └────────────────────────────────────┘  │ │
│  │  Gamma  │                                        │ │
│  │         │  ┌─ Issue List ─────────────────────┐   │ │
│  │         │  │ #12 用户登录 (Open)    负责人:小K  │   │ │
│  │         │  │ #13 支付集成 (Review)  负责人:小K  │   │ │
│  │         │  │ #14 首页改版 (Dev)     负责人:小D  │   │ │
│  │         │  └───────────────────────────────────┘   │ │
│  │         │                                        │ │
│  │         │  ┌─ Project Team ──────────────────┐    │ │
│  │         │  │ 👤 小K (PM) - 负责人             │    │ │
│  │         │  │ 👤 小D (Dev)                     │    │ │
│  │         │  │ 👤 小M (Designer)                │    │ │
│  │         │  │ [+ 邀请成员]                      │    │ │
│  │         │  └──────────────────────────────────┘    │ │
│  └─────────┴──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 2.4 Issue 驱动的 Worktree 模型

```
Issue #12: 实现用户登录功能
  │
  ├── Issue 工作线
  │
  ├── 负责人: 小K (PM)
  │     └── Worktree: issue-12-pm/
  │           └── Terminal 1: Agent Kimi/K3 (需求澄清、协调、集成)
  │
  ├── 开发: 小D (Dev)
  │     └── Worktree: issue-12-dev/
  │           └── Terminal 1: Agent OpenCode/Deepseek (负责编码)
  │
  └── 设计: 小M (Designer)
        └── Worktree: issue-12-design/
              └── Terminal 1: Agent OpenCode/多模态 (负责 UI 设计)

各成员在独立 worktree 中推进 → 负责人集成/解决冲突 → Issue PR → 合入 main
```

**规则**：
- 每个 Issue 为有任务的成员分配独立 worktree
- 每个成员在该 Issue 上只有**一个 Terminal**（Agent 内部并行子任务）
- 一个成员可同时负责多个 Issue（多个 worktree）
- 如出现代码冲突，由项目负责人负责集成与冲突解决

**实现说明**：
- 产品层以 worktree 作为主要心智模型
- Git 底层仍需要为 worktree 提供可 checkout 的引用状态
- `Issue 工作线` 是业务概念，不等同于单一 branch
- 在大 Issue 中，负责人可在工作线下按需创建多个 branches / refs
- 该分支/ref 策略属于实现细节，不作为用户主要操作对象

### 2.5 推荐单一联系人机制

每个 Issue 有一个**负责人**，系统默认推荐采用单一联系人模式：
- 负责人优先作为与用户沟通的主要接口
- 负责人在 Issue 中汇总需求、分发任务、组织验收
- 项目团队成员都可以看到 Issue 评论和协作上下文
- 负责人通常是 PM 或产品经理，但可以是任何 Team 成员
- 该机制用于优化体验，不做硬性权限隔离

---

## 3. 界面布局

### 3.1 左侧导航栏（Sidebar Nav）

Orca 的导航入口位于**左侧边栏顶部**，采用垂直排列方式。新增的 "Issues and PRs" 和 "Teams" 按钮将与现有 Tasks、Automations、Search 等按钮并列，保持一致的视觉风格。

```
┌──────────────────┐
│  ◯ SetupGuide    │  ← 条件显示
│  📋 Tasks        │  ← 现有
│  📁 Artifacts    │  ← 条件显示
│  📋 Issues & PRs │  ← 【新增】
│  ⏰ Automations  │  ← 现有
│  👥 Agents       │  ← 实验性
│  📱 Mobile       │  ← 现有
│  👥 Teams        │  ← 【新增】
│  🔍 Search       │  ← 现有（底部搜索框）
├──────────────────┤
│  Worktree List   │
│  ...             │
└──────────────────┘
```

**样式规范**（与现有侧边栏导航按钮一致）：

| 属性 | 值 |
|------|-----|
| 文字大小 | 13px |
| 图标大小 | 16px (size-4) |
| 圆角 | rounded-md |
| 内边距 | px-2 py-1.5 |
| 间距 | gap-0.5 (2px) |
| 激活态背景 | bg-worktree-sidebar-accent |
| 非激活态文字 | text-worktree-sidebar-foreground/60 |
| 悬停态背景 | hover:bg-worktree-sidebar-foreground/8 |

**导航项说明**：

| 按钮 | 图标 | 与现有关系 | 描述 |
|------|------|-----------|------|
| Tasks | List | 现有 | 远程 Git Issue/PR 管理 |
| Issues and PRs | CircleDot | **新增** | 本地 Issue/PR 管理，按项目分组 |
| Automations | CalendarClock | 现有 | 定时自动化任务 |
| Teams | Users | **新增** | 公司团队管理 |
| Search | Search | 现有 | 搜索 worktree 和标签页 |

**右键菜单**：每个导航按钮支持右键 "Hide from sidebar"，可在设置中隐藏对应按钮。

### 3.2 Issues and PRs 主面板

点击侧边栏 "Issues and PRs" 按钮后，主区域显示项目级 Issue/PR 管理界面：

```
┌─────────────────────────────────────────────────────────┐
│  Issues and PRs                                         │
├────────────┬────────────────────────────────────────────┤
│            │  Project: Alpha                    [+ New Issue]│
│  Projects  │  ┌────────────────────────────────────────┐  │
│            │  │ [Issues] [PRs] [Team] [Activity]        │  │
│  ▼ Alpha   │  └────────────────────────────────────────┘  │
│    Beta    │                                            │
│    Gamma   │  ┌─ Issues ──────────────────────────────┐  │
│            │  │                                      │  │
│  [+ New    │  │ #12 用户登录功能          [Open]     │  │
│   Project] │  │     负责人: 小K | 成员: 小D, 小M    │  │
│            │  │                                      │  │
│            │  │ #13 支付集成              [Review]   │  │
│            │  │     负责人: 小K | 成员: 小D          │  │
│            │  │                                      │  │
│            │  │ #14 首页改版              [In Dev]   │  │
│            │  │     负责人: 小D | 成员: 小M          │  │
│            │  │                                      │  │
│            │  └──────────────────────────────────────┘  │
│            │                                            │
│            │  ┌─ Project Team ───────────────────────┐  │
│            │  │ 👤 小K (PM) - 负责人  [移除]          │  │
│            │  │ 👤 小D (Dev)          [移除]          │  │
│            │  │ 👤 小M (Designer)     [移除]          │  │
│            │  │ [+ 邀请团队成员]                      │  │
│            │  └──────────────────────────────────────┘  │
└────────────┴────────────────────────────────────────────┘
```

### 3.3 Teams 主面板

点击侧边栏 "Teams" 按钮后，主区域显示公司团队管理界面：

```
┌─────────────────────────────────────────────────────────┐
│  Teams                                                  │
├─────────────────────────────────────────────────────────┤
│  [+ 添加成员]                                           │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ 👤 小K - 产品经理                      [编辑] [删除]│  │
│  │    Agent: Kimi CLI  |  Model: K3                  │  │
│  │    Skills: 需求分析, 文档撰写, 项目管理             │  │
│  │    Prompt: "你是资深产品经理，擅长..."              │  │
│  │    状态: 🟢 空闲  |  参与项目: 2  |  活跃 Issue: 3 │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ 👤 小D - 全栈工程师                    [编辑] [删除]│  │
│  │    Agent: OpenCode  |  Model: Deepseek V4 Flash    │  │
│  │    Skills: 代码编写, 测试, 重构, 代码审查           │  │
│  │    Prompt: "你是全栈工程师，注重代码质量..."         │  │
│  │    状态: 🟡 工作中  |  参与项目: 3  |  活跃 Issue: 5 │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ 👤 小M - UI 设计师                      [编辑] [删除]│  │
│  │    Agent: OpenCode  |  Model: 多模态模型            │  │
│  │    Skills: UI设计, 样式编写, 用户体验               │  │
│  │    Prompt: "你是UI设计师，擅长将需求转化为..."       │  │
│  │    状态: 🟢 空闲  |  参与项目: 1  |  活跃 Issue: 1 │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 3.4 Issue 详情面板

```
┌─────────────────────────────────────────────────────────┐
│  Issue #12: 实现用户登录功能                    [关闭]  │
├─────────────────────────────────────────────────────────┤
│  [讨论] [Worktrees] [Pipeline] [活动]                    │
│                                                         │
│  状态: Open  |  优先级: High  |  工作线: issue-12 │
│  负责人: 小K (PM)                                       │
│                                                         │
│  ┌─ 讨论 ────────────────────────────────────────────┐  │
│  │                                                   │  │
│  │ 👤 用户: 实现用户登录功能，支持手机号+验证码        │  │
│  │                                                   │  │
│  │ 🤖 小K (PM): 收到需求。我来分析并协调团队。        │  │
│  │    初步分析: 需要以下工作...                       │  │
│  │    1. 需求文档 (我负责)                            │  │
│  │    2. 后端开发 (小D)                               │  │
│  │    3. UI 设计 (小M)                                │  │
│  │                                                   │  │
│  │ 🤖 小D (Dev): 评估后端工作量约 2 天，可以开始。     │  │
│  │                                                   │  │
│  │ 🤖 小M (Designer): 可以提供设计稿，需要 1 天。     │  │
│  │                                                   │  │
│  │ [输入评论...]                                      │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Worktrees ───────────────────────────────────────┐  │
│  │ 👤 小K: issue-12-pm/       [打开] [关闭]          │  │
│  │ 👤 小D: issue-12-dev/      [打开] [关闭]          │  │
│  │ 👤 小M: issue-12-design/   [打开] [关闭]          │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Pipeline ────────────────────────────────────────┐  │
│  │ [需求确认] ✅ ──→ [设计] ✅ ──→ [开发] 🔄 ──→ [Review] │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 4. 功能规格

### 4.1 Teams（公司团队）管理

| 功能 | 优先级 | 描述 |
|------|--------|------|
| 添加成员 | P0 | 姓名、角色、头像 |
| 编辑成员 | P0 | 修改所有配置 |
| 删除成员 | P0 | 必须所有 worktree 已关闭 |
| Agent 类型选择 | P0 | Claude/Codex/Kimi/OpenCode/Cursor 等 |
| 模型配置 | P0 | 每个成员可配置不同模型 |
| Skills 绑定 | P0 | 选择可用 Skill 列表 |
| 默认 Prompt | P0 | 角色 prompt 模板 |
| 性格特质 | P1 | 性格描述 |
| 职责范围 | P1 | 负责的工作类型 |
| 能力标签 | P1 | 技能标签 |
| Agent 健康检查 | P1 | 验证 CLI 可用 |
| 成员状态展示 | P0 | 显示参与项目数、活跃 Issue 数 |

### 4.2 Issues and PRs（项目级）

| 功能 | 优先级 | 描述 |
|------|--------|------|
| 接入项目 | P0 | 基于 Orca 已打开文件夹；检测 Git，未初始化则提示 `git init` |
| 项目列表 | P0 | 左侧项目列表 |
| 创建 Issue | P0 | 标题、描述、优先级、指定负责人 |
| Issue 列表 | P0 | 按状态/负责人筛选 |
| Issue 详情 | P0 | 讨论 + Worktrees + Pipeline + 活动 |
| Issue 状态流转 | P0 | Open → In Dev → Review → Done |
| Issue 评论 | P0 | 用户和 Agent 都可评论，项目团队成员默认可见 |
| 创建子 Issue | P1 | 需求分解 |
| 创建 PR | P0 | 从 Issue 工作线创建 |
| PR Diff 查看 | P0 | 复用现有 diff 能力 |
| PR 审批 | P0 | Reviewer approve/reject |
| PR 合并 | P0 | Merge/Squash/Rebase |
| PR 行内评论 | P1 | 代码行级评论 |
| 活动日志 | P0 | 所有操作时间线 |

### 4.3 项目团队管理

| 功能 | 优先级 | 描述 |
|------|--------|------|
| 邀请成员 | P0 | 从 Teams 添加到项目团队 |
| 移除成员 | P0 | 从项目团队移除（需先关闭 worktree） |
| 指定负责人 | P0 | 为 Issue 指定负责人，默认承担对外沟通与集成职责 |
| 查看项目团队 | P0 | 显示当前项目所有参与成员 |

### 4.4 Issue 驱动开发

| 功能 | 优先级 | 描述 |
|------|--------|------|
| 分配成员 Worktree | P0 | 为每个有任务的成员创建 worktree |
| 启动 Agent | P0 | 在 worktree Terminal 中启动绑定 Agent |
| 推荐单一联系人 | P1 | 默认由负责人对外沟通，但项目团队评论全员可见 |
| Agent 评论反馈 | P0 | Agent 在 Issue 中评论进度，项目团队共享上下文 |
| Worktree 底层引用管理 | P1 | 系统自动处理 Git 引用状态，不要求用户理解分支细节 |
| PR 自动创建 | P1 | 开发完成后提示创建 PR |
| Issue 关闭 | P0 | PR 合并后自动/手动关闭 Issue |

### 4.5 Pipeline Harness

| 功能 | 优先级 | 描述 |
|------|--------|------|
| Issue CLI | P0 | Agent 读写 Issue 评论 |
| PR CLI | P0 | Agent 操作 PR |
| Worktree CLI | P0 | Agent 操作 worktree |
| Team CLI | P0 | Agent 通知其他成员 |
| Git CLI | P0 | Agent 执行 git 操作 |
| 收敛规则引擎 | P0 | 轮次上限/超时/scope 控制 |
| Harness Prompt 注入 | P0 | 自动注入角色 Prompt |
| 角色工作流配置 | P0 | 通过 Prompt + Harness 定义成员协作方式，不在系统中硬编码角色流程 |

---

## 5. 用户流程

### 5.1 首次配置（一次性）

```
1. Orca 启动 → 检测 git → 未安装则提示
2. 打开/创建文件夹 → 检测是否为 Git 仓库 → 不是则提示 `git init`
3. 进入 Teams 面板 → 创建公司团队:
   a. 产品经理 → Agent: Kimi CLI, Model: K3
   b. 全栈工程师 → Agent: OpenCode, Model: Deepseek V4 Flash
   c. UI 设计师 → Agent: OpenCode, Model: 多模态模型
   d. 测试工程师 → Agent: Claude Code, Model: Sonnet
4. 为每个成员配置 Skills、Prompt、性格特质
5. 成员如何开展工作、如何协同、如何收敛，主要由 Prompt 和 Harness 规则决定
```

### 5.2 项目接入与团队组建

```
1. 用户在 Orca 中打开项目文件夹 "Alpha"
2. 系统检测 Git 状态：
   - 已初始化 → 直接接入 Issues and PRs
   - 未初始化 → 提示 `git init`，成功后接入
3. 在 Issues and PRs 中为该项目组建项目团队:
   - 邀请 小K (PM) → 设为负责人
   - 邀请 小D (Dev)
   - 邀请 小M (Designer)
4. 项目团队组建完成
```

### 5.3 Issue 驱动开发（日常核心）

```
1. 用户（或负责人）在项目中创建 Issue:
   "实现用户登录功能，支持手机号+验证码"

2. 系统自动:
   a. 为该 Issue 建立工作线
   b. 通知负责人小K

3. 负责人小K 依据当前 Harness 规则分配任务:
   - 小D: 后端开发
   - 小M: UI 设计

4. 系统自动为 小D、小M 创建独立 worktree:
   - issue-12-dev/ (小D)
   - issue-12-design/ (小M)

5. 各成员在各自 worktree 的 Terminal 中启动 Agent:
   - 小K: Kimi/K3 → 与用户沟通、输出需求文档
   - 小D: OpenCode/Deepseek → 编码实现
   - 小M: OpenCode/多模态 → UI 设计

6. Agent 在 Issue 中评论进度，项目团队共享上下文；对外沟通默认由负责人小K 主导

7. 各成员完成各自 worktree 中的任务后，由负责人基于当前工作线组织集成、处理冲突并创建/推进 Issue PR

8. Review → 合并 → 关闭 Issue → 关闭 Worktree → 变更合入 main
```

### 5.4 并行 Issue 开发

```
项目 Alpha 同时处理 3 个 Issue:

Issue #12 (登录):
  ├── 小K: issue-12-pm/ (Terminal: Kimi)
  ├── 小D: issue-12-dev/ (Terminal: OpenCode)
  └── 小M: issue-12-design/ (Terminal: OpenCode)

Issue #13 (支付):
  ├── 小K: issue-13-pm/ (Terminal: Kimi)
  └── 小D: issue-13-dev/ (Terminal: OpenCode)

Issue #14 (首页):
  ├── 小D: issue-14-dev/ (Terminal: OpenCode)
  └── 小M: issue-14-design/ (Terminal: OpenCode)

小D 有 3 个 worktree（每个 Issue 一个）
每个 worktree 1 个 Terminal
Agent 内部并行处理子任务
```

---

## 6. 数据模型概览

### 6.1 核心实体关系

```
Teams (公司级)
  └── TeamMember ──1:1──→ AgentConfig
       │
       └── 参与多个 Project
       └── 参与多个 Issue (通过 Worktree)

Project (项目)
  ├── 与 Orca Project 一致（打开的文件夹）
  ├── 以 Git 仓库为协作前提
  ├── 1:N → Issue
  └── 1:N → ProjectTeamMember (中间表，关联 TeamMember)

Issue
  ├── 1:N → Worktree
  ├── N:1 → Project
  ├── N:1 → Owner (负责人，TeamMember)
  ├── 1:N → IssueComment
  └── 1:1 → PullRequest（可选，完成阶段产生）

Worktree
  ├── N:1 → Issue
  ├── N:1 → TeamMember
  ├── 1:1 → Terminal (每个 Issue-Member 对只有一个 Terminal)
  └── 底层关联 Git checkout 状态（实现细节）

Terminal
  ├── 1:1 → AgentSession
  └── 运行绑定的 Agent + Model
```

### 6.2 存储方案

| 数据 | 存储 | 位置 |
|------|------|------|
| Teams/Members | SQLite | `~/.orca/collaboration.db` |
| Projects | SQLite | `~/.orca/collaboration.db` |
| Issues/Comments | SQLite | `~/.orca/collaboration.db` |
| PRs/Comments | SQLite | `~/.orca/collaboration.db` |
| Worktree-Issue 映射 | SQLite | `~/.orca/collaboration.db` |
| Agent 配置 (加密) | SQLite | `~/.orca/collaboration.db` |
| 活动日志 | SQLite | `~/.orca/collaboration.db` |

---

## 7. Pipeline Harness 设计

### 7.1 CLI 工具集

```bash
# Issue 操作
orca issue show <id>
orca issue comment <id> "评论"
orca issue status <id> <status>
orca issue list --project <id>

# PR 操作
orca pr create --issue <id> --title "..."
orca pr show <id>
orca pr comment <id> "评论"
orca pr merge <id>

# Worktree/Git 操作
orca git commit -m "message"
orca git push
orca git diff

# Team 通信
orca team notify <member> "消息"
```

### 7.2 Harness Prompt 注入

```
System Prompt:
  角色: {member_name}，{role}
  性格: {personality}
  Skills: {skills}
  默认 Prompt: {default_prompt}

  当前 Issue: {issue_title}
  Issue 工作线: {issue_workline}
  Worktree: {worktree_path}
  你是本 Issue 的{role}，{如果是负责人，额外注明"负责人，优先负责对外沟通和集成"}

  规则:
  - 每次操作后在 Issue 中评论反馈
  - 任务完成后必须评论总结
  - 使用 orca CLI 工具执行操作
  - 禁止需求无限膨胀
  - 角色工作流由 Prompt 与 Harness 决定，不依赖固定审批模板
```

### 7.3 Harness 运行时骨架

参考 CodeBuddy NPC 的 harness 机制后，我们将 Harness 定义为一层运行时骨架，而不是固定流程模板。对本项目而言，Harness 至少要覆盖以下 5 层：

| 层级 | 作用 | 在 Orca 协作模块中的落点 |
|------|------|------|
| 事件入口 | 决定何时拉起协作执行 | Issue 创建、负责人分派、Issue 评论、PR 状态变化 |
| 场景上下文 | 让 Agent 知道自己在谁的项目、哪条工作线、以什么身份工作 | `project / issue / workline / member / assignment / worktree / host / workMode` |
| Prompt 约束 | 约束角色职责、反馈格式、scope 边界 | `defaultPrompt + skills + personality + Harness 规则` |
| 执行适配 | 将统一的上下文交给不同 Agent CLI / SDK 去执行 | 复用 Orca terminal/runtime，适配不同 agentType |
| 反馈闭环 | 关键动作后回写评论、状态和结果 | Issue 评论、PR 评论、活动日志、负责人总结 |

这意味着我们后续实现不应只做一段 `systemPrompt` 字符串拼接，而应显式建设：

1. 事件触发点
2. 上下文注入模型
3. Agent 执行适配层
4. 评论 / 状态回写闭环
5. 收敛与超时规则

CodeBuddy 的 CNB 平台入口、容器环境和 `CNB_*` 变量不能直接照搬；但其将 `systemPrompt / userPrompt / executor / feedback loop` 解耦的方式，对 Orca 版 Harness 有直接参考价值。

---

## 8. 里程碑

| 里程碑 | 内容 | 周期 |
|--------|------|------|
| M1 | Teams + Issues and PRs 基础 + 项目团队 | 3 周 |
| M2 | Issue 驱动开发 + Worktree 自动分配 | 2 周 |
| M3 | Pipeline Harness + Agent 协作 | 3 周 |
| M4 | 收敛机制 + 协作体验 + 并行优化 | 2 周 |

---

## 9. 成功指标

| 指标 | 目标 |
|------|------|
| Issue 自主完成率 | > 50% |
| 平均 Issue 处理时间 | < 4h |
| 人工介入率 | < 30% |
| 并行 Issue 处理数 | ≥ 3 个/项目 |

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Agent 协作效率低 | 高 | 收敛规则 + 超时上报 + 人类兜底 |
| 需求 scope 膨胀 | 高 | 负责人审批 + 轮次上限 |
| 多 Agent 并发冲突 | 中 | 独立 worktree 隔离，负责人负责集成冲突 |
| Agent CLI 兼容性 | 中 | 抽象 CLI 层 |
