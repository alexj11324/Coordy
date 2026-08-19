# Research: Electron renderer product-flow audit

- Query: Trace the visible desktop routes, sidebar/tabs, and primary journeys (conversation, task/issue, agent creation, harnesses, settings, projects, automations, squads, Skills, and stats); identify concrete mismatches, unreachable states, navigation bugs, stale assumptions, and missing tests without modifying product code.
- Scope: internal
- Date: 2026-08-19

## Findings

### Executive result

The current renderer exposes all requested top-level product areas, but the audit found eight confirmed flow defects and one defensive routing gap. The most consequential defect is a current uncommitted regression that makes valid `on_demand` runtimes impossible to select even though the repository's runtime contract explicitly requires them to be selectable. Other high-impact problems are wrong-target controls on the Home progress card, hidden chat tasks leaking into task/stat surfaces, and a non-atomic agent creation flow that can leave an unusable partial agent after an error.

The worktree contained 36 changed/untracked status entries at audit time. The create-agent redesign, runtime readiness changes, task-detail rewrite, settings rewrite, and router redirects are part of that live patch set; findings below refer to the current working tree, not only `HEAD`.

### Visible route and navigation map

- The router covers Home, Inbox, Chat, My Tasks, Task Board/detail, Graph, Projects/detail, Automations/detail, Agents/create/detail, Squads/detail, Stats, Harnesses, Skills/detail, Settings, Runs, Principals, Authority, Memory, Contracts, Dependencies, and Conflicts (`apps/desktop/src/renderer/src/app/router.tsx:54-89`).
- The always-visible sidebar surfaces personal, workspace, and configuration destinations (`apps/desktop/src/renderer/src/shell/nav.ts:33-53`, `apps/desktop/src/renderer/src/shell/app-sidebar.tsx:97-103`). Advanced destinations are reachable through the identity footer menu rather than the main sidebar (`apps/desktop/src/renderer/src/shell/nav-user.tsx:138-151`).
- Tabs are route snapshots: ordinary navigation rewrites the active tab; only the plus button / Mod+T creates another (`apps/desktop/src/renderer/src/lib/coordy/tab-path.ts:90-115`). This is internally consistent and covered by helper tests.
- The former multi-step and AI agent-builder URLs now redirect to the single manual form (`apps/desktop/src/renderer/src/app/router.tsx:68-71` in the compact source, currently formatted at lines 76-88). Deleted builder components are therefore not presently unreachable UI; they are an intentional redirect/migration in the uncommitted patch.

### Confirmed bugs

#### P0 — valid `on_demand` runtimes are classified as missing and cannot create an agent

Evidence:

- The contract defines `launch_state` as `ready | on_demand | missing`, says `on_demand` is executable through an available package runner, and requires UI tests for ready/on-demand selectability (`.trellis/spec/backend/runtime-integration-contracts.md:13-22`, `:47-53`).
- Current `runtimeIsLaunchable` returns true only when `installed` is true (`apps/desktop/src/renderer/src/lib/coordy/labels.ts:205-215`). This rejects `installed: false, launch_state: "on_demand"`.
- The Harness page similarly partitions only by `installed`, putting on-demand entries under “本机尚未安装” (`apps/desktop/src/renderer/src/features/runtimes.tsx:121-128`).
- The uncommitted diff changed the earlier implementation, which explicitly accepted `launch_state === "on_demand"`, into the current installed-only check. The newly changed tests now assert that an on-demand Grok entry is disabled and labeled “未安装” (`apps/desktop/src/renderer/src/test/create-agent.spec.ts:259-309`) and grouped with missing entries (`:311-343`). The tests therefore encode the regression rather than catch it.

Reproduction:

1. Return a discovered entry such as `{ installed: false, launch_state: "on_demand", source: "registry", command: "npx ..." }`.
2. Open Harness: the entry appears under “本机尚未安装”.
3. Open Create Agent: the entry is visible but disabled; `canCreate` is false and submit revalidation reports “尚未安装” (`apps/desktop/src/renderer/src/features/create-agent/manual-create-agent-page.tsx:83-93`).

Expected repair boundary: derive visibility, readiness label, partitioning, picker disabled state, and submit-time validation from `launch_state`; `ready` and `on_demand` are launchable, only `missing` is disabled. Replace the two current inverse tests with the contract-required matrix.

#### P1 — “用此 harness 创建智能体” does not carry the selected harness

Evidence:

- Each ready runtime card renders a provider-specific CTA, but every button navigates to the same bare `/agents/new` URL (`apps/desktop/src/renderer/src/features/runtimes.tsx:68-90`).
- The create page does not read route state or a query parameter. It restores the workspace's saved draft harness or chooses the first selectable runtime (`apps/desktop/src/renderer/src/features/create-agent/manual-create-agent-page.tsx:57-70`).

Reproduction:

1. Have at least two installed runtimes, A and B, with A first in the catalog.
2. On Harness, click “用此 harness 创建智能体” on B.
3. The create form selects A (or the previously saved draft's provider), not B.

Expected repair boundary: pass a stable provider ID in navigation state/query and validate it against the live catalog during form hydration. Add an integration/helper test that starts from the runtime-card CTA and asserts the form's harness ID.

#### P1 — agent creation can report failure after already creating a partial agent

Evidence:

- `createNamedAgent` first commits `CreateAgent`, then separately submits `UpdateAgent` for description, instructions, model, thinking, speed, access, tool access, and avatar (`apps/desktop/src/renderer/src/lib/coordy/start-task.ts:24-52`).
- The form treats any thrown error as total creation failure and stays on the form (`apps/desktop/src/renderer/src/features/create-agent/manual-create-agent-page.tsx:98-121`). There is no compensation, partial-success outcome, or recovery by returned agent ID.

Reproduction:

1. Let `CreateAgent` succeed and force `UpdateAgent` to fail (daemon disconnect or invalid second command).
2. The form displays an error and retains the draft, but the bare agent already exists.
3. Retry with the same name; the unique-name constraint can now reject the retry, leaving the user stuck between a failed form and an existing incomplete agent.

Expected repair boundary: preferably make creation atomic in the kernel/protocol. If kept as two commands, return/recover the created ID and surface partial success rather than inviting a duplicate retry. Add a failure-injection test for the second command.

#### P1 — Home can display one run but open/cancel a different run

Evidence:

- The progress feed selects `activeRunId = runId ?? latestRun.id` and fetches events for that ID (`apps/desktop/src/renderer/src/features/home.tsx:67-82`).
- The footer independently targets `latestRun.task_id` and `latestRun.id` for “打开事项” and CancelRun (`apps/desktop/src/renderer/src/features/home.tsx:207-220`).

Reproduction:

1. Start run A from Home; local `runId` pins the progress feed to A.
2. Cause a newer run B to appear in the workspace (another task/automation/chat).
3. Home continues showing A's events, while “打开事项” opens B and “停止” cancels B.

Expected repair boundary: resolve one `activeRun` object from `activeRunId` and use it for description, events, open, and cancel. Add a test with pinned A plus newer B.

#### P1 — private chat backing tasks leak into “我的任务”

Evidence:

- Creating a chat also creates a hidden task assigned to both the selected agent and the owner principal, labeled/staged `chat` (`crates/coordy-kernel/src/product.rs:1377-1404`).
- The main task board deliberately filters chat-backed tasks through `boardIssues` (`apps/desktop/src/renderer/src/features/board.tsx:63-64`; predicate in `apps/desktop/src/renderer/src/lib/coordy/issues.ts:26-31`).
- “我的任务” skips that filter and sends every Board task into `tasksAssignedToMe` (`apps/desktop/src/renderer/src/features/pages.tsx:1035-1041`). Because chat tasks are assigned to the owner principal and agent, they match by construction.
- The existing tests separately prove My Tasks assignment filtering and Board chat filtering but never combine them (`apps/desktop/src/renderer/src/test/board.spec.ts:132-153`).

Reproduction:

1. Create a chat with any agent.
2. Open “我的任务” as the chat owner or selected agent.
3. “对话 · <agent>” appears as a task even though it is intentionally absent from the Task board; clicking it opens the generic task detail rather than the chat.

Expected repair boundary: filter `boardIssues(asTasks(...))` before `tasksAssignedToMe`, or explicitly define a separate “followed chat” surface. Add a regression using an assigned `stage: "chat"` task.

#### P1 — Stats counts hidden chat backing tasks as user-visible issues

Evidence:

- The Stats renderer labels `issue_count/open_count/done_count` as “事项/未完成/已完成” and states that the kernel owns aggregation (`apps/desktop/src/renderer/src/features/pages.tsx:1079-1110`).
- Kernel `stats_view` counts every non-deleted task and does not exclude `stage == "chat"` / the `chat` label (`crates/coordy-kernel/src/product.rs:1945-1957`).
- Each new chat creates one such hidden task (`crates/coordy-kernel/src/product.rs:1377-1404`).

Reproduction:

1. In an otherwise empty workspace, create one chat and no user task.
2. Task board remains empty by design.
3. Stats reports one open “事项”; further chat creation inflates issue metrics.

Expected repair boundary: define whether Stats is user-visible issue analytics or all kernel tasks. Given the current labels and Board behavior, exclude chat-stage tasks from issue metrics (while runs may still include chat runs) and add a kernel Stats regression.

#### P2 — command palette “新建聊天” reopens the existing chat instead of starting a new one

Evidence:

- The command is labeled “新建聊天” but only calls `openChatDock()` (`apps/desktop/src/renderer/src/shell/command-palette.tsx:83-90`).
- `openChatDock(undefined)` explicitly preserves `activeChatId` (`apps/desktop/src/renderer/src/state/layout-store.ts:110-115`). Actual new-chat creation is a separate mutation inside FloatingChat (`apps/desktop/src/renderer/src/features/floating-chat.tsx:124-135`).

Reproduction:

1. Open chat A, then close/minimize the dock.
2. Run “新建聊天” from the command palette.
3. Chat A reopens; no new chat is created and the composer is not reset to a true new-conversation state.

Expected repair boundary: either rename the command to “打开聊天”, or make it clear `activeChatId` and enter a new-chat state / invoke the creation action. Add a store/command integration test with an existing active ID.

#### P2 — Home's selected agent becomes stale across workspace switches and silently dispatches to another agent

Evidence:

- `agentId` is component-local state and is not reset when `workspaceId` or `agentList` changes; any non-empty stale value wins over the new workspace's default (`apps/desktop/src/renderer/src/features/home.tsx:62-72`).
- `startAcpRun` passes that ID into `pickAgentId`, which silently falls back to the first agent if the preferred ID is absent (`apps/desktop/src/renderer/src/lib/coordy/start-task.ts:55-63`).

Reproduction:

1. On Home in workspace A, explicitly select agent A2.
2. Switch to workspace B without leaving Home.
3. The select's value is not in B's item map. Press Start: `pickAgentId` silently chooses B's first agent, so the actual recipient is different from the stale selected value.

Expected repair boundary: reset/normalize selection when workspace/catalog changes and do not silently substitute for an explicit invalid selection. Add a two-workspace component/helper test.

### Defensive routing gap (not yet reproduced as a normal happy-path bug)

- `AppRouter` has no wildcard/not-found route after the explicit route set (`apps/desktop/src/renderer/src/app/router.tsx:49-92`). The tab store restores arbitrary persisted paths from localStorage without validating them against current routes (`apps/desktop/src/renderer/src/state/tab-store.ts:24-39`).
- A stale tab from a removed route, malformed external hash, or future route rename therefore renders an empty shell rather than a recoverable not-found page. The known removed builder URLs have explicit redirects, so this is a defensive gap rather than a currently confirmed normal-path regression.
- Recommended narrow fix: add `path="*"` redirect/not-found UI and a test for a persisted unknown path.

### Gaps / future work, not classified as confirmed bugs

- Projects, Automations, Squads, Skills, and their detail pages are reachable and have create/edit flows. Static inspection did not find an unreachable primary action in these surfaces.
- Settings explicitly says custom-field definitions are stored but task create/detail do not yet read/write them (`apps/desktop/src/renderer/src/features/settings.tsx:400`). This is disclosed missing functionality, not a hidden bug.
- The current patch intentionally removes the AI-assisted agent builder and model-key settings. Because the router redirects old builder URLs and the product invariants say unimplemented features remain allowed future work, absence alone is not classified as a bug in this audit.
- Agent creation sets the active session identity to the newly created agent before navigating to its detail (`apps/desktop/src/renderer/src/features/create-agent/manual-create-agent-page.tsx:113-116`). This may be surprising for a human creator, but intent is not documented strongly enough to call it a bug; product should decide whether “create” implies “act as”.
- Board drag/drop swallows `SetTaskStatus` failures and only invalidates queries (`apps/desktop/src/renderer/src/features/board.tsx:276-283`). It produces poor failure feedback, but without a reproduced rejection it is recorded as a robustness/UX gap.

### Test and verification observations

- `pnpm --filter @coordy/desktop typecheck` passed on the audited working tree.
- `pnpm --filter @coordy/desktop test` ran 121 tests: 118 passed, two daemon socket tests failed with sandbox `EPERM`, and `issue-create-dialog.spec.ts` timed out at 5 seconds in the full suite. A focused rerun of that renderer test passed in 4.316 seconds, showing it is close enough to the 5-second ceiling to be suite-load flaky rather than a deterministic product failure.
- Existing renderer tests are mostly pure helper/static-markup tests. There is no route-level test that performs runtime-card → agent-create selection, command-palette → new chat, workspace switch → agent selection, Home pinned-run controls, partial agent creation failure, or Stats/chat semantics.
- The runtime tests are worse than missing: current changed expectations explicitly require an `on_demand` runtime to be disabled, contrary to the repository runtime contract.

### Suggested repair order

1. Restore launch-state semantics and contract tests for `ready/on_demand/missing` (P0).
2. Bind Harness CTA to the chosen provider and make agent creation atomic/recoverable (P1).
3. Unify Home display/action run targeting (P1).
4. Exclude chat backing tasks consistently from My Tasks and user-visible issue Stats (P1, cross-layer).
5. Fix “新建聊天” semantics and reset explicit agent selections on workspace changes (P2).
6. Add wildcard recovery and route-level flow tests.

## Files Found

- `apps/desktop/src/renderer/src/app/router.tsx` — complete renderer route table and legacy redirects.
- `apps/desktop/src/renderer/src/shell/nav.ts` — visible sidebar and advanced navigation definitions.
- `apps/desktop/src/renderer/src/shell/app-sidebar.tsx` — sidebar navigation and global new-task entry.
- `apps/desktop/src/renderer/src/shell/nav-user.tsx` — actor switching and advanced-page reachability.
- `apps/desktop/src/renderer/src/shell/command-palette.tsx` — global navigation/create commands.
- `apps/desktop/src/renderer/src/state/layout-store.ts` — issue/chat overlay state and pending create focus.
- `apps/desktop/src/renderer/src/state/tab-store.ts` — persisted tab state with no route validation.
- `apps/desktop/src/renderer/src/lib/coordy/tab-path.ts` — tab replacement/open/close/title behavior.
- `apps/desktop/src/renderer/src/features/home.tsx` — ad-hoc run creation and progress controls.
- `apps/desktop/src/renderer/src/features/board.tsx` — user-visible task board/list and drag/drop status flow.
- `apps/desktop/src/renderer/src/features/pages.tsx` — Chat, My Tasks, Stats, and advanced product pages.
- `apps/desktop/src/renderer/src/features/floating-chat.tsx` — actual chat creation, send/run, archive, and dock behavior.
- `apps/desktop/src/renderer/src/features/runtimes.tsx` — Harness readiness grouping and provider CTAs.
- `apps/desktop/src/renderer/src/features/create-agent/manual-create-agent-page.tsx` — single current create-agent route and hydration.
- `apps/desktop/src/renderer/src/lib/coordy/labels.ts` — runtime selectability/readiness rules and visible-agent helpers.
- `apps/desktop/src/renderer/src/lib/coordy/start-task.ts` — multi-command agent/task/chat execution helpers.
- `apps/desktop/src/renderer/src/features/catalog-pages.tsx` — Projects, Automations, Skills, and Squads list/create surfaces.
- `apps/desktop/src/renderer/src/features/catalog-detail.tsx` — catalog detail edit flows and per-entity not-found UI.
- `apps/desktop/src/renderer/src/features/settings.tsx` — settings tabs and disclosed unsupported custom fields.
- `crates/coordy-kernel/src/product.rs` — chat backing-task creation and Stats aggregation semantics.
- `apps/desktop/src/renderer/src/test/create-agent.spec.ts` — current runtime readiness expectations, including the contract-inverting regression.
- `apps/desktop/src/renderer/src/test/board.spec.ts` — separate coverage for My Tasks assignment and Board chat filtering.
- `.trellis/spec/backend/runtime-integration-contracts.md` — authoritative ready/on-demand/missing UI contract.

## Code Patterns

- Workspace-scoped queries use actor-aware `view(...)` and structural query keys (`apps/desktop/src/renderer/src/features/pages.tsx:70-76`).
- Collection/detail catalogs correctly display a not-found state only after the workspace query is fetched (`apps/desktop/src/renderer/src/features/catalog-detail.tsx:301-321`, `:451-468`, `:524-543`).
- Chat is implemented as a private chat record backed by a hidden kernel task (`crates/coordy-kernel/src/product.rs:1377-1414`); every task-derived projection must therefore explicitly choose whether chat tasks belong.
- Multi-step renderer helpers submit separate kernel commands without transactions (`apps/desktop/src/renderer/src/lib/coordy/start-task.ts:24-52`, `apps/desktop/src/renderer/src/features/issue-create-dialog.tsx:234-273`). Failure behavior must be tested at every command boundary.
- Page-level selection state often stores raw entity IDs locally (`apps/desktop/src/renderer/src/features/home.tsx:62-69`, `apps/desktop/src/renderer/src/features/pages.tsx:925-927`); workspace changes require normalization against the new entity list.

## External References

- None. This audit used repository code, tests, and the repository's Trellis runtime contract only; no external/version-sensitive behavior was needed.

## Related Specs

- `.trellis/spec/backend/runtime-integration-contracts.md` — launch-state and UI selectability contract; directly violated by the current on-demand behavior.
- `.trellis/spec/guides/cross-layer-thinking-guide.md` — requires mapping source → transform → display and testing null/empty/round-trip boundary behavior; relevant to hidden chat task projections and multi-command creation flows.
- `AGENTS.md` — product kernel boundaries and product intent; renderer must not invent authority or runtime contracts.

## Caveats / Not Found

- This was a source/test audit, not a full Electron visual runtime walkthrough. Concrete defects above are based on deterministic state/control flow and include reproduction sequences; layout, focus, TCC, and OS-native behavior still need real-app verification after repair.
- The worktree was actively changing during the audit: status grew from the dispatched “33 pre-existing changes” note to 36 entries. No product code, spec, task PRD, or git state was modified by this research agent.
- Two full-suite daemon failures were sandbox permission failures, not attributed to product behavior. The dialog timeout passed alone and is reported as flakiness evidence, not a confirmed UI defect.
- No deletion/archive controls were found for Projects, Automations, Skills, or Squads. Whether deletion is required by the current acceptance criteria is not documented, so this is not classified as a bug.
