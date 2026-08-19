# Chat plan preview and editing

## Goal

Render agent-produced task plans in chat with editable preview, regeneration, one-click confirmation, and clear failure states.

## Requirements

- Render a strict proposal as an inline chat plan card; never show its JSON as
  the primary UI.
- Support editing parent and child fields, adding/removing children, dependency
  selection, assignment selection, and regeneration as a new revision.
- Offer separate create-only and confirm-and-start actions with a final summary.
- Show exact parsing, validation, stale revision, and apply errors without
  claiming success.
- Route task-detail decomposition through this proposal editor.

## Dependencies

- Depends on `08-19-conversation-plan-contract` for proposal queries, revisions,
  and apply commands.

## Acceptance Criteria

- [ ] Desktop tests cover preview, edits, regeneration, disabled invalid apply,
  create-only, and confirm-and-start.
- [ ] Keyboard operation and the 720x520 layout remain usable.
- [ ] Existing normal chat messages and manual child creation are unchanged.

## Notes

- Parent task: `08-19-conversation-task-decomposition`.
