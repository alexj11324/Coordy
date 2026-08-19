# Audit and repair desktop app flows

## Goal

Systematically traverse Coordy's user-visible desktop flows, repair every reproducible current-flow defect found in this audit, and leave an automated regression suite that catches the same classes of breakage without requiring a full manual walkthrough.

## User value

Normal user journeys should not dead-end, target the wrong entity, expose hidden implementation records, or fail because adjacent layers disagree. Future changes should fail an automated flow gate before the user has to discover them manually.

## Confirmed facts

- The renderer exposes Home, Inbox, Chat, My Tasks, Board/task detail, Graph, Projects, Automations, Agents, Squads, Stats, Harnesses, Skills, Settings, Runs, Principals, Authority, Memory, Contracts, Dependencies, and Conflicts.
- The production desktop build and TypeScript checks pass on the current working tree.
- The desktop suite currently has 121 tests, but almost all are helper-level; there is no Electron + real daemon golden flow.
- The current worktree has substantial pre-existing uncommitted product work. It must be preserved, reviewed as part of the live behavior, and committed only when a child concern is complete and verified.
- Research reports identify deterministic defects with reproduction paths in `research/renderer-flow-audit.md`, `research/ipc-runtime-audit.md`, and `research/test-flow-audit.md`.

## Requirements

### R1. Runtime and agent creation consistency

- `ready` and validated `on_demand` runtimes are selectable; only `missing` runtimes are disabled.
- A Harness-card create action preselects the Harness the user clicked.
- Agent creation is atomic from the user's perspective: a failed configuration step must not leave a partial agent that blocks retry.
- Model discovery follows the concrete discovered transport, not only the canonical provider ID.
- Registry refresh retains a usable cached catalog when the network refresh fails and reports freshness truthfully.

### R2. Core product-flow consistency

- Home displays, opens, and cancels the same run.
- Hidden chat backing tasks do not appear as user issues in My Tasks or issue statistics.
- “New chat” enters a genuine new-conversation state rather than reopening the previous chat.
- Explicit agent selection is normalized on workspace changes and never silently dispatches to another agent.
- Unknown or stale routes render a recoverable destination instead of an empty shell.

### R3. Desktop process and IPC reliability

- Opening a terminal passes the directory as literal argv with no shell interpretation.
- Health/effect polling cannot cancel an unrelated foreground RPC on a shared socket.
- An unexpected local-daemon exit is detected and recovered with a bounded restart; intentional shutdown does not restart it.
- Closing/reopening the last macOS window and closing the last non-macOS window follow native lifecycle expectations and clean up the daemon/poller exactly once.
- The documented development command builds Rust once.

### R4. Automated flow evidence

- Add a route/bridge flow matrix for every declared collection/detail route, legacy redirect, unknown route, bootstrap success/failure, and retained IPC boundary.
- Add mutation-focused tests for agent creation, issue creation/start, task actions, chat, project, automation, squad, Skill, and workspace switching.
- Add one Electron + real `coordyd` golden smoke using isolated temporary state and a deterministic maintained stub/runtime.
- Stabilize the existing mounted issue-dialog test so the full suite is a reliable gate.
- Produce a machine-readable flow inventory that maps entry, action, expected outcome, and verification owner.

## Acceptance criteria

- [ ] Every confirmed defect in the three audit reports is either fixed with a regression test or explicitly reclassified with contrary runtime evidence.
- [ ] Runtime spec, README, discovery output, renderer behavior, and tests agree on `ready` / `on_demand` / `missing`.
- [ ] The full desktop unit/component suite passes outside the socket-restricted sandbox with no flaky timeout.
- [ ] Rust workspace tests, protocol verification, formatting, and clippy pass for affected crates.
- [ ] The production desktop build and typecheck pass.
- [ ] The automated Electron golden flow completes from bootstrap through agent, issue, run, observable completion, and clean shutdown.
- [ ] A real macOS app run verifies visible startup, primary navigation, close/reopen, and quit/daemon cleanup.
- [ ] No unrelated pre-existing change is discarded; commits are scoped by child task and `git status --short` is reported.

## Child task map

1. `08-19-repair-runtime-agent-flows` — R1.
2. `08-19-repair-core-product-flows` — R2.
3. `08-19-repair-desktop-ipc-lifecycle` — R3.
4. `08-19-automate-desktop-flow-coverage` — R4 and final cross-child regression gate.

The final automation child runs after the three behavior-fix children; each earlier child must add focused regression tests before it is considered complete.

## Out of scope

- Redesigning the entire renderer-to-kernel actor authentication model. The audit's renderer-asserted-daemon finding requires a separate threat-model and protocol migration decision.
- Claiming exhaustive proof over every OS, every third-party CLI version, every network failure, or every possible input. The deliverable is exhaustive coverage of the declared route/action matrix plus representative boundary and failure injections.
- New product features or visual redesign not needed to repair a confirmed flow.
- Production retries, provider abstractions, or migrations that are not required by a reproduced failure.

## Open questions

None. Product intent is resolved by the user's request to cover all normal app flows and by existing repository contracts. Implementation still requires the user's explicit approval of this final plan.
