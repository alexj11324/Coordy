# Coordy

Electron desktop + local Rust daemon for coordinating agents, authority, memory, shared contracts, and compaction drift gates.

```text
Electron renderer  →  preload bridge  →  Electron main  →  Unix socket / named pipe  →  coordyd (Rust kernel)
```

The Python S0 research harness is archived at [`research/s0-validation/`](research/s0-validation/).

Product path: rewrite Multica’s desktop experience on Coordy’s own kernel protocol (`submit` / `view` / `watch`) — do not clone Multica source. On launch, Coordy discovers ACP agents from PATH plus the [ACP Registry](https://agentclientprotocol.com/get-started/registry). Paste your own API key in Settings (BYOK, 0600 file, never SQLite). Gaps vs Multica: [`TODO.md`](TODO.md). If Codex/Claude is not installed, `coordy acp-stub` is the demo agent.

## Develop

```bash
cargo test --workspace
pnpm install
pnpm test
pnpm typecheck
bash scripts/dev.sh
```

CLI talks to the same daemon:

```bash
cargo run -p coordyd
cargo run -p coordy -- health
```

Optional shared control plane:

```bash
cargo run -p coordy-server -- --bind 127.0.0.1:8787
```

## Invariants

- Kernel is the only deep business entry: `submit` / `view` / `watch`
- Agent private memory never syncs
- Advisor assessments cannot commit state
- Screening research decisions never emit `GO`
