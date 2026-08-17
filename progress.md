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

## Outputs

- `protocol/protocol_v1.md`
- `protocol/hypotheses_v1.json`
- `protocol/metrics_v1.json`
- `protocol/decision_thresholds_v1.json`
- `protocol/screening_v1.json`
- Runtime discovery manifests are written below an ignored workspace.

## Data counts

- Active rollout JSONL: 2,630 files discovered.
- Archived rollout JSONL: 696 files discovered.
- Candidate source interfaces: 5.
- Indexed sessions: 0 (Phase 0B not executed).
- S0 eligible sessions: 100 across 20 hashed repository identities; 50 contain an explicit compaction marker.
- S0 corrected scan: 217 files inspected, 31 auxiliary approval-reviewer sessions excluded, 100 eligible sessions, and 0 parse errors.
- Candidate population: 301 raw signals and 159 unique signal episodes.
- Review sample: 30 episode-diverse, frozen-prefix-verified evidence cards; 129 additional unique episodes remain outside the cap.
- Structural candidates within the sample: 26; highest-ranked user review queue: 12.
- All cases remain `uncertain`; `decision` is `null` and the frozen S0 decision gates have not yet been evaluated.
- Authoritative ignored runtime workspace: `.coordy/screening-s0-v8/data/screening/`.

## Failures or missing evidence

- Source report `多人协作智能体：现有技术缺口分析与创业结论.md` is absent.
- No historical events have been ingested or indexed.
- Official App Server v2 schema exposes `thread/list`, `thread/read`, and explicit compaction events, but a read-only runtime connection was not verified; starting a new server would initialize Codex state and was rejected for this phase.
- No cases, replays, or independent model evaluations have run.
- The earlier seven-case `STOP` was invalid: raw signals had been capped before episode deduplication, so duplicate-heavy episodes hid unseen unique episodes. That conclusion is retracted.
- Structural cards are not yet confirmed causal Decision Points and do not replace complete repository cutoff manifests.
- The one-repository concentration check is an explicit PIVOT heuristic, not proof that a narrow scenario is high-value.
- S1–S3 and confirmatory validation have not run because S0 awaits user review and adjudication.

## Next

Collect one `YES`/`NO`/`UNCERTAIN` answer for each of the 12 frozen review
cases, then run S0 adjudication. Proceed to causal case construction only if
the frozen prevalence gates pass; do not proceed directly to S1.

## Early-stop status

`PENDING_USER_REVIEW` — 12 episode-diverse cases require user confirmation.
Screening may later emit only `STOP`, `PIVOT`, or `PROCEED_TO_CONFIRMATION`.
