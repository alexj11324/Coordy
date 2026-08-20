# Journal - codex (Part 1)

> AI development session journal
> Started: 2026-08-19

---



## Session 1: Harness-backed agent workflows

**Date**: 2026-08-19
**Task**: Harness-backed agent workflows
**Branch**: `codex/harness-backed-task-splitting`

### Summary

Restored assigned-agent task splitting, installed-only Harness selection, dynamic model discovery, local Multica icons, and simplified creation UX.

### Main Changes

- Added typed SuggestTaskSplit RPC using the task assignee's installed Harness in isolated Auto mode.
- Made PATH resolution the only installed signal and removed model-key/obsolete conversational creation UI.
- Embedded the full Multica first-class icon catalog plus Gemini in the app and README.

### Git Commits

| Hash | Message |
|------|---------|
| `57d874a` | (see git log) |

### Testing

- [OK] cargo test --workspace; exact IPC suite passed outside sandbox
- [OK] desktop 21 files / 128 tests, typecheck, and production build passed
- [OK] temporary unsigned macOS Electron runtime accepted at 1280x840

### Status

[OK] **Completed**

### Next Steps

- Open PR against main and merge after review.
