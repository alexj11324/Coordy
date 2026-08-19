# Conversation-driven task decomposition

## Goal

Let a user describe a goal in a private Coordy chat, discuss or refine it with an
agent, preview a complete executable task plan, and confirm the plan once to
create and optionally start the corresponding parent issue, child issues,
stages, blockers, and assignments. The workflow must remain reviewable and
kernel-authoritative instead of granting a model direct write authority.

## Background

- Current Coordy issue detail can ask a BYOK model for title-only suggestions and
  create suggestions one at a time. It does not use the selected chat agent and
  does not produce descriptions, acceptance criteria, dependencies, stages, or
  assignments.
- Current Coordy already has private chats, real `parent_id` children, `stage`,
  blocker DAG validation, agent/squad assignment, skill injection, and run
  scheduling. The implementation should extend these owners rather than build a
  renderer-only task system.
- Multica commit `7fdc854c262a516b11ceb50a4a666b217b67f29d` was inspected as
  behavior evidence. It teaches agents issue creation, `todo` versus `backlog`,
  stages, and parent handoff through a built-in skill plus CLI contracts. Coordy
  must independently implement the product behavior on its own protocol.

## Requirements

- A normal chat remains normal. When the user explicitly asks for decomposition,
  the chat agent may return a versioned structured plan proposal alongside its
  conversational explanation.
- A proposal may create a new parent issue from chat or attach children to an
  existing parent issue when launched from issue context.
- Every proposed child has a stable draft key, title, description, acceptance
  criteria, priority, stage, dependency draft keys, and an optional suggested
  agent or squad.
- The proposal view supports editing all user-visible fields, removing items,
  adding items, and asking the same chat agent to regenerate a new revision.
- Confirmation is one explicit user action. It creates the entire graph or
  creates nothing. Repeating the same confirmation is idempotent.
- Kernel preflight validates workspace membership, parent ownership, assignee
  access, referenced agent/squad/project identities, unique draft keys,
  dependency endpoints, stage values, and cycle freedom before mutation.
- A confirmed plan records enough provenance to connect created issues to the
  chat, source run, proposal revision, and created parent.
- "Confirm and start" assigns the chosen agents/squads and starts only children
  in the first ready stage whose blockers are satisfied. Later work remains in
  `backlog` until its stage and blockers are ready.
- Agent suggestions are advisory and editable. The kernel never invents an
  assignee, bypasses access control, or trusts a display name as identity.
- A built-in planning skill is injected into chat-agent context. It defines the
  plan schema and planning discipline, but cannot commit state. Existing
  workspace skills remain separate and continue to be injected normally.
- Parent issue UI shows total, done, running, blocked, and remaining child
  counts and the current stage.
- Managed parents auto-complete only when every direct non-deleted child is
  `done`. If any child is `cancelled`, `blocked`, or failed/incomplete, the
  parent remains open for its owner or a human to review.
- The existing title-only `suggestSplit` path is replaced by or routed into the
  same proposal flow; there must not be two incompatible decomposition systems.
- Existing manual child creation continues to work.
- No Multica source, component, asset, API, or data model is copied.

## Out of Scope

- Cloud collaboration or a hosted planning service.
- Automatically changing a user-edited proposal after confirmation.
- Cross-workspace task graphs.
- Recursive decomposition beyond one confirmed parent/child graph in the first
  release; a created child may be decomposed later through a new proposal.
- Provider-specific model tool calling as a prerequisite. The first contract
  must work across Coordy's supported harnesses.

## Acceptance Criteria

- [ ] In a real desktop chat, the user can ask an agent to split a goal and see
  an inline plan card instead of raw JSON.
- [ ] The plan card exposes parent context and every child's title, description,
  acceptance criteria, priority, stage, dependencies, and suggested assignee.
- [ ] Editing, deleting, adding, and regenerating items produces a new proposal
  revision without creating issues.
- [ ] One confirmation creates the parent when needed, all children, their
  `parent_id`, project linkage, stage values, blocker edges, and assignments.
- [ ] A malformed, stale, unauthorized, cyclic, or partially invalid proposal
  creates zero tasks and shows a specific error.
- [ ] A repeated confirmation returns the original created IDs and creates no
  duplicates.
- [ ] Confirm-and-start runs only ready stage-one children; serial/later-stage
  children remain parked until eligible.
- [ ] Completing blockers/stages starts each newly ready child exactly once.
- [ ] Parent progress updates after every child transition and the agreed parent
  completion rule is enforced by the kernel.
- [ ] The built-in planning skill is present for chat agents, absent from
  ordinary issue execution unless relevant, and its output cannot bypass the
  confirmation command.
- [ ] Protocol wire tests, kernel invariant tests, desktop tests/typecheck/build,
  and real macOS runtime acceptance all pass.
- [ ] Runtime acceptance covers create-new-parent, attach-to-existing-parent,
  regenerate, invalid cycle, confirm-and-start, stage release, and parent
  completion.

## Notes

- This is a complex cross-layer task and is split into four independently
  verifiable child tasks. Dependencies are recorded in each child PRD.
