# Implementation plan

1. Reconcile current uncommitted runtime/create-agent diff with the active readiness contract.
2. Add failing readiness, Harness-preselection, atomic-create, refresh-cache, and concrete-transport tests.
3. Implement the shared readiness projection and URL preselection.
4. Extend Rust/TypeScript protocol and kernel for atomic configured creation; remove the two-command create path.
5. Fix registry refresh fallback and concrete-transport model discovery.
6. Align README text and focused tests.
7. Run protocol verification, affected Rust tests, desktop tests/typecheck/build, inspect the diff, review, and commit only this child concern.
