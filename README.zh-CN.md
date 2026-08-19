# Coordy

Electron 桌面端 + 本机 Rust daemon。

产品路径：对照 Multica 的桌面体验，用 Coordy 自己的内核协议（`submit` / `view` / `watch`）重写，而不是克隆 Multica 源码。启动时扫描 PATH 上已安装的 CLI，并按各家**原生无头协议** spawn（Claude `stream-json`、Codex `exec --json`、Copilot `-p`、Cursor `--print` 等）。ACP 只用于 `coordy acp-stub` 以及仅存在于 [ACP Registry](https://agentclientprotocol.com/get-started/registry) 的智能体。在设置里填入你自己的 API 密钥（BYOK，0600 文件，不进数据库）。缺口见 [`TODO.md`](TODO.md)。本机没有 Codex/Claude 时，用 `coordy acp-stub` 先把链路跑通。

Python S0 研究工具已整块迁到 [`research/s0-validation/`](research/s0-validation/)。

开发：

```bash
cargo test --workspace
pnpm install
bash scripts/dev.sh
```
