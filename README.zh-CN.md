# Coordy

Electron 桌面端 + 本机 Rust daemon。

产品路径：启动时自动扫描 PATH 和 [ACP Registry](https://agentclientprotocol.com/get-started/registry)，把本机已安装的 CLI 导入成可指派的队友，不必手填启动命令。在「开始」页填入你自己的 API 密钥（BYOK，0600 文件，不进数据库）。把任务指派给助手后它会立刻开工。本机没有 Codex/Claude 时，用 `coordy acp-stub` 先把链路跑通。

Python S0 研究工具已整块迁到 [`research/s0-validation/`](research/s0-validation/)。

开发：

```bash
cargo test --workspace
pnpm install
bash scripts/dev.sh
```
