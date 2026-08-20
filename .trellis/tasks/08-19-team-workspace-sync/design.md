# Design

## Transport boundary

Extend the preload bridge with typed team operations, not generic fetch/IPC. The main process owns the HTTPS client and connection/watch lifecycle. The renderer supplies an in-memory short-lived Clerk token through a narrow session update call; neither side persists or logs it.

## Workspace routing

A workspace descriptor has `mode: local | team`. Existing local calls retain the daemon path. Team calls route to `coordy-server` and include the selected Organization/workspace plus idempotency/version metadata. Query caches are tenant-keyed and cleared synchronously on Organization/workspace change.

## Live updates and conflicts

Watch uses a monotonic server cursor. Reconnect resumes from the last applied cursor. Mutations update local UI only after server acceptance; version conflicts refetch canonical state and show a recoverable conflict rather than overwriting.

## Agent boundary

Agents and harnesses execute locally. Team tasks may trigger a local Agent only on the initiating/assigned connected client. Shared status/output is submitted as authorized shared commands; private memory, prompts marked private, credentials, local paths, and raw process details never upload.
