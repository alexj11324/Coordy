# Coordy validation progress

## Current phase

S0a evidence infrastructure is complete for the current frozen run. S0b
semantic grading is in progress across the full compaction opportunity
population. No Screening decision has been emitted: rule/keyword counts do not
establish drift, causality, Type A/B/C/D/U, or prevalence.

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
- Added a privacy-bound cross-session entity-change opportunity layer based on successful `patch_apply_end` facts; it is structural S0a evidence, not Type B ground truth.
- Split S0 into deterministic S0a evidence infrastructure and S0b semantic grading. Every compaction opportunity receives an outcome-blinded State Diff; suspects later receive stronger causal judging against program-verified outcomes.
- Added isolated, resumable LLM judge checkpoints, evidence-ID validation, an independent second judge, a reproducible 30-case human calibration sample, and readable one-question review cards.
- Added a causal evidence policy that accepts structured tool exit codes and `patch_apply_end` facts while refusing to treat transcript prose as an engineering consequence.
- Added a deterministic, hash-bound State Diff smoke artifact so external approval names an immutable payload rather than a moving workspace.
- Revised the State Diff contract after the v5 smoke exposed a redundant-binding failure: every comparison now identifies one phase-bound pre-compaction state item by index and cites post-plan evidence without repeating a second, potentially inconsistent pre-evidence list. The approved v6 smoke completed all 12 cases and passed the safety/evidence-binding gate.

## Outputs

- `protocol/protocol_v1.md`
- `protocol/hypotheses_v1.json`
- `protocol/metrics_v1.json`
- `protocol/decision_thresholds_v1.json`
- `protocol/screening_v1.json`
- `protocol/screening_sampling_amendment_v2.json`
- `protocol/semantic_grading_amendment_v3.json`
- Runtime discovery manifests are written below an ignored workspace.

## Data counts

- Active rollout JSONL: 2,630 files discovered.
- Archived rollout JSONL: 696 files discovered.
- Candidate source interfaces: 5.
- Indexed sessions: 0 (Phase 0B not executed).
- Goal catalog: 8 Goals lasted at least 7,200 seconds in the v26 snapshot.
- S0 selected 100 Goal-lineage sessions using root-balanced sampling: 8 independent Goal roots and 92 descendants.
- The selected lineage contains 217,182 scanned events, 29,709 tool calls, and 472 real compaction observations. The eight root Goals report 3.57–14.24 hours of observed Codex Goal time, which is only a selection attribute; tool calls, active turns, compactions, and other context pressure remain the relevant long-run evidence.
- Full-file scan volume: 2.88 GB across 100 selected sessions; 0 sessions were prefix-truncated.
- Opportunity population: 472 Goal-root-plus-compaction clusters, including 469 structural opportunities; 142 carry rule signals, but that subset is not an upper bound.
- Candidate sample: 30 Goal-balanced opportunities across all 8 Goal roots; 442 opportunities remain outside the candidate cap.
- Cross-session S0a opportunity population: 197 hashed entity-change joins from successful patch events; these are not confirmed invalidations.
- S0b blinded input population: 472/472 opportunities, SHA-256-bound to the v26 scan. The widened T0 window retains deterministic temporal coverage plus recency (up to 48 evidence events) rather than only the last 12 messages. The 16.7 MB artifact is mode 0600 and passed local path/objective/key/password/email probes.
- Cost policy is frozen as one full 472-opportunity primary State Diff plus a targeted independent rejudge: every primary suspect and low-confidence result, then Goal-root-stratified healthy and no-post controls to a 30-case target (normally 20–40). The second judge estimates precision, misses, and agreement; it is not a second prevalence scan.
- Stratified audit queue: 6 high-signal, 3 no-keyword recall probes, and 1 suspicious-looking no-consequence hard-negative candidate across 6 Goal clusters. The hard-negative stratum reports a two-case shortfall instead of backfilling from another stratum.
- Conservative machine prelabel: all 10 cases remain `UNCERTAIN`. These are preliminary labels, not completed human review, so no precision, missed-positive, or false-pause metric is claimed.
- Current status is `SMOKE_ABORTED_INVALID_OR_UNCERTAIN_JUDGE_RESULT`, `decision=null`; machine prelabels cannot emit STOP/PIVOT.
- Authoritative ignored runtime workspace: `.coordy/screening-s0-v26/data/screening/`.

## Failures or missing evidence

- This implementation itself experienced execution drift: it temporarily optimized for an early numeric STOP instead of preserving the Pro-level evidence contract of complete long-history traces, T0-T5 causality, replayable engineering consequences, and rules used only for ranking. The root causes were prefix truncation, a keyword-defined pseudo-population, premature upper-bound language, auxiliary-review noise, expected-red-test noise, and evidence cards that were not decision-readable.
- The first v25 semantic run also exposed an orchestration defect in the retired `codex exec` transport: interrupting the terminal session did not terminate two underlying grader parents, so duplicate workers briefly competed for the same checkpoint and spent extra model calls. Its 132-row checkpoint (131 suspects, including all 3 cases without a visible post-plan) is preserved as `RETRACTED_INVALID_SEMANTIC_RUN`; it is not resumed or used for prevalence. The replacement uses one direct Responses API request per opportunity, one workspace writer lock, atomic checkpoints, and prompt/schema/model/effort/API-base/timeout provenance. Exact token/cost usage for the retired interrupted calls is unavailable and will not be estimated.
- The first approved v26 smoke attempt used the retired transport, persisted one valid control result, then rejected a malformed cross-opportunity evidence citation. Its partial checkpoint is retired. The replacement sends no tools, stores no server-side response, disables parallel tool calls, binds an exact per-opportunity evidence schema, validates request/response IDs, and records API token usage. It runs serially, writes a durable pre-POST dispatch tombstone, never retries automatically, and blocks resending an uncertain dispatch; this infrastructure is not evidence about drift or judge accuracy.
- That execution drift invalidates the old validation method and its STOP outputs; it does **not** falsify the Pro validation direction or the underlying temporal-state hypothesis. The corrected opportunity/audit pipeline must finish before the hypothesis can be judged.
- The local-only source report `多人协作智能体：现有技术缺口分析与创业结论.md` is present under `.local-specs/`, mode 0600, SHA-256 `4ca0590e7c5cfea5be5bf1f1aa3d6915b2833afddb9cebd7dea764d401255965`, and excluded from Git. It guides scope but is not experimental ground truth.
- No historical events have been ingested or indexed.
- Official App Server v2 schema exposes `thread/list`, `thread/read`, and explicit compaction events, but a read-only runtime connection was not verified; starting a new server would initialize Codex state and was rejected for this phase.
- The approved v26 direct-API smoke ran serially and stopped after 5 dispatches, with no retry. Four results passed local validation: all 3 no-post-plan controls were correctly `UNASSESSABLE`, and the first post-plan case was `NO_MATERIAL_CHANGE`. The fifth API response was schema-valid but failed the minimum earlier-to-post evidence comparison, so the remaining 7 cases were not sent. The five calls used 153,491 input and 7,889 output tokens (161,380 total, including 603 reasoning tokens). The failure ledger retains request/response/token provenance, but this pre-diagnostic run did not retain the rejected semantic body; subsequent fresh runs will store a redacted rejected result. This is a Judge safety/evidence-binding failure, not evidence for or against long-term drift prevalence.
- The separately approved v5 smoke used an isolated ignored workspace and stopped after 4 dispatches, with no retry. Three controls passed; the fourth response cited a concrete goal item by index but added another pre-compaction evidence ID belonging to a different state item, so local binding validation rejected it. The four calls used 111,788 input and 5,236 output tokens (117,024 total, including 493 reasoning tokens). The redacted rejected result, request/response IDs, token usage, result hash, and dispatch snapshot hash are retained. This remains a Judge contract failure, not evidence for or against long-term drift.
- The approved v6 smoke completed 12/12 serial dispatches: all 3 controls were `UNASSESSABLE`, all 9 post-plan cases were assessable, and none was marked suspect. It used 365,646 input and 20,806 output tokens (386,452 total, including 2,175 reasoning tokens). Result/config hashes, request/response provenance, 0600 permissions, and privacy probes passed. This validates the safety/evidence-binding seam only; it does not establish Judge accuracy or drift prevalence.
- The first v6 full-population attempt was stopped after one response used an out-of-range numeric pre-state index. Before interruption it created 83 dispatch records (78 validated, 4 outcome-unknown in flight, 1 semantic failure), checkpointed 72 results, and recorded 2,848,700 known tokens. The fix removes numeric indices in favor of an exact copied pre-state statement and bounds concurrent submission to one worker-sized batch, so a future failure cannot drain the remaining population. No v6 result is reused under v7.
- The v7 smoke showed that exact long-statement copying is also a brittle duplicate representation: after 3 valid controls, the first post-plan response paraphrased the extracted pre-state and was rejected (4 dispatches, 116,142 tokens). v8 removes the cross-reference entirely; each diff carries one pre-state statement with direct pre-compaction evidence plus direct post-plan evidence. The independent states extraction remains descriptive rather than a second source that must match word-for-word.
- The earlier seven-case and four-case `STOP` attempts were invalid. The first capped raw signals before deduplication; the second scanned only 8 MiB prefixes and treated a keyword subset as a global upper bound. Both conclusions are explicitly retracted.
- Structural cards are not yet confirmed causal Decision Points and do not replace complete repository cutoff manifests.
- Only 8 independently timed multi-hour Goals exist in the v26 snapshot; the other 92 selected rows are explicitly clustered lineage sessions and cannot be treated as 100 independent long tasks.
- Repository concentration is no longer a PIVOT proxy; PIVOT requires an explicit scenario repeated across independent Goal roots or a separately recorded high-value rationale.
- Type B structural opportunity enumeration has run, but semantic invalidation and causal confirmation have not, so S0 cannot produce a terminal decision.
- S1–S3 and confirmatory validation have not run.

## Next

The simplified v6 State Diff Judge contract passed its frozen smoke; v8 removes
both numeric-index and exact-copy cross-reference ambiguity. Before any
population-level claim, rerun a frozen smoke and the full blinded population, then the
independent/human calibration gates required by the semantic amendment.
Do not resend the failed opportunity automatically, do not continue the remaining
seven cases from this aborted run, and do not authorize the 472-case population.
Only a fresh safety/evidence-binding smoke may reopen human calibration and causal
grading. Do not infer STOP from this Judge failure, machine prelabels, or structural
opportunity counts alone.

## Early-stop status

`SMOKE_ABORTED_INVALID_OR_UNCERTAIN_JUDGE_RESULT` — the first direct-API S0b
smoke failed its evidence-binding gate after 5/12 dispatches; human calibration
is incomplete, and Type B has structural opportunity evidence only.
Screening may later emit only `STOP`, `PIVOT`, or `PROCEED_TO_CONFIRMATION`.
