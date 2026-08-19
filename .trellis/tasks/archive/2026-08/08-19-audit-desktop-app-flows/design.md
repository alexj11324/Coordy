# Design: whole-app flow repair program

## Boundary map

Visible action -> renderer state/component -> typed preload bridge -> Electron main IPC -> `DaemonClient` -> `coordyd` -> kernel/harness -> view/effect -> renderer query invalidation.

Each fix belongs to the earliest boundary that owns the incorrect fact:

- Runtime readiness and concrete transport are protocol/discovery facts, projected once into UI.
- Atomic entity creation belongs to the kernel command boundary.
- Hidden chat-task semantics belong to kernel projections plus renderer filters.
- Process launch and child lifecycle belong to Electron main.
- Golden-flow verification spans the complete boundary without replacing focused unit tests.

## Task decomposition

The parent owns the full flow inventory, shared acceptance criteria, cross-child consistency, final runtime acceptance, and final status. Four child tasks own independently testable changes and commits.

## Data-safety and compatibility

- Existing user state remains readable; command additions use optional/defaulted fields where wire compatibility matters.
- No agent private memory is uploaded and no authority decision moves into Electron.
- Temporary E2E state uses an isolated directory and is removed only after validating its exact path.
- Existing uncommitted changes are treated as user-owned baseline and reviewed before staging.

## Rollback shape

Each child is committed separately. A child can be reverted without reverting the audit reports or other repaired boundaries. The golden-flow child contains test infrastructure and only the minimal product hooks required for stable automation.
