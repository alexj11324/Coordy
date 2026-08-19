# Coordy implementation invariants

- Treat `.local-specs/` as private. Never stage or commit it.
- The product kernel is the only deep business entry: `submit` / `view` / `watch`.
- Electron must not implement authority, memory, contracts, or drift rules.
- Agent private memory never uploads. Sync batches contain only shared projections.
- Advisors produce prelabels and cannot commit kernel state.
- Engineering consequences require program-verified Git/test/tool evidence.
- Screening in `research/s0-validation` may emit only `STOP`, `PIVOT`, or `PROCEED_TO_CONFIRMATION`; never `GO`.
- shadcn primitives live in `packages/ui`. Do not add `packages/views` until a real second client exists.
- Do not create a shared abstraction without two current consumers.

## Product intent (Multica)

Coordy 要对齐 Multica 的**产品体验**：侧栏、标签页、任务/Issue、智能体、harness、设置，以及聊天、项目、自动化、小队、Skills、统计等用户能看见的能力。

这是**对照重写**，不是克隆：

- 不要整仓复制 Multica 源码、组件或它的 API / 数据模型。
- 协议只认 Coordy 自己的 `crates/coordy-protocol`（`submit` / `view` / `watch`）。缺字段就扩展这份协议，不要接入 Multica 协议。
- 用户**没有**反对做聊天、项目、自动化、小队、Skills、甘特图等功能。反对的是抄源码，不是做功能。
- 不要把「尚未实现」当成「不要做」。缺的能力记在 `TODO.md`，按用户当前请求实现。

## Scope and stopping rule

Apply instructions in this order:

1. The user's explicit current request.
2. The current phase's frozen acceptance criteria.
3. Data-safety invariants above.
4. Optional robustness and future extensibility.

Lower-priority concerns must not expand a higher-priority task. Implement the
smallest complete change that satisfies the frozen acceptance criteria, run the
matching real validation, and stop when those criteria pass.

Do not add automatic retries, compatibility layers, provider abstractions,
distributed recovery, migration frameworks, or production hardening unless a
failure on the current approved path demonstrates the need. A smoke test or
research probe must not be designed as a production service.

Review findings block the current task only when they show a reproducible
failure on the approved path that would make the present result unsafe,
incorrect, or unauditable. Record theoretical, future-deployment, or inactive-
path risks as follow-ups instead of expanding the current implementation.

If a proposed change would materially expand the approved scope, report the
evidence and ask before implementing it. Do not create a shared abstraction
without at least two current, concrete consumers.

## Cursor Cloud specific instructions

The product at the repo root is Electron + a local Rust daemon (`coordyd`).
There is no long-running database server or container to start. The Python S0
research harness lives in `research/s0-validation/` and is not the desktop
runtime.

Development commands match CI (`.github/workflows/ci.yml`) and the README:

- Install JS deps once with `pnpm install` (or `pnpm install --frozen-lockfile`).
- Rust: `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
  `cargo run -p xtask -- verify-protocol`, `cargo test --workspace`.
- Desktop: `pnpm --filter @coordy/desktop test` and
  `pnpm --filter @coordy/desktop typecheck`.
- Run the app: `bash scripts/dev.sh` (builds `coordyd` / `coordy`, then
  `pnpm --filter @coordy/desktop dev`). Linux cloud desktops should keep GPU
  off (`--disable-gpu --no-sandbox`) so the window does not exit after a flash.
- Optional CLI against the same daemon: `cargo run -p coordyd` and
  `cargo run -p coordy -- health`. Optional shared control plane:
  `cargo run -p coordy-server -- --bind 127.0.0.1:8787`.

Research-tree checks (not required for the desktop path), from
`research/s0-validation/`: `python -m pip install -e .`, `python -m pip check`,
`python -m compileall -q src`, `python -m unittest discover -s tests -v`, and
`node --check research/s0-validation/web/incident-review/app.js`.
