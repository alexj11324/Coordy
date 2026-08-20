# Secure durable online team control plane

## Goal

Turn the experimental in-memory `coordy-server` into a durable, authenticated, tenant-isolated authority for online team workspaces.

## Requirements

- Verify Clerk session JWT signature, expiry, audience/authorized party, user, active Organization, and Organization role on every protected request.
- Map Clerk Organization to Coordy team tenant and Clerk user to a server-owned principal; never trust client-supplied membership, principal, or role.
- Apply shared mutations through the Coordy kernel/protocol boundary and persist canonical state plus an append-only audit/version log in SQLite WAL on one authoritative host.
- Use optimistic versions/idempotency keys so concurrent unrelated changes are preserved and stale writes are rejected rather than silently overwriting snapshots.
- Enforce owner/admin/member permissions server-side.
- Store only shared projections; reject private/principal/Agent memory, secrets, local paths, and host-local runtime data.
- Authorize explicitly shared attachment upload/download and avoid exposing server filesystem paths.

## Acceptance Criteria

- [ ] Missing, invalid, expired, wrong-audience, wrong-Organization, and insufficient-role tokens are rejected before kernel mutation.
- [ ] Two authorized members can read/write the same workspace; a non-member cannot discover it.
- [ ] State and audit history survive restart; duplicate idempotency keys do not duplicate effects.
- [ ] Concurrent mutation tests preserve unrelated updates and expose true conflicts.
- [ ] Private-memory and secret/path exfiltration fixtures are rejected.
- [ ] Rust format, clippy, protocol verification, workspace tests, and HTTP integration tests pass.
