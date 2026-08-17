# Coordy validation progress

## Current phase

Low-cost Screening S0; bounded prevalence mining complete, evidence review pending.

## Completed

- Pulled PR #1 (`agent/initial-validation-harness`).
- Froze H1-H10, metrics, decision thresholds, and the default `INSUFFICIENT_EVIDENCE` decision.
- Froze the higher-priority Screening S0-S3 gates; Screening cannot output `GO`.
- Added bounded read-only discovery for the official Codex App Server, CLI, rollout JSONL, and thread-history SQLite schema.
- Added fail-closed and no-transcript-persistence contract tests.
- Ran discovery against Codex CLI 0.147.0 and selected `codex_rollout_jsonl_v1`.
- Ran bounded S0 after excluding the current validation session.

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
- S0 eligible sessions: 100 across 18 hashed repository identities.
- S0 candidate decision points: 30 across 13 sessions; all remain `uncertain`.
- S0 scan: 103 files inspected, 219,649,329 bytes accepted, 14 truncated rollouts, 0 parse errors.

## Failures or missing evidence

- Source report `多人协作智能体：现有技术缺口分析与创业结论.md` is absent.
- No historical events have been ingested or indexed.
- Official App Server v2 schema exposes `thread/list`, `thread/read`, and explicit compaction events, but a read-only runtime connection was not verified; starting a new server would initialize Codex state and was rejected for this phase.
- No cases, replays, or independent model evaluations have run.
- S0 candidates have not been evidence-reviewed, so confirmed Type A/B/C remains 0 and no early-stop rule has been evaluated.

## Next

Build privacy-safe evidence cards for the 30 S0 candidates, automatically resolve deterministic cases, and reduce only the highest-value uncertain set to at most 12 `YES / NO / UNCERTAIN` reviews.

## Early-stop status

Not triggered. Evidence is insufficient for either Temporal or Cross-Agent conclusions.
