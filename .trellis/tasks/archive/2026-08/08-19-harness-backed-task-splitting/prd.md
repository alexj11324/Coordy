# Restore harness-backed task splitting

## Goal

Keep the user-facing “建议拆分” capability while replacing its obsolete direct API-key dependency with an installed Harness using that Harness's existing local authentication.

## Background

- The current task-detail action calls `window.coordy.completeDraft("subtasks", ...)` after checking `secretsStatus().key_configured`.
- The product no longer asks users to configure a separate model API key for agent creation or task splitting.
- Coordy already starts configured agents through `StartRun`; each agent owns its Harness, model, thinking, permissions, and local authentication behavior.
- The task already records `assignee_agent_id`; that configured agent is the single execution target for splitting. The UI must not ask the user to choose the Harness or model again.
- An earlier worktree edit removed “建议拆分” together with the API-key path. That removal is not acceptable: the user capability must remain while the implementation is replaced.

## Requirements

- Preserve “建议拆分” on task detail.
- Never ask for, read, or gate this action on Coordy's legacy model API key.
- Execute the suggestion request through an actually installed Harness and its native/local authentication.
- Reuse the assigned agent's saved Harness, model, thinking, speed, and safe CLI configuration.
- If the task has no assigned agent, require assignment before suggesting a split.
- Do not silently remove a user capability merely because its underlying implementation is being replaced.
- Keep generated suggestions reviewable: the user must explicitly create each proposed child task.
- Fail visibly without creating tasks when no eligible Harness/agent exists, the Harness run fails, or the output cannot be parsed into 2–5 valid titles.
- Do not let the suggestion run mutate the source task, repository, or unrelated application state.

## Acceptance Criteria

- [x] Task detail still shows “建议拆分”.
- [x] Activating it uses a configured agent whose Harness is locally installed; no `secretsStatus`, `completeDraft`, API-key prompt, or model-key settings link is used.
- [x] The request automatically uses the task assignee's saved Harness and model without a second picker.
- [x] The Harness result yields 2–5 non-empty suggested child titles, displayed for review without creating tasks automatically.
- [x] Each accepted suggestion creates exactly one child task through the existing `addSubtask` path.
- [x] Missing eligible execution target, non-zero/failed run, malformed output, timeout, and cancellation all fail closed with a useful message and zero suggested/created tasks.
- [x] Regression coverage proves the feature remains present and the API-key path is absent.
- [x] Existing creation-page fixes remain: only locally installed tools are selectable, the obsolete conversation-drafting route is unavailable, and floating chat is hidden during agent creation.

## Out of Scope

- Reintroducing the old direct OpenAI/Anthropic draft API.
- Automatically creating subtasks without user review.
- Installing a missing Harness from this action.
