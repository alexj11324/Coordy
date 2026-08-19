# Coordy

本机优先的编码智能体工作区。Electron 桌面把任务、聊天和自动化交给本地 Rust 守护进程 `coordyd`；真正干活的是你本机已安装的 CLI（Claude Code、Codex、Gemini 等）。

A local-first workspace for coding agents: an Electron app plus a Rust daemon. Agents run as the CLIs already on your `PATH`.

[简体中文](#简体中文) · [English](#english)

当前版本 **0.2.0** · 协议 `coordy-local-v1` · [Apache-2.0](LICENSE)

---

## 简体中文

Coordy 不是云端 Agent 平台，也不再是「检测长程任务漂移」的研究仓库。产品入口是桌面应用：侧栏、标签页、看板、智能体、Harness、设置。业务状态只经过内核的 `submit` / `view` / `watch`。

```text
Electron renderer  →  preload  →  Electron main  →  Unix socket / named pipe  →  coordyd
```

`coordyd` 不监听本机 HTTP。数据在本机 SQLite；模型密钥写成 `0600` 文件，不进数据库、不上传。

### 能做什么

桌面侧栏分三块：

- **个人**：收件箱、与智能体一对一聊天、我的任务
- **工作区**：任务看板 / 列表、项目、自动化、智能体、小队、统计
- **配置**：Harness、Skills、设置

已经可用的路径包括：

- 多工作区（创建 / 切换 / 离开 / 删除），成员角色 owner / admin / member
- Issue：标题、说明、状态（含 backlog）、优先级、截止日期、标签、附件、子事项、指派智能体 / 成员 / 小队 / 项目
- 评论与执行分开；`@智能体` 触发运行且不改负责人；失败后可按原 prompt 重试
- 启动时从 `PATH` 发现本机 CLI，按各家原生无头协议 spawn（不是统一 ACP 总线）
- 智能体身份：指令、harness、模型、思考强度、访问范围、并发上限、Skills 绑定、复制
- 工作区 Skills 库；自动化 runbook + 本机间隔调度（`every:30m` / `1h` / `1d`）
- 设置里粘贴自己的模型密钥（BYOK）；Agent Builder 和建议拆分依赖这份密钥

本机**明确不做**：云账号 / PAT、GitHub App、飞书 / Slack 等 IM、公网 Webhook、甘特图。缺口清单见 [`TODO.md`](TODO.md)。

常用快捷键：`C` 新建任务，`Mod+K` 搜索，`Mod+J` 悬浮聊天，`Mod+B` 收起侧栏。

### 本机 Harness

Coordy 启动时扫描 `PATH`，对已安装的 CLI 使用**该 CLI 自己的**无头协议：

| 发现的二进制 | 协议 |
| --- | --- |
| `claude` / `claude-code` | Claude `stream-json` |
| `codex` | Codex `exec --json` |
| `gemini` | Gemini CLI `-p` |
| `copilot` | Copilot `-p` |
| `opencode` | OpenCode `run` |
| `cursor-agent` / `agent` | Cursor `--print` / stream-json |

[ACP](https://agentclientprotocol.com/get-started/registry) 只用于 `coordy acp-stub`，以及只存在于 ACP Registry、本机没有对应 CLI 的智能体。本机没装 Codex / Claude 时，用 stub 做演示：

```bash
cargo run -p coordy -- acp-stub
```

### 开发

需要 **Rust stable**（含 rustfmt / clippy）、**Node 22**、**pnpm 9**。

```bash
pnpm install
bash scripts/dev.sh
```

`scripts/dev.sh` 会先编译 `coordyd` 和 `coordy`，再启动桌面。Linux 云桌面默认关掉 GPU（`--disable-gpu --no-sandbox`），避免窗口闪一下就退出。

只跑守护进程和 CLI（与桌面共用同一套 socket / token）：

```bash
cargo run -p coordyd
cargo run -p coordy -- health
cargo run -p coordy -- inspect
```

可选共享控制面（单人本机不需要）：

```bash
cargo run -p coordy-server -- --bind 127.0.0.1:8787
```

默认数据目录是平台 data dir 下的 `coordy/`（Linux 上多为 `~/.local/share/coordy`）。Socket 走 `XDG_RUNTIME_DIR`（Unix）或 named pipe（Windows），token 文件权限 `0600`。

### 测试（与 CI 对齐）

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p xtask -- verify-protocol
cargo test --workspace
pnpm --filter @coordy/desktop test
pnpm --filter @coordy/desktop typecheck
```

根目录 `pnpm test` / `pnpm typecheck` 走 Turbo。协议以 Rust `crates/coordy-protocol` 为准，`packages/protocol-ts` 是校验过的镜像。

### 仓库结构

```text
apps/desktop/                 Electron（React + electron-vite）
bins/coordyd/                 本机守护进程
bins/coordy/                  CLI：health / inspect / workspace / acp-stub
bins/coordy-server/           可选控制面
crates/coordy-protocol/       协议 DTO
crates/coordy-kernel/         内核（权威、记忆、契约、漂移门）
crates/coordy-harness/        CLI 发现与原生 spawn
crates/coordy-local-runtime/  SQLite、socket、密钥、执行
crates/coordy-advisor/        顾问预标注，不能提交内核状态
packages/ui/                  shadcn 原语
packages/protocol-ts/         协议 TypeScript 镜像
docs/adr/                     架构决策
research/s0-validation/       已归档的 S0 研究管线（不是运行时）
```

内核里还有记忆、契约、授权委托、依赖边、compaction 冲突等对象；它们不是侧栏里的「对照产品导航」，不要把它们理解成未完成的主功能。

实现约束见 [`AGENTS.md`](AGENTS.md)，贡献说明见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。不要提交 `.local-specs/` 或 `apps/desktop/resources/native/` 下的本机二进制。

### 已归档的研究代码

[`research/s0-validation/`](research/s0-validation/) 是冻结的 Python 实验：用历史会话评估 compaction 之后的任务漂移检测。它不是桌面运行时，筛选结论只能是 `STOP` / `PIVOT` / `PROCEED_TO_CONFIRMATION`，不会发出 `GO`。

---

## English

Coordy is a **local-first desktop** for coordinating coding agents on issues, chats, projects, automations, and squads. The UI is Electron; authority lives in `coordyd`. The daemon talks to whatever CLIs you already installed, using each vendor’s native headless protocol.

This repository is no longer a research-only harness for long-horizon drift detection. That Python pipeline remains under [`research/s0-validation/`](research/s0-validation/) and is archived.

### Architecture

```text
Electron renderer  →  preload  →  Electron main  →  Unix socket / named pipe  →  coordyd
```

External callers may use only `submit`, `view`, and `watch` (`crates/coordy-protocol`). Electron does not implement authority, memory, contracts, or drift rules. Agent private memory never syncs. Model API keys are BYOK files mode `0600`, never SQLite.

On launch Coordy discovers CLIs on `PATH`: Claude Code (`stream-json`), Codex (`exec --json`), Gemini, Copilot, OpenCode, Cursor. ACP is used only for `coordy acp-stub` and agents that exist solely in the [ACP Registry](https://agentclientprotocol.com/get-started/registry).

### Develop

Requires Rust stable (rustfmt + clippy), Node 22, and pnpm 9.

```bash
pnpm install
bash scripts/dev.sh          # build coordyd + coordy, then start the desktop
```

```bash
cargo run -p coordyd
cargo run -p coordy -- health
cargo run -p coordy-server -- --bind 127.0.0.1:8787   # optional shared control plane
```

CI-equivalent checks:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p xtask -- verify-protocol
cargo test --workspace
pnpm --filter @coordy/desktop test
pnpm --filter @coordy/desktop typecheck
```

Product gaps versus the intended desktop surface: [`TODO.md`](TODO.md). Invariants: [`AGENTS.md`](AGENTS.md). ADRs: [`docs/adr/`](docs/adr/).
