# Coordy Protocol v1

Frozen before inspecting any locked-test result.

## Highest-priority low-cost screening override

Execution begins with Screening S0, not the full confirmatory pipeline. Screening may output only `STOP`, `PIVOT`, or `PROCEED_TO_CONFIRMATION`; it must never output `GO`. The detailed H1-H10 thresholds below remain frozen for later confirmatory validation and are not claims that those experiments have run.

## Questions

1. Does persistent structured state reduce consequential single-agent drift after compaction?
2. Does the same mechanism detect external changes that invalidate another session's active plan?
3. Do measured benefits exceed state, retrieval, alert, and interruption costs?

Temporal State Consistency and Cross-Agent Coordination receive separate `GO`, `PIVOT`, `STOP`, or `INSUFFICIENT_EVIDENCE` decisions.

## Failure taxonomy

- Type A: context loss changes a later decision without a relevant external change.
- Type B: an external change invalidates a once-valid plan and the executor continues from stale assumptions.
- Type C: both external invalidation and context loss are necessary causes.
- Type D: ordinary reasoning or implementation failure despite complete correct state.
- Type U: evidence is incomplete; excluded from confirmatory effect estimates.

Context loss alone is not a failure. It must have a traceable engineering consequence.

## Invariants

1. Sources are read-only and hashed; live SQLite requires an official export or consistent backup before ingestion.
2. Unknown schemas, timestamp conflicts, and incomplete causal chains fail closed.
3. Candidate signals are not labels.
4. Replay input is restricted to events and repository state visible at the registered cutoff.
5. Retrospective outcomes never enter contemporaneous replay inputs.
6. Development and locked test cases are separated by session, task cluster, and repository where possible.
7. Native, strongest simple baseline, structured state, and structured state plus minimal retrieval receive equal model and tool budgets.
8. Goal Reinjection, Better Compaction, Periodic Checkpoint, Generic Memory, and cutoff-only Full Transcript are serious baselines.
9. `INSUFFICIENT_EVIDENCE` is mandatory before confirmatory replay and engineering-value measurement.
10. Raw transcript content and credentials are never written to reports.

## Primary analysis

The primary comparison is Structured State plus Minimal Retrieval versus the strongest simple baseline selected on the development set. Report paired effect sizes, 95% confidence intervals, per-case distributions, failure-type breakdowns, and clustered uncertainty where multiple cases share a session.

## Source-material status

The named report `多人协作智能体：现有技术缺口分析与创业结论.md` was not present when this protocol was frozen. Execution continues, and the report is not treated as experimental ground truth.
