# Coordy validation progress

## Current phase

Low-cost Screening S0 is `PENDING_HUMAN_CALIBRATION`. No Screening decision has
been emitted: the temporal compaction queue has only conservative machine
prelabels, and the distinct Type B cross-session opportunity layer is not yet
implemented.

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
- Replaced keyword-defined episodes with a complete, full-file compaction opportunity population; rules now rank rather than define the population.
- Added a reproducible 6/3/3 high-signal, no-keyword recall-probe, and healthy-hard-negative queue with bound answer artifacts and cluster-aware metrics.
- Fixed paired compaction markers and excluded developer/system injections from post-compaction Agent actions.
- Distinguished machine prelabels from human-confirmed review, bound the final adjudication to its scan/answer/evidence hashes, and made scenario-based PIVOT reachable without using repository concentration as a proxy.
- Added a separate system A/B/C classification gate: a human `YES` without completed causal classification remains `INSUFFICIENT_EVIDENCE` and cannot be counted toward STOP or PIVOT.

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
- The 7 Goal roots report 5.89-14.24 hours of observed Codex Goal time. Their selected lineage contains 212,142 scanned events, 28,793 tool calls, and 465 compaction observations; these context-pressure counts, not elapsed waiting time alone, justify treating them as long-run histories.
- Full-file scan volume: 2.88 GB across 100 selected sessions; 0 sessions were prefix-truncated.
- Opportunity population: 465 Goal-root-plus-compaction clusters, including 462 structural opportunities; 135 carry rule signals, but that subset is not an upper bound.
- Candidate sample: 30 Goal-balanced opportunities across all 7 Goal roots; 435 opportunities remain outside the candidate cap.
- Stratified audit queue: 6 high-signal, 3 no-keyword recall probes, and 1 suspicious-looking no-consequence hard-negative candidate across 6 Goal clusters. The hard-negative stratum reports a two-case shortfall instead of backfilling from another stratum.
- Conservative machine prelabel: all 10 cases remain `UNCERTAIN`. These are preliminary labels, not completed human review, so no precision, missed-positive, or false-pause metric is claimed.
- Current status is `PENDING_HUMAN_CALIBRATION`, `decision=null`; machine prelabels cannot emit STOP/PIVOT, and compaction opportunities also do not cover Type B cross-session invalidation.
- Authoritative ignored runtime workspace: `.coordy/screening-s0-v24/data/screening/`.

## Failures or missing evidence

- This implementation itself experienced execution drift: it temporarily optimized for an early numeric STOP instead of preserving the Pro-level evidence contract of complete long-history traces, T0-T5 causality, replayable engineering consequences, and rules used only for ranking. The root causes were prefix truncation, a keyword-defined pseudo-population, premature upper-bound language, auxiliary-review noise, expected-red-test noise, and evidence cards that were not decision-readable.
- That execution drift invalidates the old validation method and its STOP outputs; it does **not** falsify the Pro validation direction or the underlying temporal-state hypothesis. The corrected opportunity/audit pipeline must finish before the hypothesis can be judged.
- Source report `多人协作智能体：现有技术缺口分析与创业结论.md` is absent.
- No historical events have been ingested or indexed.
- Official App Server v2 schema exposes `thread/list`, `thread/read`, and explicit compaction events, but a read-only runtime connection was not verified; starting a new server would initialize Codex state and was rejected for this phase.
- No cases, replays, or independent model evaluations have run.
- The earlier seven-case and four-case `STOP` attempts were invalid. The first capped raw signals before deduplication; the second scanned only 8 MiB prefixes and treated a keyword subset as a global upper bound. Both conclusions are explicitly retracted.
- Structural cards are not yet confirmed causal Decision Points and do not replace complete repository cutoff manifests.
- Only 7 independently timed multi-hour Goals exist locally; the other 93 selected rows are explicitly clustered lineage sessions and cannot be treated as 100 independent long tasks.
- Repository concentration is no longer a PIVOT proxy; PIVOT requires an explicit scenario repeated across independent Goal roots or a separately recorded high-value rationale.
- Type B cross-session invalidation opportunity enumeration has not run, so S0 cannot produce a terminal decision.
- S1–S3 and confirmatory validation have not run.

## Next

Obtain human calibration of the readable temporal queue, implement the Type B
cross-session invalidation opportunity layer, include it in the same bound
stratified audit, and rerun adjudication. Do not infer STOP from machine
prelabels or the temporal-compaction sample alone.

## Early-stop status

`PENDING_HUMAN_CALIBRATION` — the 10-case temporal queue has only machine
prelabels, and Type B coverage is incomplete.
Screening may later emit only `STOP`, `PIVOT`, or `PROCEED_TO_CONFIRMATION`.
