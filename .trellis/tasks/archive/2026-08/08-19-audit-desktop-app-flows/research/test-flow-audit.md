# Research: desktop test and runnable-flow audit

- Query: Which Coordy desktop workflows are actually verified, which tests are stale or too shallow to prove a workflow, and which minimum checks are most likely to expose real bugs?
- Scope: internal
- Date: 2026-08-19

## Findings

### Executive result

The desktop currently has broad **helper/unit coverage**, but almost no executable coverage of the app workflows advertised in the README. The suite has 21 spec files and 121 tests at this snapshot, yet its default environment is Node (`apps/desktop/vitest.config.ts:3-7`). Only `issue-create-dialog.spec.ts` opts into jsdom and mounts a page-level component (`apps/desktop/src/renderer/src/test/issue-create-dialog.spec.ts:1-8,24-94`). There is no test that starts Electron, boots `coordyd`, walks the router, creates a workspace/principal, creates an agent, creates/assigns an issue, starts a run, or observes completion.

This means typecheck/build and most green unit tests prove module consistency, not that the README workflow works end to end.

### What is verified today

| Area | Evidence actually exercised | Confidence boundary |
|---|---|---|
| Daemon socket client | Real temporary Unix socket tests cover handshake timeout, disconnect, and reconnect (`apps/desktop/src/main/test/daemon-client.spec.ts:16-102`). | Useful integration evidence for the client only; does not launch `coordyd` or Electron. |
| Effect polling | Mock-client tests cover serialization, reconnect, cooldown, and recovery (`apps/desktop/src/main/test/effect-poller.spec.ts:4-170`). | Poller state machine only; no `BrowserWindow` delivery or React invalidation. |
| Main-process security helpers | Sender URL, CSP, preload resolution, external-link allowlist (`apps/desktop/src/main/test/ipc-security.spec.ts:9-89`). | Handler registration and real preload-to-main calls are not exercised. |
| Model discovery | Parsers and a fake selected CLI are exercised (`apps/desktop/src/main/test/model-discovery.spec.ts:16-139`). | No UI selection -> IPC -> discovered runtime -> model catalog round trip. |
| Graph | Projection, command construction, delta revision, and health-label helpers are covered. | No graph page mount, selection, submit, stream event, or recovery flow. |
| Board/issues | View parsing, filtering, labels, run command construction, and chat-task filtering are covered (`apps/desktop/src/renderer/src/test/board.spec.ts:19-175`). | The board/task pages and their mutations are not mounted. |
| Issue composer | One jsdom test proves an attached filename survives manual -> agent -> manual mode switching (`issue-create-dialog.spec.ts:24-94`). | It never clicks Create and `submit` is only an unused mock (`issue-create-dialog.spec.ts:36-45`); it proves no task-creation path. |
| Agent creation | Draft reducers/storage, catalog partitioning, static markup for runtime controls, icon-map coverage, and error classification are tested (`apps/desktop/src/renderer/src/test/create-agent.spec.ts`). | `ManualCreateAgentPage` is never mounted; discovery, model fetch, submit, error rendering, draft clearing, session update, and navigation are unverified. |
| Catalogs/shell | Labels, starter constants, tab/history helpers, shortcuts, and route-title helpers are covered. | Projects, automations, squads, skills, stats, sidebar navigation, and detail-page mutations are not mounted. |
| Build/type system | `pnpm --filter @coordy/desktop typecheck` and `build` passed on 2026-08-19. | Build success does not exercise an Electron window or daemon-backed workflow. |

### High-priority bug candidates exposed by the gaps

#### P0 — terminal-opening IPC is shell-injection prone and has no test

`openTerminalAt` receives a renderer-provided path, escapes only double quotes, interpolates the value into shell command strings, and executes the result with `child_process.exec` (`apps/desktop/src/main/index.ts:127-134,234-251`). Backticks, `$()`, backslashes, newlines, and platform shell metacharacters remain active. A repository directory name is sufficient input to this path from Task Detail (`apps/desktop/src/renderer/src/features/task-detail.tsx:511-520`). No test mentions `openTerminal` beyond asserting the IPC constant exists.

Minimum proof/fix gate: extract a platform argv builder and use `spawn`/`execFile` with `shell: false`; test paths containing spaces, quotes, `$()`, backticks, semicolons, and newlines. Then invoke the handler with a temporary directory and a fake launcher.

#### P0 — Electron window lifecycle is incomplete

The main process creates one window after daemon startup and registers only `before-quit` cleanup (`apps/desktop/src/main/index.ts:96-103,200-225`). There is no `activate` handler to recreate a closed macOS window and no `window-all-closed` handler to quit on Windows/Linux. Likely symptoms are a macOS dock app that will not reopen after its only window is closed, and a headless non-macOS process/daemon that remains alive after the window closes. No Electron lifecycle test exists.

Minimum proof/fix gate: first reproduce with the real app on the target OS; then isolate lifecycle registration behind testable callbacks and assert (a) `activate` creates a window only when none exist, (b) non-darwin `window-all-closed` quits, and (c) daemon/poller stop exactly once on quit.

#### P0 — README promises conflict with runtime policy and tests

README says Coordy “can also launch compatible ACP agents on demand” (`README.md:18-20`) while the same README says every Registry entry without a local executable is Not installed and cannot be selected (`README.md:81`). The active runtime spec defines `on_demand` as executable via an available package runner and requires UI tests for ready/on-demand selectability (`.trellis/spec/backend/runtime-integration-contracts.md:14-22,47-53`). Current UI tests instead explicitly disable an `on_demand` runtime and group it as uninstalled (`apps/desktop/src/renderer/src/test/create-agent.spec.ts:259-343`), and the board test now expects only locally installed runtimes (`apps/desktop/src/renderer/src/test/board.spec.ts:87-103`).

This is not just missing coverage; the documentation/spec/test oracles disagree, so a green suite cannot define correct behavior. Freeze one policy before repairing code.

#### P1 — unknown routes render no recovery path

`AppRouter` enumerates routes but has no wildcard/not-found route or redirect (`apps/desktop/src/renderer/src/app/router.tsx:54-113`). A stale bookmark, bad deep link, or renamed route can therefore leave the user inside the shell without useful content. Existing “catalog routes” tests only call `titleFromPath`/`navItemActive`; they never render `AppRouter`.

Minimum proof/fix gate: a MemoryRouter route matrix covering every declared route, each legacy redirect, a missing detail ID, and `*` -> visible not-found/home recovery.

#### P1 — first-launch bootstrap is a single untested all-or-nothing effect

`App` calls a private `bootstrap()` that checks Health, chooses/creates the first workspace, chooses/creates the first principal, and mutates global session state (`apps/desktop/src/renderer/src/app.tsx:10-31,55-78`). Any failure renders a terminal error screen without retry (`app.tsx:32-45`). No test imports `App`, `bootstrap`, `CreateWorkspace`, or `CreatePrincipal`.

Minimum proof/fix gate: test existing-data, empty-data, failure-at-each-step, duplicate/retry, and unmount/subscription cleanup paths. Add a user-visible retry only if the reproduced failure requires it.

#### P1 — stale IPC surface is “covered” by constant equality, not behavior

The preload still exposes `secretsStatus`, `setSecret`, `clearSecret`, `completeDraft`, `importAgents`, and `listDirectory` (`apps/desktop/src/preload/index.ts:5-29`), but current renderer search finds no consumers for those APIs. The named “product ipc channels” test merely asserts hard-coded string constants (`apps/desktop/src/main/test/ipc-security.spec.ts:68-79`). This is tautological as workflow proof and can keep dead handlers/types alive after the AI-builder/settings/import flows were deleted from the current diff.

Minimum proof/fix gate: generate a bridge/handler coverage table, delete truly unused channels after confirming product intent, and integration-test every retained method from preload invocation through guarded handler result/error.

#### P1 — issue-create component test is slow and flaky

The only mounted renderer test took 4.435s in the first sandboxed full run, timed out at Vitest's 5s limit in the unsandboxed full run, then passed alone in 3.645s. It performs dynamic imports and multiple async `act` calls (`issue-create-dialog.spec.ts:48-93`). This creates a nondeterministic red suite without increasing workflow coverage.

Minimum gate: make module/store reset deterministic, avoid time-based waits, and keep this interaction under 1s before adding more DOM flows.

#### P2 — development entrypoint compiles Rust twice

The documented `bash scripts/dev.sh` performs `cargo build` and then invokes the desktop `dev` script (`scripts/dev.sh:1-6`); `apps/desktop/scripts/dev.mjs` performs the same Cargo build again before starting electron-vite (`apps/desktop/scripts/dev.mjs:29-36`). This is a reproducible workflow mismatch/waste and can make startup look hung.

Minimum gate: choose one owner for the build and smoke the documented command once.

### README workflow versus executable evidence

README's typical flow is workspace -> import/create agent -> decompose issues/dependencies -> assign/start -> observe -> review/retry/automation (`README.md:33-42`). Current evidence by step:

1. Workspace bootstrap: implemented, no test.
2. Import/create agent: helpers and catalog parser tests only; no successful UI mutation. `importAgents` has no renderer consumer.
3. Create issues/dependencies: one attachment-retention test plus command helpers; no creation/submit path.
4. Assign/start: command objects are compared to literals, but not sent through IPC/kernel.
5. Observe: activity and graph transformation helpers only; no subscription -> query invalidation -> UI update.
6. Review/retry/automation: label/starter helpers only; no page interaction or daemon result.

### Tests that should not be treated as workflow proof

- IPC constant equality (`ipc-security.spec.ts:68-79`) proves spelling, not bridge/handler compatibility.
- Static catalog/starter assertions (`catalog.spec.ts:73-125`) mostly lock literal arrays/copy; they do not prove create/fire/detail flows.
- SSR string/regex assertions for RuntimePicker/HarnessDropdown (`create-agent.spec.ts:259-309`) prove initial markup but not selection, keyboard behavior, async discovery, submit-time revalidation, or error UI.
- `chatTurnCommands(...)` equality (`board.spec.ts:155-174`) proves intended ordering in a helper, not that partial command failure is surfaced or recovered.
- Route title/active-item helpers (`catalog.spec.ts:115-125`) do not prove the corresponding route component renders.

These tests can remain useful low-level guards, but their names/reporting should not be used to claim the app flow is verified.

### Prioritized minimal verification plan

1. **Freeze the runtime oracle first:** decide whether validated `on_demand` ACP entries are selectable. Align runtime spec, README, discovery output, renderer predicates, and tests before judging any harness flow.
2. **Repair the concrete P0 boundary:** replace shell-string terminal launch with argv-based process launch and add hostile-path tests.
3. **Add one real golden desktop smoke:** isolated temporary userData; launch Electron + real `coordyd`; assert window visible, workspace/principal created, one locally runnable stub discovered, agent created, issue created/assigned, run started, terminal completion/activity visible, then quit and prove daemon termination. This single path materially covers the advertised product spine.
4. **Add a renderer route smoke matrix:** mount `App`/`AppRouter` with a typed fake bridge and cover every collection/detail path, redirects, unknown route, and initialization error/retry.
5. **Add four mutation-focused component tests:** create agent; create manual issue with attachment; agent-assisted issue/start run; task detail comment/retry/status. Assert exact bridge envelopes, visible failures, cache invalidation, and navigation.
6. **Add catalog mutation tests:** project, automation, squad, and skill create/edit/fire flows; stats remains read-only but must render empty and populated states.
7. **Add IPC integration coverage:** retained preload method -> guarded main handler -> typed success/error. Include choose/reveal/open/list path boundaries and runtime/model discovery.
8. **Stabilize the existing jsdom test**, then make the full suite a reliable gate. Do not raise the timeout as the first fix.
9. **Runtime acceptance:** after tests, run `bash scripts/dev.sh` once and manually verify close/reopen/quit, first launch, deep links, and the golden workflow using a real local CLI or maintained ACP stub.

### Commands and observed results

- `pnpm --filter @coordy/desktop typecheck` — passed.
- `pnpm --filter @coordy/desktop build` — passed; production renderer bundle built.
- `pnpm --filter @coordy/desktop test` inside sandbox — initially 3 failures: two Unix socket `EPERM` sandbox failures plus one concurrently stale runtime-selection expectation. The socket tests passed when rerun outside sandbox.
- Full test outside sandbox after concurrent edits — 120/121 passed; `issue-create-dialog.spec.ts` timed out at 5s.
- Isolated `issue-create-dialog.spec.ts` rerun — passed in 3.645s, confirming flakiness/slowness rather than a stable functional failure.

## Files Found

- `README.md` / `README.zh-CN.md` — advertised product workflow, runtime claims, documented dev/test commands.
- `scripts/dev.sh` — documented root startup wrapper; duplicates Cargo build.
- `apps/desktop/scripts/dev.mjs` — actual desktop dev launcher and second Cargo build.
- `apps/desktop/vitest.config.ts` — Node-default unit-test scope; no Electron/E2E project.
- `apps/desktop/src/renderer/src/app.tsx` — first-launch bootstrap and effect subscription.
- `apps/desktop/src/renderer/src/app/router.tsx` — complete route table, redirects, no wildcard.
- `apps/desktop/src/main/index.ts` — window creation, IPC handlers, poller, lifecycle, and unsafe terminal shell construction.
- `apps/desktop/src/preload/index.ts` / `src/shared/desktop-bridge.ts` — renderer API surface, including apparently unused methods.
- `apps/desktop/src/main/test/*.spec.ts` — socket/poller/security/directory/model helper coverage.
- `apps/desktop/src/renderer/src/test/*.spec.ts` — primarily pure helper tests; one jsdom component test.
- `.trellis/spec/backend/runtime-integration-contracts.md` — active runtime truth and required cross-layer/UI test matrix.
- `apps/desktop/AGENTS.md` — desktop product/provider/model invariants.

## External References

None. This audit used repository code, tests, specs, README claims, and local command results only.

## Related Specs

- `.trellis/spec/backend/runtime-integration-contracts.md`
- `apps/desktop/AGENTS.md`
- Root `AGENTS.md` execution-quality and runtime-acceptance rules supplied in task context.

## Caveats / Not Found

- The active task PRD is still entirely `TBD` and task status is `planning`; there are no frozen acceptance criteria to audit against (`.trellis/tasks/08-19-audit-desktop-app-flows/prd.md`). Findings therefore use README product claims plus current code/spec invariants as the provisional oracle.
- The worktree had 20+ pre-existing modified/untracked paths and was being edited concurrently during this audit. One runtime-selection test changed from failing to passing between runs. Treat line citations and counts as a 2026-08-19 snapshot and re-run after the main implementation lane settles.
- No real Electron window was launched in this research lane, so window lifecycle findings are code-backed bug candidates requiring runtime reproduction before declaring the symptom confirmed.
- No product code was edited. Only this research file was written.
