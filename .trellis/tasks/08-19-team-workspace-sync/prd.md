# Shared team workspace sync and desktop collaboration

## Goal

Connect authenticated desktop clients to canonical team workspaces while preserving the existing local daemon path and private/local data boundaries.

## Requirements

- Workspace switching clearly distinguishes local workspaces from Clerk Organization team workspaces.
- Local workspaces continue using local `coordyd`; team workspaces use authenticated server `submit/view/watch` through a typed main-process client.
- Team state covers the shared product entities specified by the parent task and updates live across clients.
- Short-lived Clerk tokens stay in memory, refresh safely, are never logged, and are never accepted as proof without server verification.
- Reconnect resumes from a server cursor/version; offline team mutations are not silently treated as committed.
- Local Agent execution remains available. Private Agent context, local credentials, repository paths, and process details stay local; only approved shared task/run projections are published.

## Acceptance Criteria

- [ ] A signed-out user can create/use local workspaces but cannot enter a team workspace.
- [ ] Two team members see shared projects/tasks/comments and subsequent updates without restart.
- [ ] Organization switching cannot leak cached data from the prior team.
- [ ] Disconnect/reconnect resumes updates without duplicates; conflicts are visible and recoverable.
- [ ] Local Agent collaboration remains usable and private/local payload fixtures never reach the team transport.
- [ ] Desktop tests, typecheck, build, and two-client local integration tests pass.
