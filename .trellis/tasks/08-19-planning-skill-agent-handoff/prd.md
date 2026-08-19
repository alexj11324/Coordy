# Built-in planning skill and agent handoff

## Goal

Add a built-in Coordy planning skill and structured agent handoff so chat agents propose complete plans without directly mutating task state.

## Requirements

- Add a system-owned planning skill describing clarification, plan quality,
  stages, dependencies, identity use, and the versioned artifact format.
- Inject the skill and a bounded agent/squad catalog into chat planning context,
  without binding it as a user workspace skill or changing ordinary issue runs.
- Parse only exact versioned proposal artifacts from assistant output. Preserve
  surrounding prose as the chat reply.
- Reject malformed or incomplete artifacts without making state changes.
- The skill must say explicitly that only user confirmation creates tasks.

## Dependencies

- Depends on `08-19-conversation-plan-contract` for the authoritative artifact
  schema and on `08-19-chat-plan-preview` for user-visible proposal handling.

## Acceptance Criteria

- [ ] Fake chat harness output creates a proposal revision with correct
  provenance and a normal assistant explanation.
- [ ] Malformed, duplicated, or unsupported-version artifacts remain inert and
  surface a clear error.
- [ ] An ordinary non-planning run receives no planning-only context.
- [ ] No plan can apply without the member-authenticated confirmation command.

## Notes

- Parent task: `08-19-conversation-task-decomposition`.
