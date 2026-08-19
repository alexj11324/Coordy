<div align="center">

<img src="assets/coordy-c-icon.svg" width="72" alt="Coordy">

# Coordy

### 把所有编码智能体放进一个工作区

规划任务、分派智能体，并在一个桌面应用里掌握每一次执行。

[English](README.md)

</div>

Coordy 把你电脑上已经安装的编码智能体变成一支可以管理的团队。创建任务、交给合适的智能体，然后直接看着工作从开始推进到审查，不再来回切换终端。

## 你可以做什么

- **规划工作**：用任务、项目、看板、优先级和依赖组织目标。
- **组建团队**：创建可复用的智能体、Skills、小队和自动化。
- **跟进执行**：实时查看运行、评论、动态和审查状态。
- **保持掌控**：任务在本机执行，数据保留在自己的电脑上。

## 支持的编码智能体

Coordy 支持 23 个一等编码智能体，直接使用你电脑上已经安装并登录的工具。

<table>
  <tr>
    <td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/claude.svg" width="32" alt=""><br>Claude Code</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/codex.svg" width="32" alt=""><br>OpenAI Codex</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/cursor.svg" width="32" alt=""><br>Cursor Agent</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/copilot.svg" width="32" alt=""><br>GitHub Copilot CLI</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/opencode.svg" width="32" alt=""><br>OpenCode</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/openclaw.svg" width="32" alt=""><br>OpenClaw</td>
  </tr><tr>
    <td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/hermes.webp" width="32" alt=""><br>Hermes Agent</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/pi.svg" width="32" alt=""><br>Pi</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/antigravity.png" width="32" alt=""><br>Antigravity CLI</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/codebuddy.svg" width="32" alt=""><br>CodeBuddy</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/deveco.png" width="32" alt=""><br>DevEco Code</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/grok.svg" width="32" alt=""><br>Grok Build</td>
  </tr><tr>
    <td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/kimi.svg" width="32" alt=""><br>Kimi Code</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/kiro.svg" width="32" alt=""><br>Kiro CLI</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/qoder.svg" width="32" alt=""><br>Qoder</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/qoderclicn.svg" width="32" alt=""><br>Qoder CLI CN</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/qwen.svg" width="32" alt=""><br>Qwen Code</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/qwenpaw.svg" width="32" alt=""><br>QwenPaw</td>
  </tr><tr>
    <td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/reasonix.svg" width="32" alt=""><br>Reasonix</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/traecli.png" width="32" alt=""><br>Trae CLI</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/dsh.svg" width="32" alt=""><br>DeepSeek Harness</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/omp.svg" width="32" alt=""><br>Oh My Pi</td><td align="center"><img src="apps/desktop/src/renderer/src/assets/provider-icons/mcode.svg" width="32" alt=""><br>MiniMax Code</td>
  </tr>
</table>

其他兼容的 ACP 智能体也可以按需启动。

## 本机运行

> [!NOTE]
> Coordy 目前从源码运行。你需要 Rust stable、Node.js 22、pnpm 9，以及至少一个受支持的编码智能体 CLI。

```bash
git clone https://github.com/alexj11324/Coordy.git
cd Coordy
corepack enable
pnpm install
bash scripts/dev.sh
```

Coordy 会启动桌面应用和本机 daemon，并自动发现电脑上可用的编码智能体。
