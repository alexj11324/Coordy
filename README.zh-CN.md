<div align="center">

<img src="assets/coordy-pixel-icon.svg" width="72" alt="Coordy">

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

## 使用你自己的智能体

Coordy 支持 Claude Code、Codex、Cursor、GitHub Copilot、OpenCode、Gemini CLI 以及其他兼容的编码智能体。它会自动发现本机已经安装的工具，也可以按需启动受支持的 ACP 智能体。

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
