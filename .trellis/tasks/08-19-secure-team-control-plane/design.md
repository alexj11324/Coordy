# Design

## Authority model

Clerk is identity/membership authority; `coordy-server` is team-workspace business authority. The server verifies the Clerk session-token v2 bearer token, derives `{sub, o.id, o.rol}`, resolves a server-owned Coordy principal, then invokes the kernel. Client actor IDs are ignored for authorization. Protected team requests require an active session and a configured `azp`; pending sessions, legacy `org_id`/`org_role` claims, and missing authorized-party claims are rejected.

## Persistence

Use the existing single-host Rust server with SQLite WAL. Persist tenant/workspace metadata, canonical kernel state, monotonically increasing workspace version, idempotency records, audit entries, and attachment metadata. Serialize mutation transactions per workspace while allowing different workspaces concurrently.

## API

- public health/config discovery
- authenticated team/workspace list and provisioning
- authenticated protocol `submit`, `view`, and cursor-based `watch`
- authenticated attachment upload/download

Every response includes the workspace version. Mutations require an idempotency key and optional expected version. The server returns a typed conflict for stale incompatible writes.

## Data safety

The shared projection allowlist is schema-owned by `coordy-protocol`/kernel. Reject unknown private visibility and never persist provider credentials, local paths, process state, or private memory. Audit stores identifiers/actions, not token or secret bodies.
