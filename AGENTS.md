# Coordy implementation invariants

- Treat `.local-specs/coordy-execution-agent-prompt.md`,
  `.local-specs/coordy-validation-plan.md`, and the operator-supplied local
  research report as execution context. `.local-specs/` is private and must
  never be staged or committed.
- S0a is deterministic evidence infrastructure only. Rules may parse events,
  enumerate opportunities, verify tool facts, and rank candidates; they may
  not infer state loss, causality, failure type, or prevalence.
- S0b semantic grading must cover every compaction opportunity with an
  outcome-blinded State Diff. Stronger causal judges run only after state
  grading and may count an engineering consequence only from program-verified
  Git/test/tool/patch/replay evidence.
- Machine judges produce prelabels, not ground truth. Independent judging,
  evidence-ID validation, readable human calibration, and fail-closed artifact
  lineage are required before any Screening decision.
- Keep original Codex history read-only. Persist only redacted excerpts, hashed
  identities, safe structured facts, and SHA-256/run-ID provenance. Unknown,
  changing, mixed, or tampered inputs fail closed.
- Goal descendants are observations within a Goal-root cluster, not independent
  long tasks. `goal_time_used_seconds` is observed Codex Goal time, not a human
  task-duration or METR-horizon claim.
- Screening may emit only `STOP`, `PIVOT`, or `PROCEED_TO_CONFIRMATION`; it may
  never emit `GO`.

## Scope and stopping rule

Coordy is currently a low-cost falsification experiment, not a production
platform. Apply instructions in this order:

1. The user's explicit current request.
2. The current phase's frozen acceptance criteria.
3. Data-safety and experimental-validity invariants above.
4. Optional robustness and future extensibility.

Lower-priority concerns must not expand a higher-priority task. Implement the
smallest complete change that satisfies the frozen acceptance criteria, run the
matching real validation, and stop when those criteria pass.

Do not add automatic retries, compatibility layers, provider abstractions,
distributed recovery, migration frameworks, or production hardening unless a
failure on the current approved path demonstrates the need. A smoke test or
research probe must not be designed as a production service.

Review findings block the current task only when they show a reproducible
failure on the approved path that would make the present result unsafe,
incorrect, or unauditable. Record theoretical, future-deployment, or inactive-
path risks as follow-ups instead of expanding the current implementation.

If a proposed change would materially expand the approved scope, report the
evidence and ask before implementing it. Do not create a shared abstraction
without at least two current, concrete consumers.
