# Design: core product flows

- Introduce one `activeRun` selection helper used by every Home progress control.
- Reuse the existing `boardIssues` projection before My Tasks filtering; make kernel Stats apply the same user-visible issue predicate.
- Give layout state an explicit new-chat transition that clears `activeChatId`.
- Normalize agent selection against `(workspaceId, agentList)` and fail closed on explicit invalid selection.
- Add a final wildcard route inside the existing shell with a clear Home/Board recovery action.
