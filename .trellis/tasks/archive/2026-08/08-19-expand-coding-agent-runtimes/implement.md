# Implementation plan

1. Add focused red tests for catalog visibility, label removal, icon fallback, and the three requested provider launch contracts.
2. Derive and review the full 23-runtime Multica launch/protocol matrix directly from its current repository.
3. Extend built-in discovery and protocol families for every runtime in that matrix, with exact fixed arguments and fake-process contracts.
4. Add the minimal ACP auth negotiation needed by agents that explicitly advertise authentication.
5. Expose the complete launchable catalog to the picker and simplify its rows to icon plus name.
6. Add complete provider icon coverage without copying Multica source or assets.
7. Run focused and full Rust/desktop verification, including a schema-enforced assertion that all 23 identities are covered exactly once.
8. Build, sign, install, and visually exercise the real macOS app at both acceptance sizes.
