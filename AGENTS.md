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

Coordy 要对齐 Multica 的**产品体验**：侧栏、标签页、任务/Issue、智能体、运行时、设置，以及聊天、项目、自动化、小队、Skills、统计等用户能看见的能力。

这是**对照重写**，不是克隆：

- 不要整仓复制 Multica 源码、组件或它的 API / 数据模型。
- 协议只认 Coordy 自己的 `crates/coordy-protocol`（`submit` / `view` / `watch`）。缺字段就扩展这份协议，不要接入 Multica 协议。
- 用户**没有**反对做聊天、项目、自动化、小队、Skills、甘特图等功能。反对的是抄源码，不是做功能。
- 不要把「尚未实现」当成「不要做」。缺的能力记在 `TODO.md`，按用户当前请求实现。

## Scope

1. The user's explicit current request.
2. The current phase's frozen acceptance criteria.
3. Data-safety invariants above.
4. Optional robustness.
