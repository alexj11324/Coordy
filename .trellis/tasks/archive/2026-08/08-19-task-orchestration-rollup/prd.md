# Task orchestration and parent rollup

## Goal

Dispatch confirmed ready children by stage/dependency and roll child progress up to the parent, including the approved automatic completion rule.

## Requirements

- Confirm-and-start starts only the lowest ready stage and only tasks with no
  unresolved blockers.
- Later stages remain backlog until prior stage completion and dependency
  readiness; every eligible task starts at most once.
- Confirmed-plan parents expose derived progress counts and current stage.
- Child status transitions recompute parent progress and enforce the approved
  terminal rule.
- Auto-complete a managed parent only when every direct non-deleted child is
  `done`; any cancelled, blocked, failed, or incomplete child prevents it.
- Existing manually assembled parent/child graphs do not opt into automatic
  completion implicitly.

## Dependencies

- Depends on all three earlier child tasks so scheduling consumes an applied,
  user-confirmed plan with stable provenance.

## Acceptance Criteria

- [x] Parallel stage children start together after confirmation.
- [x] Serial stages and explicit blockers release in order exactly once.
- [x] Failed or blocked children do not falsely complete the parent.
- [x] Progress survives persistence/reload and matches the child task source of
  truth.
- [x] The all-done and cancelled-child terminal cases pass kernel and real-runtime
  acceptance.

## Notes

- Parent task: `08-19-conversation-task-decomposition`.
