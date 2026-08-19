# Conversation plan contract and atomic apply

## Goal

Define a structured task-plan draft and a kernel-owned all-or-nothing command that validates and creates child issues, stages, blockers, and assignments.

## Requirements

- Define one versioned proposal schema with stable child draft keys and source
  chat/run provenance.
- Add proposal revisions and an idempotent `ApplyTaskPlan` kernel command.
- Preflight every field, identity, dependency endpoint, and cycle before any
  issue number or state mutation.
- Create the parent when requested, then children, stages, blockers, project
  links, and assignments as one logical transaction.
- Park children until the graph is complete so assignment cannot start partial
  work.
- Do not change existing manual task commands.

## Dependencies

- The unfinished `08-19-expand-coding-agent-runtimes` task must first commit or
  separate its changes to shared protocol files.

## Acceptance Criteria

- [x] Valid create-parent and existing-parent plans round-trip on the wire and
  apply with the exact requested graph.
- [x] Invalid identity, stale revision, missing draft key, duplicate key, cycle,
  and unauthorized apply each create zero tasks.
- [x] Repeating an idempotency key returns the first result without duplicates.
- [x] Existing task/blocker/assignment invariant tests remain green.

## Notes

- Parent task: `08-19-conversation-task-decomposition`.
