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

## Scope

1. The user's explicit current request.
2. The current phase's frozen acceptance criteria.
3. Data-safety invariants above.
4. Optional robustness.
