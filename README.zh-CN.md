<div align="center">

# Coordy

### 本机运行的编码智能体指挥台

在一个桌面工作区里规划任务、分派智能体、组织团队，并实时掌握每一次执行。

[English](README.md) · [快速开始](#快速开始) · [核心能力](#核心能力) · [开发](#开发)

![Version](https://img.shields.io/badge/version-0.2.0-6d5dfc?style=flat-square)
![Rust](https://img.shields.io/badge/core-Rust-dea584?style=flat-square&logo=rust)
![Electron](https://img.shields.io/badge/desktop-Electron-47848f?style=flat-square&logo=electron)
![Local first](https://img.shields.io/badge/data-local--first-16a34a?style=flat-square)

</div>

Coordy 把你常用的编码智能体放进同一个工作区。创建任务、选择合适的智能体、连接依赖、安排自动化，然后直接查看谁在执行、卡在哪里、下一步该由谁接手。

它使用你电脑上已经安装的 Claude Code、Codex、Gemini CLI、GitHub Copilot、OpenCode 和 Cursor。项目、执行记录与密钥都保留在本机。

## 核心能力

|                   | 你可以做什么                                                                 |
| ----------------- | ---------------------------------------------------------------------------- |
| **任务与项目**    | 用看板或列表规划工作，添加优先级、截止日期、标签、附件、子任务和项目上下文。 |
| **智能体工作区**  | 创建可复用的智能体，配置指令、模型、Skills、访问范围和并发上限。             |
| **智能体团队**    | 把任务交给单个智能体或小队，指定总管，并按依赖图自动推进已经就绪的工作。     |
| **实时执行**      | 在一个界面查看运行、评论、重试、工具活动、收件箱通知和图状态变化。           |
| **自动化**        | 把 runbook 变成定时任务或随时手动执行的本机流程。                            |
| **GitHub 上下文** | 通过本机 `gh` CLI 同步 Pull Request、检查结果和可合并状态。                  |

## 一次典型使用流程

1. 为代码仓库创建工作区。
2. 导入自动发现的编码 CLI，或创建一个专用智能体。
3. 把目标拆成任务并连接依赖关系。
4. 指派智能体或小队，然后开始执行。
5. 从看板、动态或实时图里跟进进度。
6. 审查结果、重试失败运行，或把重复流程保存为自动化。

Coordy 把任务状态与单次聊天分开保存。即使某个智能体会话已经结束，整个团队仍能从同一份计划继续工作。

## 快速开始

> [!NOTE]
> Coordy 目前从源码运行。你需要 Rust stable、Node.js 22 和 pnpm 9。

```bash
git clone https://github.com/alexj11324/Coordy.git
cd Coordy
corepack enable
pnpm install
bash scripts/dev.sh
```

首次启动时，Coordy 会启动本机 daemon、创建工作区，并自动发现 `PATH` 中兼容的 CLI。要执行真实任务，请至少安装一个受支持的编码智能体 CLI。

还没有安装编码智能体 CLI？可以在另一个终端启动内置 ACP 演示：

```bash
cargo run -p coordy -- acp-stub
```

## 智能体接入

Coordy 内置了 6 个原生 CLI 适配器。它们直接使用各工具自己的无头接口，并提供对应的启动参数、权限控制和事件解析。

### 内置原生适配器

| `PATH` 中的 CLI          | 接入方式                       |
| ------------------------ | ------------------------------ |
| `claude` / `claude-code` | Claude stream JSON             |
| `codex`                  | Codex `exec --json`            |
| `gemini`                 | Gemini CLI prompt mode         |
| `copilot`                | GitHub Copilot CLI prompt mode |
| `opencode`               | OpenCode `run`                 |
| `cursor-agent` / `agent` | Cursor print / stream mode     |

### ACP 智能体

上面的表格不是完整目录。Coordy 还会读取实时的 [Agent Client Protocol Registry](https://agentclientprotocol.com/get-started/registry)，并可导入提供 `npx`、`uvx` 或平台二进制启动命令的智能体。Registry 智能体通过 ACP 运行，并与内置适配器一起显示在 Harness 目录中。

Registry 会持续更新，因此 README 不硬编码完整智能体名单。运行其中的智能体可能需要对应的包运行时、账号或服务商凭据；模型访问可以在设置中使用你自己的服务商密钥进行配置。

## 本机优先

```text
Electron 应用  →  安全 preload  →  本机 IPC  →  coordyd  →  编码智能体 CLI
                                              ↘  SQLite
```

- `coordyd` 负责工作区状态和执行。
- 桌面端通过用户级 Unix socket 或 Windows named pipe 连接。
- 工作区数据与运行记录保存在本机 SQLite。
- API 密钥保存在权限为 `0600` 的私有文件中，不进入数据库。
- 智能体私有记忆只留在本机，不进入共享同步数据。

需要多人共享时，可以启用可选的 `coordy-server` 控制面；单人本机使用不需要它。

## 开发

启动完整桌面环境：

```bash
pnpm install
bash scripts/dev.sh
```

分别运行 daemon 与 CLI：

```bash
cargo run -p coordyd
cargo run -p coordy -- health
cargo run -p coordy -- inspect
```

运行主要质量检查：

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p xtask -- verify-protocol
cargo test --workspace
pnpm --filter @coordy/desktop test
pnpm --filter @coordy/desktop typecheck
pnpm --filter @coordy/desktop build
```

> [!TIP]
> GitHub Actions 只支持手动运行。需要远端构建时，请从 Actions 页面启动 **CI** 或 **CD** workflow。

## 仓库结构

```text
apps/desktop/                 Electron + React 桌面应用
bins/coordyd/                 本机 daemon
bins/coordy/                  health、inspect、workspace 与 ACP 演示 CLI
bins/coordy-server/           可选共享控制面
crates/coordy-kernel/         任务、智能体、权限、依赖图与调度
crates/coordy-harness/        CLI 发现与原生进程启动
crates/coordy-local-runtime/  SQLite、本机 IPC、密钥与执行
crates/coordy-protocol/       Rust 协议权威定义
packages/protocol-ts/         经过校验的 TypeScript 协议镜像
packages/ui/                  共享 UI 组件
docs/adr/                     架构决策
research/s0-validation/       已归档的任务漂移研究
```

产品路线见 [`TODO.md`](TODO.md)，架构设计见 [`docs/adr/`](docs/adr/)。
