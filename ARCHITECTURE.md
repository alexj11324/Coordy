# Architecture

## Processes

- Electron renderer: React UI via `@coordy/ui`. No Node, no raw IPC.
- Electron preload: `window.coordy` whitelist only (`submit` / `view` / `subscribe` plus desktop capabilities).
- Electron main: windows, dialogs, spawn `coordyd`. No domain rules.
- `coordyd`: Unix socket (or Windows named pipe) RPC into `coordy-kernel`.
- `coordy-server`: optional shared control plane. Local single-player works without it.

## Kernel order

Authenticate → Authorize → Canonical state → Shared contracts → Dependencies → Workspace versions → Deterministic verification → Optional advisor (cannot commit) → Commit + outbox.

## Drift

Live compaction events snapshot canonical commitments. Working plans are compared with `missing|contradicted|stale_reactivated|preserved`. DIRECT suspects pause the run. Action gate runs before `atomic_apply`.

## Packages

Rust is the protocol source (`crates/coordy-protocol`). TypeScript mirror: `packages/protocol-ts`. Do not extract `packages/views` until a second web client exists.
