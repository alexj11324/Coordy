# Design: runtime and agent flow

## Ownership

- `launch_state` is the readiness source of truth; `installed` is descriptive only.
- A single renderer projection owns label, tone, grouping, and selectability.
- `CreateAgent` accepts optional configuration fields and validates the complete command before inserting state; existing minimal callers remain wire-compatible through defaults.
- Harness preselection uses a URL query parameter so reload/deep-link behavior is deterministic, then falls back to a valid saved draft and finally the first selectable runtime.
- Registry refresh returns catalog plus freshness/error metadata without dropping the usable cache.
- Model discovery branches on concrete `protocol_family` and parsed command before provider-specific parsing.

## Rollback

Protocol and kernel changes land with renderer callers and tests in one child commit; no partial wire state is shipped.
