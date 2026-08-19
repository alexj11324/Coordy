<div align="center">

<img src="assets/coordy-pixel-icon.svg" width="72" alt="Coordy">

# Coordy

### One workspace for all your coding agents

Plan work, assign it to agents, and follow every run from one desktop app.

[简体中文](README.zh-CN.md)

</div>

Coordy turns the coding agents already installed on your computer into a team you can manage. Create an issue, assign an agent, and watch the work move from start to review without juggling terminals.

## What you can do

- **Plan work** with issues, projects, boards, priorities, and dependencies.
- **Build an agent team** with reusable profiles, skills, squads, and automations.
- **Follow the work** through live runs, comments, activity, and review states.
- **Keep control** with local execution and data that stays on your machine.

## Bring your own agents

Coordy works with Claude Code, Codex, Cursor, GitHub Copilot, OpenCode, Gemini CLI, and other compatible coding agents. It discovers installed tools automatically and can launch supported ACP agents on demand.

## Run locally

> [!NOTE]
> Coordy currently runs from source. You need Rust stable, Node.js 22, pnpm 9, and at least one supported coding-agent CLI.

```bash
git clone https://github.com/alexj11324/Coordy.git
cd Coordy
corepack enable
pnpm install
bash scripts/dev.sh
```

Coordy starts the desktop app and its local daemon, then discovers the coding agents available on your computer.
