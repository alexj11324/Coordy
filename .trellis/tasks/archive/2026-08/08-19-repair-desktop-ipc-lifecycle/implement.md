# Implementation plan

1. Read the Apple platform runtime rules before launching the macOS app.
2. Add failing hostile-path, concurrent delayed-RPC/poller, child-exit/restart, lifecycle, and single-build tests.
3. Implement argv terminal launch and input validation.
4. Separate subscription transport and implement bounded child restart plus idempotent lifecycle cleanup.
5. Remove duplicate dev build ownership.
6. Run focused/full desktop checks and a real macOS close/reopen/quit acceptance, review, and commit this concern.
