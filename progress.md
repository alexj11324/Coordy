# Coordy validation progress

## Current phase

Low-cost Screening S0 evidence review is pending. No Screening decision has
been emitted.

## Completed

- Pulled PR #1 (`agent/initial-validation-harness`).
- Froze H1-H10, metrics, decision thresholds, and the default `INSUFFICIENT_EVIDENCE` decision.
- Froze the higher-priority Screening S0-S3 gates; Screening cannot output `GO`.
- Added bounded read-only discovery for the official Codex App Server, CLI, rollout JSONL, and thread-history SQLite schema.
- Added fail-closed and no-transcript-persistence contract tests.
- Ran discovery against Codex CLI 0.147.0 and selected `codex_rollout_jsonl_v1`.
- Ran bounded S0 after excluding the current validation session.
- Excluded approval-reviewer/guardian auxiliary sessions and stopped treating `turn_context.summary=auto` as a compaction boundary.
- Generated local 0600 evidence cards with cutoff-safe and retrospective evidence kept separate; tool arguments, outputs, and compaction-summary bodies are withheld.
- Corrected candidate selection to deduplicate by frozen source and compaction episode before applying the 30-card cap.
- Bound scan, evidence-card, review-queue, and adjudication artifacts with a scan-run identity and SHA-256 checks.
- Left A/B/C unclassified at S0 until external-change exclusions and a causal state-loss chain are reconstructed.
- Added a frozen S0 sampling amendment that prioritizes measured two-hour-plus Goals without changing any decision gate.
- Added read-only Goal-catalog discovery, parent-thread lineage, Goal-balanced session/candidate sampling, and first-session-meta identity locking.

## Outputs

- `protocol/protocol_v1.md`
- `protocol/hypotheses_v1.json`
- `protocol/metrics_v1.json`
- `protocol/decision_thresholds_v1.json`
- `protocol/screening_v1.json`
- `protocol/screening_sampling_amendment_v2.json`
- Runtime discovery manifests are written below an ignored workspace.

## Data counts

- Active rollout JSONL: 2,630 files discovered.
- Archived rollout JSONL: 696 files discovered.
- Candidate source interfaces: 5.
- Indexed sessions: 0 (Phase 0B not executed).
- Goal catalog: 38 total Goals; 7 lasted at least 7,200 seconds, including 6 over 6 hours.
- All 7 multi-hour Goal roots linked to rollout history, yielding 204 root/descendant rollout files.
- S0 selected 100 Goal-lineage sessions using root-balanced sampling: 7 independent Goal roots and 93 descendants across 4 hashed repository identities.
- Candidate population: 370 raw signals and 230 unique signal episodes after excluding injected Goal context before signal matching.
- Review sample: 30 Goal-balanced, episode-diverse, frozen-prefix-verified evidence cards spanning all 7 Goal roots; 200 additional unique episodes remain outside the cap.
- Structural candidates within the sample: 17; the reviewable queue contains 10 cases spanning 5 Goal roots.
- All cases remain `uncertain`; `decision` is `null` and the frozen S0 decision gates have not yet been evaluated.
- Authoritative ignored runtime workspace: `.coordy/screening-s0-v17/data/screening/`.

## Failures or missing evidence

- Source report `多人协作智能体：现有技术缺口分析与创业结论.md` is absent.
- No historical events have been ingested or indexed.
- Official App Server v2 schema exposes `thread/list`, `thread/read`, and explicit compaction events, but a read-only runtime connection was not verified; starting a new server would initialize Codex state and was rejected for this phase.
- No cases, replays, or independent model evaluations have run.
- The earlier seven-case `STOP` was invalid: raw signals had been capped before episode deduplication, so duplicate-heavy episodes hid unseen unique episodes. That conclusion is retracted.
- Structural cards are not yet confirmed causal Decision Points and do not replace complete repository cutoff manifests.
- Only 7 independently timed multi-hour Goals exist locally; the other 93 selected rows are explicitly clustered lineage sessions and cannot be treated as 100 independent long tasks.
- The one-repository concentration check is an explicit PIVOT heuristic, not proof that a narrow scenario is high-value.
- S1–S3 and confirmatory validation have not run because S0 awaits user review and adjudication.

## Next

Collect one `YES`/`NO`/`UNCERTAIN` answer for each of the 10 Goal-backed review
cases, then run S0 adjudication. Proceed to causal case construction only if
the frozen prevalence gates pass; do not proceed directly to S1.

## Early-stop status

`PENDING_USER_REVIEW` — 10 Goal-backed, episode-diverse cases require user confirmation.
Screening may later emit only `STOP`, `PIVOT`, or `PROCEED_TO_CONFIRMATION`.
