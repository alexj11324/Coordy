Shared-contract sync tests live in `crates/coordy-control-plane/tests/sync.rs`.
Private memory must never appear in a sync batch; CI does not require PostgreSQL for that check.
