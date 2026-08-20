# Design: Harness-backed task splitting

## Boundary

“建议拆分” is an advisory local-runtime operation, not a normal task execution. It must reuse the assigned agent's execution configuration without creating a Run, changing task status, consuming graph scheduler state, or granting repository write access.

## Data flow

```text
Task detail
  -> suggestTaskSplit(task_id, principal_id)
  -> Electron IPC sender validation
  -> authenticated local daemon RPC
  -> authorized Task + Agent lookup
  -> installed-Harness verification
  -> isolated temporary working directory
  -> existing coordy-harness adapter
  -> assistant output collector
  -> strict title decoder
  -> 2-5 reviewable titles
  -> existing addSubtask(title) only after user clicks Create
```

## Contracts

### Request

Add a dedicated local RPC request with `task_id` and `principal_id`. The daemon resolves `task.assignee_agent_id`; the renderer cannot supply an arbitrary Harness, model, or CLI command.

### Execution configuration

Reuse the assigned agent's:

- `harness`
- `model`
- `thinking`
- `speed`
- `cli_args`, after the existing adapter's Auto-mode validation

Always force advisory execution to the safe Auto tool-access policy and use an empty temporary directory as `cwd`. Do not use the task repository/worktree and do not create a kernel Run.

### Prompt and response

The prompt includes only the task title and description and asks for strict JSON:

```json
{"titles":["...","..."]}
```

The decoder accepts a JSON object (including a single fenced JSON block), trims and deduplicates titles, rejects non-strings/empty titles, and requires 2-5 results. Malformed or partial output returns an error and no suggestions.

### Failure handling

Fail closed when:

- the principal cannot view the task;
- the task has no assigned agent;
- the assigned agent is missing, archived, or belongs to another workspace;
- its Harness is not actually installed;
- adapter execution fails, times out, is cancelled, or returns no terminal success;
- output fails the strict decoder.

Temporary files and child processes are cleaned on every path.

## Compatibility

- Remove the renderer's obsolete direct draft/API-key path.
- Keep provider-specific authentication inside each Harness/CLI.
- Existing stored secrets may remain for Harness adapters that explicitly support provider authentication; they are not a prerequisite or UI gate for task splitting.

## Rollback

The new RPC, bridge method, and task-detail button are one isolated vertical slice. Reverting them restores the current manual-only subtask flow without modifying persisted task data.
