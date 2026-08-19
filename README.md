<div align="center">

# Coordy

### A local command center for coding agents

Plan work, delegate issues, coordinate agent teams, and follow every run from one desktop workspace.

[简体中文](README.zh-CN.md) · [Get started](#get-started) · [Features](#features) · [Development](#development)

![Version](https://img.shields.io/badge/version-0.2.0-6d5dfc?style=flat-square)
![Rust](https://img.shields.io/badge/core-Rust-dea584?style=flat-square&logo=rust)
![Electron](https://img.shields.io/badge/desktop-Electron-47848f?style=flat-square&logo=electron)
![Local first](https://img.shields.io/badge/data-local--first-16a34a?style=flat-square)

</div>

Coordy brings your coding agents into one organized workspace. Create issues, assign the right agent, connect dependencies, automate recurring work, and see what is running without juggling terminals and disconnected chat sessions.

It works with the agent CLIs already installed on your computer—including Claude Code, Codex, Gemini CLI, GitHub Copilot, OpenCode, and Cursor. Your projects, execution history, and credentials stay on your machine.

## Features

|                         | What you can do                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Issues and projects** | Plan work on a board or list, add priorities, due dates, labels, attachments, subtasks, and project context.           |
| **Agent workspace**     | Create reusable agent profiles with instructions, models, skills, access rules, and concurrency limits.                |
| **Agent teams**         | Assign work to individual agents or squads, choose a conductor, and let ready tasks move through the dependency graph. |
| **Live execution**      | Follow runs, comments, retries, tool activity, inbox updates, and graph changes as they happen.                        |
| **Automations**         | Turn runbooks into scheduled or on-demand work using local agents.                                                     |
| **GitHub context**      | Sync pull requests, checks, and merge status through your local `gh` CLI.                                              |

## A typical workflow

1. Create a workspace for your repository.
2. Import a discovered coding CLI or create a specialized agent.
3. Break the goal into issues and connect their dependencies.
4. Assign agents or a squad and start the work.
5. Watch progress from the board, activity feed, or live graph.
6. Review the result, retry a failed run, or turn a repeatable process into an automation.

Coordy keeps task state separate from chat history, so the team can continue from the same plan even when individual agent sessions end.

## Get started

> [!NOTE]
> Coordy currently runs from source. You need Rust stable, Node.js 22, and pnpm 9.

```bash
git clone https://github.com/alexj11324/Coordy.git
cd Coordy
corepack enable
pnpm install
bash scripts/dev.sh
```

On first launch, Coordy starts its local daemon, creates a workspace, and discovers compatible CLIs on your `PATH`. Install at least one supported coding-agent CLI to run real work.

No agent CLI installed yet? Start the built-in ACP demo in another terminal:

```bash
cargo run -p coordy -- acp-stub
```

## Agent integrations

Coordy supports 38 coding agents today: six through native CLI adapters and 32 through ACP. Native integrations use each tool's own headless interface and provide tool-specific launch flags, permissions, and event parsing.

### Built-in native adapters

<table>
  <tr>
    <td align="center"><img src="https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg" width="36" alt="Claude Code icon"><br><strong>Claude Code</strong><br><sub><code>claude</code> · stream JSON</sub></td>
    <td align="center"><img src="https://cdn.agentclientprotocol.com/registry/v1/latest/codex-acp.svg" width="36" alt="Codex icon"><br><strong>Codex</strong><br><sub><code>codex exec --json</code></sub></td>
    <td align="center"><img src="https://cdn.agentclientprotocol.com/registry/v1/latest/gemini.svg" width="36" alt="Gemini CLI icon"><br><strong>Gemini CLI</strong><br><sub><code>gemini -p</code></sub></td>
  </tr>
  <tr>
    <td align="center"><img src="https://cdn.agentclientprotocol.com/registry/v1/latest/github-copilot-cli.svg" width="36" alt="GitHub Copilot icon"><br><strong>GitHub Copilot</strong><br><sub><code>copilot</code> · JSON</sub></td>
    <td align="center"><img src="https://cdn.agentclientprotocol.com/registry/v1/latest/opencode.svg" width="36" alt="OpenCode icon"><br><strong>OpenCode</strong><br><sub><code>opencode run</code></sub></td>
    <td align="center"><img src="https://cdn.agentclientprotocol.com/registry/v1/latest/cursor.svg" width="36" alt="Cursor icon"><br><strong>Cursor</strong><br><sub><code>cursor-agent</code> · stream JSON</sub></td>
  </tr>
</table>

### ACP agents

Coordy reads the live [Agent Client Protocol Registry](https://agentclientprotocol.com/get-started/registry) and imports agents that provide an `npx`, `uvx`, or platform binary launch command. The current registry includes the six agents above plus these 32 ACP integrations:

|                                                                                                                          | Agent       |                                                                                                                            | Agent          |
| :----------------------------------------------------------------------------------------------------------------------: | ----------- | :------------------------------------------------------------------------------------------------------------------------: | -------------- |
| <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/agoragentic-acp.svg" width="24" alt="Agoragentic icon"> | Agoragentic |          <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/amp-acp.svg" width="24" alt="Amp icon">          | Amp            |
|      <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/auggie.svg" width="24" alt="Auggie CLI icon">      | Auggie CLI  |    <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/autohand.svg" width="24" alt="Autohand Code icon">     | Autohand Code  |
|         <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/cline.svg" width="24" alt="Cline icon">         | Cline       | <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/codebuddy-code.svg" width="24" alt="Codebuddy Code icon"> | Codebuddy Code |
|   <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/cortex-code.svg" width="24" alt="Cortex Code icon">   | Cortex Code |   <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/corust-agent.svg" width="24" alt="Corust Agent icon">   | Corust Agent   |
|      <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/crow-cli.svg" width="24" alt="crow-cli icon">      | crow-cli    |     <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/deepagents.svg" width="24" alt="DeepAgents icon">     | DeepAgents     |
|         <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/devin.svg" width="24" alt="Devin icon">         | Devin       |        <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/dimcode.svg" width="24" alt="DimCode icon">        | DimCode        |
|         <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/dirac.svg" width="24" alt="Dirac icon">         | Dirac       |  <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/factory-droid.svg" width="24" alt="Factory Droid icon">  | Factory Droid  |
|    <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/fast-agent.svg" width="24" alt="fast-agent icon">    | fast-agent  |    <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/glm-acp-agent.svg" width="24" alt="GLM Agent icon">    | GLM Agent      |
|         <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/goose.svg" width="24" alt="goose icon">         | goose       |     <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/grok-build.svg" width="24" alt="Grok Build icon">     | Grok Build     |
|          <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/harn.svg" width="24" alt="Harn icon">          | Harn        |          <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/junie.svg" width="24" alt="Junie icon">          | Junie          |
|          <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/kilo.svg" width="24" alt="Kilo icon">          | Kilo        |         <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/kimi.svg" width="24" alt="Kimi CLI icon">         | Kimi CLI       |
|   <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/minion-code.svg" width="24" alt="Minion Code icon">   | Minion Code |   <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/mistral-vibe.svg" width="24" alt="Mistral Vibe icon">   | Mistral Vibe   |
|          <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/nova.svg" width="24" alt="Nova icon">          | Nova        |         <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/pi-acp.svg" width="24" alt="pi ACP icon">         | pi ACP         |
|      <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/poolside.svg" width="24" alt="Poolside icon">      | Poolside    |        <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/qoder.svg" width="24" alt="Qoder CLI icon">        | Qoder CLI      |
|     <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/qwen-code.svg" width="24" alt="Qwen Code icon">     | Qwen Code   |       <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/sigit.svg" width="24" alt="siGit Code icon">        | siGit Code     |
|       <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/stakpak.svg" width="24" alt="Stakpak icon">       | Stakpak     |        <img src="https://cdn.agentclientprotocol.com/registry/v1/latest/vtcode.svg" width="24" alt="VT Code icon">         | VT Code        |

Registry agents appear alongside native adapters in the Harness catalog. Running one may require its package runtime, account, or provider credentials; model access can be configured in Settings with your own provider key.

## Local by design

```text
Electron app  →  secure preload  →  local IPC  →  coordyd  →  agent CLI
                                              ↘  SQLite
```

- `coordyd` owns workspace state and execution.
- The desktop connects through a user-scoped Unix socket or Windows named pipe.
- Workspace data and run history live in local SQLite.
- API keys are stored in a private `0600` file, never in the database.
- Private agent memory stays local and is excluded from shared sync data.

The optional `coordy-server` binary provides a shared control plane when you need one; a single-user desktop setup does not require it.

## Development

Start the full desktop stack:

```bash
pnpm install
bash scripts/dev.sh
```

Run the daemon and CLI separately:

```bash
cargo run -p coordyd
cargo run -p coordy -- health
cargo run -p coordy -- inspect
```

Run the main quality checks:

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
> GitHub Actions are manual-only. Run the **CI** or **CD** workflow from the Actions tab when you want a remote build.

## Repository map

```text
apps/desktop/                 Electron + React desktop app
bins/coordyd/                 Local daemon
bins/coordy/                  Health, inspect, workspace, and ACP demo CLI
bins/coordy-server/           Optional shared control plane
crates/coordy-kernel/         Tasks, agents, permissions, graph, and scheduling
crates/coordy-harness/        CLI discovery and native process launch
crates/coordy-local-runtime/  SQLite, local IPC, secrets, and execution
crates/coordy-protocol/       Rust protocol source of truth
packages/protocol-ts/         Verified TypeScript protocol mirror
packages/ui/                  Shared UI components
docs/adr/                     Architecture decisions
research/s0-validation/       Archived task-drift research
```

See [`TODO.md`](TODO.md) for the product roadmap and [`docs/adr/`](docs/adr/) for the architectural decisions behind Coordy.
