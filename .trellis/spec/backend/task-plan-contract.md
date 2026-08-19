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

## Scenario: Chat artifact discovery and editable confirmation

### 1. Scope / Trigger

Use this flow when the latest assistant chat run contains one exact
`COORDY_TASK_PLAN_V1` fenced JSON artifact. The artifact is advisory output; the
chat projection exposes the newest unapplied proposal and the renderer owns only
editing state and explicit member confirmation.

### 2. Signatures

The `Chat` view includes:

```text
task_plan?: TaskPlanProposalView
task_plan_error?: string
```

The renderer saves edits with `SaveTaskPlanProposal`, then applies that returned
revision with `ApplyTaskPlan`.

### 3. Contracts

- Decode only a complete fenced artifact whose declared version is exactly
  `COORDY_TASK_PLAN_V1`; streamed chunks are not proposals.
- Persist a valid artifact with the assistant run and agent as immutable source
  provenance. Never infer provenance from renderer state.
- Hide the valid artifact JSON from primary chat prose while retaining the
  assistant explanation and tool activity. Malformed artifact text stays
  visible with an actionable error.
- Project only the latest run's artifact error and the latest unapplied proposal
  for the selected chat; switching chats or receiving a newer proposal clears
  stale state.
- Every edit creates a new proposal revision. Confirmation first saves dirty
  edits and applies the exact returned revision.
- Deleting a child removes incoming references to its key. Renderer validation
  mirrors kernel key, priority, stage, dependency, ordering, and cycle rules but
  never replaces kernel validation.
- Regeneration creates a persistent revision before requesting a new assistant
  turn, so the audit trail records the user-visible action even when the model
  returns no new artifact.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Artifact incomplete during streaming | Suppress fenced JSON preview; do not save |
| Unsupported, duplicate, malformed, or incomplete artifact | Preserve text, expose latest-run error, make no proposal mutation |
| Dirty edit invalid in renderer | Disable confirmation and identify the field/edge |
| Dirty edit loses a revision race | Kernel rejects stale revision; leave card editable |
| Save succeeds but apply fails | Saved revision remains reviewable; no task graph is created |
| Valid artifact plus normal explanation/tool activity | Hide only artifact JSON; preserve the rest |

### 5. Good/Base/Bad Cases

- Good: an explanation followed by one valid artifact becomes an editable card;
  editing a dependency and confirming applies the newly saved revision.
- Base: ordinary assistant prose with no artifact remains ordinary chat.
- Bad: a streamed or unsupported-version artifact never flashes as a usable
  plan and never mutates task state.

### 6. Tests Required

- Kernel tests for valid, malformed, streamed, latest-run, and cross-chat
  projection behavior.
- Renderer helper tests for strict parsing, normalization, dependency ordering,
  dangling references, and cycles.
- Component tests for editing, deletion cleanup, regeneration, create-only,
  confirm-and-start, and successful parent navigation.
- Full desktop tests, TypeScript typecheck, production build, protocol parity,
  Rust formatting, and focused task-plan tests.

### 7. Wrong vs Correct

#### Wrong

Render streaming JSON as chat prose, trust the browser to validate it, and apply
the proposal revision that happened to be loaded when the user clicked.

#### Correct

Wait for the complete assistant output, strictly decode and persist it in the
kernel, project one reviewable proposal, save every edit as a revision, and let
the authenticated member apply that exact revision atomically.

## Scenario: System-owned planning skill and identity handoff

### 1. Scope / Trigger

Inject this guidance only into an authenticated `StartRun` whose trigger is
`chat` and whose private chat, hidden chat task, workspace, and selected agent
all match. It is system-owned runtime context, not a workspace Skill record.

### 2. Signatures

The injected context contains exact values for:

```text
version, workspace_id, chat_id, source_run_id, source_agent_id,
available_agents[], available_squads[]
```

The run ID is allocated before prompt decoration so the model can copy the
actual immutable source ID into its artifact.

### 3. Contracts

- Ordinary issue, graph, automation, mention, and squad runs receive no
  planning-only instruction or identity catalog.
- The catalog is deterministic, capped at 40 agents and 40 squads, and contains
  only active same-workspace identities the initiating actor can command.
- A squad is listed only when its leader is active, same-workspace, and
  commandable. Descriptions are capped at 160 characters.
- The built-in skill instructs the model to clarify material ambiguity, produce
  independently verifiable children, use valid priorities/stages/dependencies,
  copy only catalog IDs, and emit exactly one strict artifact.
- The skill explicitly states that artifact emission creates, assigns,
  dispatches, and starts nothing; only later authenticated member confirmation
  can apply a proposal.
- No built-in prompt or catalog is persisted as a user-editable `Skill`.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| `chat` trigger without `chat_id` | Reject before run creation |
| `chat_id` on a non-chat trigger | Reject before run creation |
| Chat not visible to actor | `denied`; no planning context leaks |
| Workspace, task, or agent differs from chat | `invalid`; no run creation |
| Archived/inaccessible agent or squad leader | Omit from catalog |
| Ordinary issue run | Preserve existing prompt decoration only |

### 5. Good/Base/Bad Cases

- Good: a private chat run receives its exact provenance plus two commandable
  agents, emits an artifact and explanation, and creates revision 1 without
  applying any task.
- Base: an ordinary issue run receives the agent/workspace Skills it already
  had but no task-planning instructions.
- Bad: associating another chat with an issue run is rejected before dispatch.

### 6. Tests Required

- Assert exact workspace/chat/run/agent IDs and commandable identities appear in
  chat prompt context while inaccessible identities do not.
- Assert ordinary issue prompts contain no built-in planning marker and the
  World has no synthetic Skill record.
- Feed an assistant explanation plus valid artifact through the harness event
  boundary; assert one reviewable proposal revision, preserved explanation, no
  application record, and no created plan children.
- Retain malformed, duplicate, incomplete-stream, unsupported-version,
  provenance, and member-confirmation tests from the two scenarios above.

### 7. Wrong vs Correct

#### Wrong

Bind a mutable workspace Skill to every agent and ask the model to guess current
run IDs or assignee names; ordinary work becomes noisy and proposed assignments
cannot be validated reliably.

#### Correct

For each private chat run, allocate the run ID first and inject one bounded,
actor-filtered context containing exact stable IDs. Keep all mutation behind the
kernel's later authenticated confirmation command.

## Scenario: Confirmed-plan scheduling and managed parent rollup

### 1. Scope / Trigger

This orchestration applies only to parents recorded by `TaskPlanApplication`.
Automatic dispatch applies only when that application's mode is
`confirm_and_start`; `create_only` remains parked until a user acts.

### 2. Signatures

`TaskView` adds the derived field:

```text
task_plan_progress?: {
  total, done, running, blocked, remaining, current_stage?
}
```

`World` persists `task_plan_auto_completed_parent_ids` so a parent completed by
rollup can be reopened if a child later leaves `done`.

### 3. Contracts

- The current stage is the lowest numeric stage containing a non-`done`
  application child. Only children in that stage are eligible.
- An eligible child requires every explicit blocker to be `done`; `cancelled`
  does not satisfy managed-plan scheduling even though legacy blocker flows may
  treat it as released.
- Later-stage children remain `backlog`. Generic blocker dispatch skips managed
  plan children so it cannot bypass stage rules.
- All eligible assigned children in one stage dispatch together. Agent tasks use
  the recorded confirming principal and squad tasks dispatch through the
  validated leader.
- Any prior run for a child prevents another automatic start. Capacity failures
  with no created run may be reconsidered after another managed run terminates.
- Progress is derived from all direct non-deleted children of a managed parent,
  including later manual children. Running includes an active run; blocked
  includes status, reason, or unresolved blocker state.
- A managed parent becomes `done` only when every direct non-deleted child is
  `done`. `cancelled`, `blocked`, failed-run, review, open, backlog, or any other
  incomplete state prevents completion.
- A parent auto-completed by rollup reopens if a child later leaves `done`.
  Manually assembled parents retain their prior behavior.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Confirm-and-start with two ready stage-1 assignees | Dispatch both once |
| Stage-2 blocker incomplete | Keep stage 2 parked |
| Blocker becomes `done` and all earlier-stage work is `done` | Open and dispatch ready next-stage children |
| Blocker becomes `cancelled` or `blocked` | Keep later stages parked and parent open |
| Child run fails | Do not retry automatically, release next stage, or complete parent |
| Member marks managed parent done early | Reject |
| All direct children become `done` | Complete parent and release its dependents |
| Manual parent has incomplete manual child | No new managed completion rule |

### 5. Good/Base/Bad Cases

- Good: two stage-1 runs start in parallel; after both children are marked done,
  one stage-2 run starts; finishing it completes the parent.
- Base: a create-only plan exposes progress but creates no runs.
- Bad: cancelling the sole stage-1 blocker must not exploit legacy blocker
  release to start stage 2.

### 6. Tests Required

- Parallel agent dispatch, squad-leader dispatch, serial release, and repeated
  reconciliation with exactly one child run.
- Blocked, cancelled, and failed-run cases holding later stages and the parent.
- Derived progress counts/current stage before and after JSON persistence reload.
- All-done auto-completion, child regression reopening, and early manual parent
  completion rejection.
- Compatibility test proving a manually assembled parent remains manual and old
  stored worlds default the new auto-completion collection.
- Protocol parity, kernel suite, desktop tests/typecheck/build, and narrow-window
  runtime inspection of the progress card.

### 7. Wrong vs Correct

#### Wrong

Let the generic blocker release path treat `cancelled` as success, immediately
start the next assigned child, and mark the parent done when every child is merely
terminal.

#### Correct

Route managed children through the plan scheduler, require actual `done` for
stage and parent completion, derive progress from child source of truth, and
dispatch each newly eligible assignment at most once.
