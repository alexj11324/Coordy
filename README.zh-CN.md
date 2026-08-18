# Coordy

Electron 桌面端 + 本机 Rust daemon。

产品路径：在「开始」页填入你自己的 API 密钥（BYOK，0600 文件，不进数据库），助手走 [ACP](https://agentclientprotocol.com/) stdio 会话。本机没有 Codex/Claude 时，用 `coordy acp-stub` 先把链路跑通。

Python S0 研究工具已整块迁到 [`research/s0-validation/`](research/s0-validation/)。

开发：

```bash
cargo test --workspace
pnpm install
bash scripts/dev.sh
```
