# Implementation Plan

1. Add team workspace/session contracts to Rust and TypeScript protocol packages.
2. Add typed Electron main/preload HTTPS client with token refresh, tenant switching, and cursor watch.
3. Add local/team workspace descriptors and routing without changing local daemon semantics.
4. Implement team selection/onboarding and invite/join navigation from Clerk Organization state.
5. Route shared views/mutations and tenant-keyed query invalidation; add reconnect and conflict UI.
6. Integrate local Agent execution with approved shared status projection and privacy filters.
7. Add two-client integration, tenant-switch, reconnect, conflict, and data-exclusion tests; run desktop and Rust validation.

Rollback point: disabling the team endpoint leaves the local daemon route unchanged.
