# Implementation plan

1. Create the flow inventory and map existing tests without overstating helper coverage.
2. Stabilize shared jsdom setup and the issue-dialog test.
3. Add route/redirect/bootstrap and mutation suites using the typed stateful bridge fake.
4. Extract/test retained main/preload handlers and prune only proven-dead IPC.
5. Add the Playwright Electron dependency/config and isolated golden flow.
6. Run the full suite repeatedly, typecheck/build, golden flow, and a real visual smoke; review and commit test infrastructure.
