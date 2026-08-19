# Automate desktop golden flow coverage

## Goal

Replace the current helper-heavy confidence gap with fast route/mutation tests and one reproducible Electron + real-daemon golden flow.

## Dependencies

Run after the three behavior-repair children so tests encode final intended behavior.

## Requirements

- Maintain a machine-readable route/action/outcome matrix covering all visible product areas and retained IPC methods.
- Add renderer route and mutation tests with a typed, stateful fake bridge for deterministic failure injection.
- Add main/preload handler contract tests for every retained bridge method; remove dead methods only when repository usage and product intent prove they are obsolete.
- Add a Playwright Electron smoke using isolated temporary user data and real `coordyd` with the maintained deterministic stub/runtime.
- Golden path: bootstrap workspace/principal -> create configured agent -> create/assign issue -> start run -> observe terminal activity/completion -> navigate relevant detail -> clean quit and prove child termination.
- Stabilize the issue-dialog test below one second without increasing the timeout as the first remedy.

## Acceptance criteria

- [ ] Every declared route, legacy redirect, missing detail, and unknown route has an executable assertion.
- [ ] Agent, issue/run, chat, project, automation, squad, Skill, stats, settings/bootstrap, workspace-switch, and task-action mutations have success and representative failure assertions.
- [ ] Every retained preload method is covered through the guarded main handler success/error boundary.
- [ ] Golden Electron flow passes from a clean isolated state and leaves no daemon process or test data behind.
- [ ] Full desktop tests pass repeatedly with no timeout flake; typecheck/build also pass.
- [ ] Flow inventory links each row to its owning automated test or explicit real-runtime check.

## Out of scope

- Exhaustive third-party CLI compatibility testing.
- Screenshot pixel-diff infrastructure unless a reproduced layout regression requires it.

## Open questions

None.
