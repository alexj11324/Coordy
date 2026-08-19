# Task Plan Contract

## Scenario: Review-first conversational task decomposition

### 1. Scope / Trigger

Use this contract when a chat agent proposes a parent/child issue graph that a
member can edit and confirm. The model is advisory: proposal persistence and
graph application are Coordy kernel commands.

### 2. Signatures

Commands:

```text
SaveTaskPlanProposal {
  proposal_id?: string,
  expected_revision?: u64,
  draft: TaskPlanDraft
}

ApplyTaskPlan {
  proposal_id: string,
  expected_revision: u64,
  idempotency_key: string,
  mode: create_only | confirm_and_start
}
```

Query:

```text
TaskPlan { proposal_id: string }
```

### 3. Contracts

- `draft.version` is exactly `COORDY_TASK_PLAN_V1`.
- `workspace_id`, `chat_id`, `source_run_id`, and `source_agent_id` form immutable
  provenance across revisions.
- A parent is either `create` with title/description/optional project or
  `existing` with a task ID.
- Every child has a canonical non-empty `key` (ASCII alphanumeric, `_`, or `-`,
  maximum 64 characters, no surrounding whitespace), title, description, at
  least one non-empty acceptance criterion, valid priority, stage `>= 1`, local
  dependency keys, and an optional stable agent/squad ID.
- A new save creates revision 1. Updating requires the latest expected revision
  and creates the next revision. Applied proposals are immutable.
- Apply preflights the latest revision before allocating issue numbers, then
  builds the full graph in a cloned `World` and swaps it in only on success.
- The idempotency result is scoped to proposal ID and actor. Repeating the same
  confirmed request returns the original parent/child IDs.
- `create_only` leaves children parked. `confirm_and_start` only opens the
  minimum stage children that have no draft dependencies; later scheduling is a
  separate kernel responsibility.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Unsupported version, blank/canonical-invalid key, title, description, or criterion | `invalid` |
| Duplicate child key/dependency, missing dependency, self-edge, cycle, or dependency on a later stage | `invalid` |
| Missing workspace/chat/run/parent/project/agent/squad | `not_found` |
| Cross-workspace or archived source/target identity | `invalid` |
| Non-member, non-chat-owner, agent actor, or actor cannot command assignee/leader | `denied` |
| Missing/stale revision or proposal already applied under a different key | `invalid` |
| Any failure during apply | Original `World`, issue number, tasks, blockers, runs, notices, and application records remain unchanged |

### 5. Good/Base/Bad Cases

- Good: two stage-1 tasks with no dependencies and a stage-2 task depending on
  both; confirmation creates all three and opens only stage 1.
- Base: one unassigned child in `create_only`; it is created under the parent in
  backlog without starting a run.
- Bad: an archived squad leader after proposal save; apply is denied/invalid and
  creates no partial graph.

### 6. Tests Required

- Rust/TypeScript protocol parity and Rust wire round-trip for create/existing
  parent variants.
- Kernel exact-graph and idempotent replay assertions.
- Zero-residue assertions for invalid graph, stale revision, unauthorized actor,
  and identity invalidated between save and apply.
- Backward-compatible deserialization when older stored worlds omit proposal and
  application collections.
- Explicit assertion that atomic apply itself does not add runs.

### 7. Wrong vs Correct

#### Wrong

Create each child with ordinary commands as the model emits it, then add
dependencies afterward. A later validation error leaves a partial graph and may
start already assigned children.

#### Correct

Save a versioned proposal, let the user confirm one revision, preflight every
identity and edge, build the complete graph in a cloned `World`, and swap only
after all mutations succeed.
