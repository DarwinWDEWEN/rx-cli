# Orca Fork 本地启动 SOP

> 适用范围：当前 `rx-cli` fork 的本地开发环境启动  
> 更新时间：2026-08-14

---

## 1. 目标

确保当前 fork 可以在本机完成以下动作：

1. 安装依赖
2. 准备 Electron 运行时
3. 启动 Orca 开发模式

---

## 2. 前置条件

启动前请确认本机具备以下环境：

- macOS
- Git
- Xcode Command Line Tools
- `nvm`
- Node `24.14.0`
- pnpm `10.24.0`

仓库当前要求：

- `package.json` 中 `engines.node = 24`
- `packageManager = pnpm@10.24.0`

---

## 3. 标准启动步骤

### Step 1：加载本地 shell 环境

```bash
source ~/.zshrc
```

### Step 2：切换到标准 Node 版本

```bash
nvm install 24.14.0
nvm use 24.14.0
node -v
pnpm -v
```

预期：

- `node -v` 输出 `v24.14.0`
- `pnpm -v` 输出 `10.24.0`

### Step 3：安装依赖

```bash
pnpm install
```

说明：

- `postinstall` 会自动尝试准备 Electron 原生依赖
- 若 Electron 二进制下载失败，可继续执行下一步手动修复

### Step 4：准备 Electron 运行时

如果默认网络可以访问 GitHub，直接执行：

```bash
pnpm run ensure:electron-runtime
```

如果默认网络访问 GitHub 超时，使用 Electron 镜像：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" pnpm run ensure:electron-runtime
```

预期：

- `node_modules/electron/dist` 存在
- `node_modules/electron/path.txt` 存在
- `node_modules/node-pty/build/Release/pty.node` 存在

### Step 5：启动开发模式

```bash
pnpm dev
```

如果 Electron 下载需要镜像，可一起带上：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" pnpm dev
```

---

## 4. 本次验证得到的推荐命令

在当前机器上，下面这组命令是最稳妥的：

```bash
source ~/.zshrc
nvm use 24.14.0
pnpm install
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" pnpm run ensure:electron-runtime
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" pnpm dev
```

---

## 5. 常见问题排查

### 5.1 `node: command not found` / `pnpm: command not found`

原因：

- 当前终端没有加载 `~/.zshrc`

处理：

```bash
source ~/.zshrc
```

### 5.2 Node 版本不对

现象：

- `pnpm install` 或 `pnpm dev` 过程中出现版本不匹配

处理：

```bash
nvm use 24.14.0
```

### 5.3 Electron 二进制下载失败

现象：

- `ensure:electron-runtime` 报 GitHub 连接超时
- `node_modules/electron/dist/version` 不存在

处理：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" pnpm run ensure:electron-runtime
```

### 5.4 `node-pty` Electron 重建失败

现象：

- `node-pty resolved to ../prebuilds/...; expected build/Release`
- Electron ABI 重建未完成

处理：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" pnpm run ensure:electron-runtime
```

完成后确认：

```bash
ls node_modules/node-pty/build/Release/pty.node
```

### 5.5 在 Trae / Agent 沙箱中启动失败

现象：

- 无法写入 `~/Library/Application Support/orca-dev`
- 日志出现 `TRAE Sandbox Error: hit restricted`
- GPU / sandbox 初始化失败

原因：

- Electron 开发模式默认会写入本机用户目录
- 当前沙箱未放开对应目录权限

建议处理：

1. 优先在系统本地终端直接启动，而不是在受限 Agent 沙箱中启动
2. 或在 Trae 中放开 `~/Library/Application Support/orca-dev` 的写权限

---

## 6. 启动完成判定

满足以下条件，可认为当前 fork 已具备本地开发启动能力：

- `pnpm install` 成功
- `pnpm run ensure:electron-runtime` 成功
- Electron 主进程、preload、renderer dev server 均完成构建
- 本地 Orca 开发窗口成功拉起

---

## 7. 后续建议

建议团队统一约定：

1. 本地开发统一使用 Node `24.14.0`
2. 国内网络默认带上 `ELECTRON_MIRROR`
3. 不在受限沙箱中做首次 Electron 启动验证
