# Implementation Plan

1. Define authenticated team API contracts and server-derived principal/role mapping.
2. Add Clerk JWKS JWT verification with cached key rotation and strict issuer/audience/authorized-party checks.
3. Replace in-memory snapshots with SQLite WAL repositories, migrations, per-workspace versions, idempotency, and audit.
4. Route authenticated submit/view/watch through server-owned kernel instances and persist successful transitions atomically.
5. Add allowlisted shared projection and authorized attachment storage.
6. Add adversarial auth, tenant-isolation, restart, concurrency, idempotency, and private-data rejection tests.
7. Run full Rust checks and local HTTP runtime smoke tests.

Rollback point: retain local-only `coordyd`; online server schema and APIs do not migrate local databases.
