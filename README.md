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

## Supported coding agents

Coordy supports 24 first-class coding agents, using the tools already installed and signed in on your computer.

<table>
  <tr>
    <td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/claude.svg" width="32" alt=""><br>Claude Code</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/codex.svg" width="32" alt=""><br>OpenAI Codex</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/cursor.svg" width="32" alt=""><br>Cursor Agent</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/copilot.svg" width="32" alt=""><br>GitHub Copilot CLI</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/opencode.svg" width="32" alt=""><br>OpenCode</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/openclaw.svg" width="32" alt=""><br>OpenClaw</td>
  </tr><tr>
    <td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/hermes.webp" width="32" alt=""><br>Hermes</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/pi.svg" width="32" alt=""><br>Pi</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/antigravity.png" width="32" alt=""><br>Antigravity</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/codebuddy.svg" width="32" alt=""><br>CodeBuddy</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/deveco.png" width="32" alt=""><br>DevEco Code</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/grok.svg" width="32" alt=""><br>Grok</td>
  </tr><tr>
    <td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/kimi.svg" width="32" alt=""><br>Kimi</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/kiro.svg" width="32" alt=""><br>Kiro CLI</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/qoder.svg" width="32" alt=""><br>Qoder CLI</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/qoderclicn.svg" width="32" alt=""><br>Qoder CN</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/qwen.svg" width="32" alt=""><br>Qwen Code</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/qwenpaw.svg" width="32" alt=""><br>QwenPaw</td>
  </tr><tr>
    <td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/reasonix.svg" width="32" alt=""><br>Reasonix</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/traecli.png" width="32" alt=""><br>Trae CLI</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/dsh.svg" width="32" alt=""><br>DeepSeek Harness</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/omp.svg" width="32" alt=""><br>Oh-My-Pi</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/mcode.svg" width="32" alt=""><br>MiniMax Code</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/gemini.svg" width="32" alt=""><br>Gemini CLI</td>
  </tr>
</table>

Compatible ACP agents can also be launched on demand.

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
