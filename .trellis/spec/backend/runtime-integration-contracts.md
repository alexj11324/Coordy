# Coding Runtime Integration Contracts

## Scenario: Add or change a first-class coding runtime

### 1. Scope / Trigger

- Trigger: a runtime ID, executable, launch arguments, wire protocol, permission policy, or discovery state changes.
- A provider name in ACP Registry is discovery metadata, not proof that Coordy implements the provider's native protocol.
- A runtime is first-class only after a real process contract completes one turn and a malformed or failed turn remains visible.

### 2. Signatures

- `BuiltinHarness { id, name, bins, family, fixed_args }` owns stable provider identity and daemon-owned launch arguments.
- `DiscoveredAgentView.launch_state` is one of `ready`, `on_demand`, or `missing`; only `ready` is installed or launchable.
- `resolve_launch(kind, configured, registry_json)` returns the concrete executable and arguments.
- Runtime execution must choose transport from the concrete discovered entry. A canonical native ID may resolve to an ACP Registry fallback.

### 3. Contracts

- `ready`: an executable was resolved from the host `PATH`; the runtime is shown as `已安装` and may be selected.
- `on_demand`: Registry metadata exists, but no executable was resolved. It is shown as `未安装` and cannot be selected, imported, submitted, or launched.
- `missing`: the first-class identity remains visible as `未安装` and cannot be selected, imported, submitted, or launched.
- Explicit import requests must revalidate the resolved executable. A matching ID or Registry entry is never installation proof.
- Native structured protocols must observe the provider's terminal-success frame. Receiving text is not sufficient.
- ACP providers share framing but own launch, authentication, model, thinking, workspace metadata, and session capability policies.
- Persisted Harness aliases are canonicalized before catalog lookup; an old `claude-acp` value must resolve the installed `claude` entry.
- Claude Code uses a maintained selector catalog because its CLI has no model-list API. Help output may contribute advertised effort values, but prose must never be parsed into model IDs.
- Unsupported or failed model discovery is runtime-managed/default state. It must not enable an arbitrary model-ID text field.
- ACP `session/new` model blocks and thinking `configOptions` are merged; receiving direct models must not discard advertised thinking choices.
- Auto access must stay inside the canonical worktree. Permission escalation requests are rejected; provider bypass flags are Full Access only.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Unknown runtime ID | `unavailable`; never default silently to a native protocol |
| Missing executable with or without Registry metadata | visible `未安装`, disabled in every creation and import path |
| Registry binary archive not installed | `missing`; do not invent a download path |
| Malformed structured frame | `invalid`; do not ignore it after earlier valid text |
| EOF before provider terminal frame | failure |
| Provider terminal status is failed/interrupted | failure with provider detail |
| Auto permission/escalation request | reject/cancel |
| Fixed launch flag appears in `cli_args` | reject before spawning |
| Native model discovery fails or returns no models | runtime-managed/default; no free-text selector |

### 5. Good / Base / Bad Cases

- Good: `grok` initializes ACP, authenticates using an advertised method, starts a session, emits a message, and completes the prompt.
- Base: a missing `hermes` binary is still shown with its icon and `未安装`, but cannot be selected.
- Bad: a `qwen-code` Registry entry without a local executable is labeled installed or accepted by explicit import.
- Bad: a JSON runtime emits one assistant line, then malformed JSON, and Coordy reports success.

### 6. Tests Required

- A schema-enforced set test must cover every first-class identity exactly once.
- Each provider family needs a fake executable that asserts fixed argv/input channel, emits one real successful envelope and terminal frame, and has malformed/non-zero coverage.
- ACP policy tests must assert method order, auth selection, permission rejection in Auto, model/thinking capability, and workspace confinement.
- Model discovery tests must cover alias canonicalization, Claude's maintained catalog plus advertised effort, runtime-managed failure fallback, and ACP direct-model/thinking-option merging.
- UI tests must assert only `ready` is selectable; `on_demand` and `missing` remain visible as `未安装`, disabled, and fail submit-time revalidation.
- Cross-layer tests must prove a Registry fallback selects ACP transport instead of the canonical native family.

### 7. Wrong vs Correct

#### Wrong

```rust
// A matching name is treated as native, even when discovery selected ACP.
if protocol_family(kind).uses_acp() { run_acp() } else { run_native() }
```

#### Correct

```rust
// Resolve the concrete catalog entry first; its protocol family owns transport.
let launch = resolved_catalog_entry(kind)?;
match launch.protocol_family.as_str() {
    "acp" => run_acp(launch),
    _ => run_native(launch),
}
```

## Scenario: Suggest child tasks with the assigned agent's Harness

### 1. Scope / Trigger

- Trigger: a principal requests advisory child-task titles for an existing task.
- This is suggestion generation only. It must not create a kernel Run, mutate the source task, or create child tasks.
- The current task's assigned agent is the sole execution identity; there is no second Harness picker.

### 2. Signatures

- Request: `SuggestTaskSplit { id, workspace_id, task_id, principal_id }`.
- Response: `TaskSplitSuggestion { titles }` where `titles` contains 2-5 unique, non-empty strings.
- The daemon resolves `assignee_agent_id`, then copies the agent's stored Harness, model, thinking effort, speed option, and safe CLI arguments into an isolated advisory launch.

### 3. Contracts

- Principal authorization and task/workspace membership are checked before reading the assignee.
- The principal must pass the same `can_command_agent` policy used by `AssignTask` and `StartRun`; this check occurs before installation lookup or process spawn.
- The assigned agent and its locally installed executable must exist. Registry metadata is insufficient.
- Advisory execution runs in a fresh temporary directory with Auto access, then cleans up on every exit path.
- Provider credentials remain owned by the Harness/CLI. The request, response, and advisory launch must not accept or copy a Coordy model API key or base URL.
- The result parser accepts only a JSON array or fenced JSON array with 2-5 unique, non-empty titles.
- The user reviews suggestions and explicitly creates each child through the existing child-task command.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Missing/unauthorized workspace or task | fail without spawning |
| Workspace peer cannot command the owner-only assigned agent | denied before installation lookup or spawn |
| Task has no assigned agent | fail with actionable detail |
| Assigned agent is missing, archived, or not installed | fail without Registry fallback |
| Harness exits non-zero, times out, or emits malformed output | fail; no partial suggestions |
| Fewer than 2, more than 5, blank, or duplicate titles | fail closed |
| Temporary worktree cleanup fails | surface the cleanup failure; do not report success |

### 5. Good / Base / Bad Cases

- Good: the task is assigned to an installed Codex agent; the advisory launch inherits that agent's model and thinking setting, returns three JSON titles, and the UI renders three reviewable create actions.
- Base: the task has no assignee, so the UI shows an actionable error and performs no launch.
- Bad: the renderer sends a Harness ID, model, provider key, or base URL supplied by the user and bypasses the task assignee.
- Bad: the daemon creates children automatically from unreviewed model output.

### 6. Tests Required

- Rust protocol wire tests must prove the request contains only IDs and no Harness, model, API-key, or base-URL fields.
- Local-runtime tests must cover authorization, missing assignment, missing installation, success, malformed output, non-zero exit, timeout, and cleanup.
- Authorization coverage must include a cross-principal workspace peer attempting to use an owner-only assigned agent.
- A fake provider executable must assert the inherited model/thinking/speed/safe CLI arguments and the isolated working directory.
- Desktop bridge tests must cover trusted-sender validation and typed response propagation.
- UI tests must prove the assigned agent is used automatically, suggestions remain reviewable, and child creation occurs only after an explicit user action.

### 7. Wrong vs Correct

#### Wrong

```ts
await suggestTaskSplit({
  workspaceId,
  taskId,
  harness: selectedHarness,
  model: selectedModel,
  apiKey: configuredKey,
})
```

#### Correct

```ts
await suggestTaskSplit({
  id: crypto.randomUUID(),
  workspace_id: workspaceId,
  task_id: taskId,
  principal_id: principalId,
})
```

## Scenario: Create a fully configured agent

### 1. Scope / Trigger

- Trigger: the desktop creation form submits the selected Harness and saved execution settings.
- Creation is one product command and one persistence boundary, not a renderer-owned `CreateAgent` followed by `UpdateAgent`.

### 2. Signatures

- Command: `CreateConfiguredAgent { workspace_id, principal_id, name, harness, description, instructions, avatar, model, thinking, speed, access, tool_access }`.
- Outcome: `agent_id` for exactly one fully configured agent.

### 3. Contracts

- The kernel validates principal/workspace ownership, normalized unique name, non-empty Harness, access policy, and tool-access policy before allocating an ID or mutating state.
- On success the single inserted agent already contains every submitted configuration field and emits one state change.
- No intermediate default-configured agent may be persisted or observed.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Principal belongs to another workspace | reject; no agent, audit, or state-change effect |
| Empty or duplicate name | reject before mutation |
| Empty Harness or unknown access/tool-access value | reject before mutation |
| Valid complete input | insert exactly one fully configured agent |

### 5. Good / Base / Bad Cases

- Good: creating a workspace-visible Claude reviewer stores its model, thinking, instructions, avatar, and Full Access tool policy in the returned agent.
- Base: omitted access/tool access normalize to owner/Auto defaults.
- Bad: the renderer creates a default agent, persists it, then sends a second update that can fail independently.

### 6. Tests Required

- Kernel tests must assert all configuration fields are present immediately after success.
- A failing final validation field must leave agent count, audit count, and effect count unchanged.
- Protocol parity tests must keep the Rust and TypeScript command shapes aligned.

### 7. Wrong vs Correct

#### Wrong

```ts
const created = await submit({ type: "CreateAgent", ...identity })
await submit({ type: "UpdateAgent", agent_id: created.ids.agent_id, ...config })
```

#### Correct

```ts
await submit({ type: "CreateConfiguredAgent", ...identity, ...config })
```
