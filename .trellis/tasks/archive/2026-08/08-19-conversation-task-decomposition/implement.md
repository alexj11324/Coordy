# Implementation plan

1. **Conversation plan contract and atomic apply**
   - Add versioned proposal/apply protocol types and stored proposal provenance.
   - Add strict parsing, revision, preflight, idempotency, and all-or-nothing
     kernel application tests.
   - Reuse existing task, parent, stage, assignment, and blocker owners.
2. **Chat plan preview and editing**
   - Decode proposal artifacts from chat run output and render an inline plan.
   - Add edit/add/delete/regenerate controls and explicit create-only versus
     confirm-and-start actions.
   - Route issue-detail decomposition into the same surface.
3. **Built-in planning skill and agent handoff**
   - Add the system-owned planning skill and relevant catalog context.
   - Inject it for chat planning without globally changing ordinary issue runs.
   - Verify compliant and malformed artifacts across fake harness output.
4. **Task orchestration and parent rollup**
   - Start only ready children, release later stages exactly once, and expose
     progress projections.
   - Enforce the approved automatic parent-completion rule.
5. Run focused tests after every child task, then full protocol, Rust, desktop,
   build, and installed-app runtime acceptance at 1280x840 and 720x520.
6. Replace the checked TODO items only after the matching runtime acceptance
   passes. Commit each verified child concern separately without staging
   `.local-specs/` or unrelated runtime work.

## Risky boundaries

- Protocol files currently overlap the unfinished coding-runtime task. Do not
  start child 1 until that task's protocol changes are committed or explicitly
  separated.
- Assignment currently has execution side effects. Bulk apply must park all
  children until the graph is complete.
- Chat events are provider-neutral; proposal parsing must not depend on one
  provider's proprietary tool-call format.

## Validation commands

- `cargo run -p xtask -- verify-protocol`
- `cargo test -p coordy-protocol`
- focused `coordy-kernel` invariant tests, then `cargo test --workspace`
- `pnpm --filter @coordy/desktop test`
- `pnpm --filter @coordy/desktop typecheck`
- `pnpm --filter @coordy/desktop build`
- real installed macOS chat decomposition and staged execution acceptance
