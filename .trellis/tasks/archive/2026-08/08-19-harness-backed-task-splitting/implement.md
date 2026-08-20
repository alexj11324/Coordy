# Implementation plan

1. Define the typed task-split RPC request/result in Rust and TypeScript protocol mirrors; remove the obsolete direct `CompleteDraft` surface used by the deleted creation flow.
2. Implement local-runtime authorization and assigned-agent resolution. Verify the agent's Harness is locally installed.
3. Add an advisory Harness executor that reuses the existing provider adapters in a temporary empty directory, forces safe Auto access, collects the final assistant message, and cleans up on success/failure.
4. Add the strict 2-5 title decoder and provider-independent fake-Harness tests for success, malformed output, non-zero exit, missing assignment, and missing installation.
5. Expose `suggestTaskSplit` through the Electron main/preload bridge with the existing trusted-sender validation.
6. Restore “建议拆分” in task detail. Use the current task assignee automatically, show progress/errors, display suggestions for review, and keep `addSubtask` as the only creation action.
7. Keep the adjacent fixes in the same verified product change: installed-only selection, direct agent-configuration route, no floating chat during creation, no API-key settings entry, concise creation copy, dynamic model discovery, and Multica icon assets/README.
8. Validate protocol parity, focused Rust/desktop tests, complete workspace tests, desktop typecheck/build, temporary unsigned macOS runtime screenshots, and diff hygiene; then sync `origin/main`, commit the isolated branch, push it, and open a PR.

## Validation commands

- `cargo test -p coordy-harness`
- `cargo test -p coordy-local-runtime`
- `cargo test -p coordy-protocol`
- `cargo run -p xtask -- verify-protocol`
- `pnpm --filter @coordy/desktop typecheck`
- `pnpm --filter @coordy/desktop test`
- `pnpm --filter @coordy/desktop build`
- `cargo test --workspace`
- `git diff --check`

## Review gates

- No suggestion path references `secretsStatus`, `completeDraft`, or the removed model-key UI.
- No advisory split can mutate the task repository or create a kernel Run.
- No uninstalled Registry entry is selectable or labeled as installed/available.
- User-visible features are not removed merely because an implementation dependency is replaced.
