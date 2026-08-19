# Implementation plan: whole-app flow repair program

1. Execute and verify `08-19-repair-runtime-agent-flows`; commit its completed concern.
2. Execute and verify `08-19-repair-core-product-flows`; commit its completed concern.
3. Execute and verify `08-19-repair-desktop-ipc-lifecycle`; commit its completed concern.
4. Execute `08-19-automate-desktop-flow-coverage` after behavior stabilizes; run the full matrix and real golden flow.
5. Re-read all three audit reports, map every confirmed finding to fixed/reclassified evidence, and run the parent acceptance gate.
6. Update relevant Trellis specs only for durable conventions actually established by the fixes.
7. Inspect `git status --short`, preserve unrelated work, and finish with scoped commits plus a concise residual-risk report.

## Parent validation gate

- `pnpm --filter @coordy/desktop typecheck`
- `pnpm --filter @coordy/desktop test` outside the Unix-socket-restricted sandbox
- `pnpm --filter @coordy/desktop build`
- Rust format, clippy, protocol verification, and workspace tests through the installed stable toolchain
- Automated Electron golden flow with isolated state
- Real macOS launch, navigation, close/reopen, and quit/cleanup acceptance
