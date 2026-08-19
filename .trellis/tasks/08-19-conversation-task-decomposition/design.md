# Design

## Authority boundary

The agent proposes; the user approves; the kernel commits. A chat agent never
executes a sequence of ordinary `CreateTask` commands while planning, because a
mid-sequence failure would leave a partial graph and a model could bypass the
review UI.

## Data flow

```text
chat request
  -> normal agent run + built-in planning skill
  -> COORDY_TASK_PLAN_V1 proposal artifact
  -> strict decoder owned by the protocol/runtime boundary
  -> persisted proposal revision linked to chat and source run
  -> inline editable preview
  -> explicit ApplyTaskPlan(expected_revision, idempotency_key)
  -> kernel preflight
  -> atomic parent/children/blockers/assignments mutation
  -> scheduler starts only ready work
  -> child transitions update parent rollup
```

The first release uses a fenced, versioned JSON artifact so every supported
harness can produce the same plan without requiring provider-specific function
calling. Assistant prose outside the artifact remains a normal chat message.
Malformed artifacts remain visible as ordinary output plus a parse error; they
never become an applicable proposal.

## Proposal contract

A proposal owns a server-generated ID and revision. Each child uses a stable
draft-local key. Dependencies refer only to those keys and are resolved to real
task IDs during apply. Suggested assignees use stable IDs, never names.

The proposal includes:

- provenance: workspace, chat, source run, agent, revision;
- parent mode: create a parent or attach to an existing task;
- parent fields: title, description, project;
- child fields: key, title, description, acceptance criteria, priority, stage,
  dependency keys, agent ID or squad ID;
- apply options: create only or confirm and start.

Acceptance criteria are stored in the child description in the first release,
using one canonical formatter, because Coordy's current task schema has no
separate acceptance-criteria field. A future dedicated field is not required to
ship the workflow.

## Kernel apply

`ApplyTaskPlan` is the only bulk mutation entry. It performs a complete
read-only preflight before allocating issue numbers or mutating `World`. It then
creates the parent if needed, creates all children, maps draft keys to task IDs,
adds blocker edges through the existing DAG rules, applies assignments, and
records the application result. The idempotency key maps repeated submits to the
same created IDs.

All children are initially parked. After the graph exists, confirm-and-start
moves only the minimum ready stage to an executable status and invokes the
existing scheduler. This prevents assignment side effects from starting a
partial graph during construction.

## Skill boundary

The built-in planning skill teaches the agent to:

- ask for missing product intent when decomposition would otherwise be unsafe;
- produce independently verifiable child outcomes;
- distinguish parallel work from serial stages;
- reference only supplied agent/squad IDs;
- emit exactly one versioned proposal artifact;
- never claim that a proposal has been created before confirmation.

The skill is system-owned and automatically available in chat planning context.
It is not a user-editable workspace skill and cannot grant permissions. Kernel
validation is authoritative if the skill output is wrong.

## Parent rollup

Confirmed plans opt their parent into managed rollup so existing manually
created parent/child relationships do not silently change behavior. Rollup is
derived from direct non-deleted children and exposes counts plus current stage.
Every child status transition recomputes the rollup. The final terminal rule is
the only unresolved product decision in the PRD.

## Compatibility and rollback

- Existing `CreateTask`, `AssignIssue`, `AddIssueBlocker`, chats, and manual
  children remain valid.
- Existing stored worlds use defaults for new proposal/rollup collections.
- Removing the renderer surface leaves proposals inert; no proposal applies
  without the kernel command.
- The title-only BYOK draft endpoint can remain temporarily for Agent Builder,
  but issue splitting routes to the new proposal flow.
