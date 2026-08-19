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

它直接使用电脑上已经安装并登录的编码智能体 CLI。项目与执行记录都保留在本机。

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

Coordy 内置完整的 Multica first-class harness 目录，并额外支持 Gemini CLI。每项接入都使用对应的原生或 ACP 协议；只要 harness 提供模型发现能力，模型选择器就会读取本机当前目录，不再展示 Coordy 自己猜测的型号。

### First-class harness

<table>
  <tr>
    <td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/claude.svg" width="32"><br>Claude Code</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/codebuddy.svg" width="32"><br>CodeBuddy</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/codex.svg" width="32"><br>Codex</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/copilot.svg" width="32"><br>Copilot</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/opencode.svg" width="32"><br>OpenCode</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/deveco.png" width="32"><br>DevEco</td>
  </tr><tr>
    <td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/openclaw.svg" width="32"><br>OpenClaw</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/hermes.webp" width="32"><br>Hermes</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/pi.svg" width="32"><br>Pi</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/omp.svg" width="32"><br>OMP</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/cursor.svg" width="32"><br>Cursor</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/kimi.svg" width="32"><br>Kimi</td>
  </tr><tr>
    <td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/reasonix.svg" width="32"><br>Reasonix</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/dsh.svg" width="32"><br>DSH</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/kiro.svg" width="32"><br>Kiro</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/antigravity.png" width="32"><br>Antigravity</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/qoder.svg" width="32"><br>Qoder</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/qoderclicn.svg" width="32"><br>Qoder CN</td>
  </tr><tr>
    <td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/traecli.png" width="32"><br>TRAE</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/grok.svg" width="32"><br>Grok</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/qwen.svg" width="32"><br>Qwen</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/qwenpaw.svg" width="32"><br>QwenPaw</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/mcode.svg" width="32"><br>MCode</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/gemini.svg" width="32"><br>Gemini</td>
  </tr>
</table>

### ACP 智能体

Coordy 会读取实时的 [Agent Client Protocol Registry](https://agentclientprotocol.com/get-started/registry)。Registry 内容会变化，因此不把某次抓取的数量写成固定上限。只有在 `PATH` 中找到真实可执行文件的工具才显示“已安装”；其他项目统一显示“未安装”并禁止选择。Registry 里有名字，不等于这台电脑已经安装。

|                                                                                                                          | 智能体      |                                                                                                                            | 智能体         |
| :----------------------------------------------------------------------------------------------------------------------: | ----------- | :------------------------------------------------------------------------------------------------------------------------: | -------------- |
| <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/agoragentic-acp.svg" width="24" alt="Agoragentic 图标"> | Agoragentic |          <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/amp-acp.svg" width="24" alt="Amp 图标">          | Amp            |
|      <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/auggie.svg" width="24" alt="Auggie CLI 图标">      | Auggie CLI  |    <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/autohand.svg" width="24" alt="Autohand Code 图标">     | Autohand Code  |
|         <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/cline.svg" width="24" alt="Cline 图标">         | Cline       | <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/codebuddy-code.svg" width="24" alt="Codebuddy Code 图标"> | Codebuddy Code |
|   <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/cortex-code.svg" width="24" alt="Cortex Code 图标">   | Cortex Code |   <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/corust-agent.svg" width="24" alt="Corust Agent 图标">   | Corust Agent   |
|      <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/crow-cli.svg" width="24" alt="crow-cli 图标">      | crow-cli    |     <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/deepagents.svg" width="24" alt="DeepAgents 图标">     | DeepAgents     |
|         <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/devin.svg" width="24" alt="Devin 图标">         | Devin       |        <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/dimcode.svg" width="24" alt="DimCode 图标">        | DimCode        |
|         <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/dirac.svg" width="24" alt="Dirac 图标">         | Dirac       |  <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/factory-droid.svg" width="24" alt="Factory Droid 图标">  | Factory Droid  |
|    <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/fast-agent.svg" width="24" alt="fast-agent 图标">    | fast-agent  |    <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/glm-acp-agent.svg" width="24" alt="GLM Agent 图标">    | GLM Agent      |
|         <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/goose.svg" width="24" alt="goose 图标">         | goose       |     <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/grok-build.svg" width="24" alt="Grok Build 图标">     | Grok Build     |
|          <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/harn.svg" width="24" alt="Harn 图标">          | Harn        |          <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/junie.svg" width="24" alt="Junie 图标">          | Junie          |
|          <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/kilo.svg" width="24" alt="Kilo 图标">          | Kilo        |         <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/kimi.svg" width="24" alt="Kimi CLI 图标">         | Kimi CLI       |
|   <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/minion-code.svg" width="24" alt="Minion Code 图标">   | Minion Code |   <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/mistral-vibe.svg" width="24" alt="Mistral Vibe 图标">   | Mistral Vibe   |
|          <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/nova.svg" width="24" alt="Nova 图标">          | Nova        |         <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/pi-acp.svg" width="24" alt="pi ACP 图标">         | pi ACP         |
|      <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/poolside.svg" width="24" alt="Poolside 图标">      | Poolside    |        <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/qoder.svg" width="24" alt="Qoder CLI 图标">        | Qoder CLI      |
|     <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/qwen-code.svg" width="24" alt="Qwen Code 图标">     | Qwen Code   |       <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/sigit.svg" width="24" alt="siGit Code 图标">        | siGit Code     |
|       <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/stakpak.svg" width="24" alt="Stakpak 图标">       | Stakpak     |        <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/vtcode.svg" width="24" alt="VT Code 图标">         | VT Code        |

Registry 智能体会与原生适配器一起显示在 Harness 目录中。安装并登录对应 Harness 后刷新，即可创建智能体；Coordy 不再单独要求配置模型 API 密钥。

## 本机优先

```text
Electron 应用  →  安全 preload  →  本机 IPC  →  coordyd  →  编码智能体 CLI
                                              ↘  SQLite
```

- `coordyd` 负责工作区状态和执行。
- 桌面端通过用户级 Unix socket 或 Windows named pipe 连接。
- 工作区数据与运行记录保存在本机 SQLite。
- 服务商登录与凭据由各 Harness 自己管理，Coordy 不要求额外填写模型 API 密钥。
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
