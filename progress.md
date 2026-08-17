# Coordy validation progress

## Current phase

S0a evidence infrastructure is complete for the current frozen run. The v8 and
v27 S0b evidence paths are retracted because bounded excerpts first hid the
user's request and then discarded its response-annotation context. The v32
path preserves complete textual messages and marks embedded screenshots as
visually unassessed instead of transmitting their bytes. Its targeted repair
completed all 123 actually affected packets. Five responses lost during a local
client exit were server-confirmed HTTP 200, unrecoverable because `store=false`,
and explicitly re-dispatched in a separate recovery ledger. The pragmatic S0
Screening decision for **Temporal State Consistency is `STOP`**: the corrected
history review did not produce a confirmed compaction-caused wrong action with
an observable engineering loss. This is a startup-direction screening result,
not a prevalence estimate or an academic claim that drift never occurs.

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
- Completed the v8 direct-API State Diff run over all 472 frozen compaction opportunities, then independently rejudged the 45 mandatory suspect/normalized cases plus 3 no-post and 3 healthy controls without resending completed checkpoints.
- Corrected the calibration sampler after the first real run exposed mislabeled pseudo-controls: only actual no-post or healthy rejudged cases may be counted as deterministic controls.
- Replaced bounded S0b evidence serialization after a human audit recovered an explicit pre-compaction decision the Judge never received: semantic packets now retain both the complete response annotations and the complete request, while compact S0a review excerpts remain bounded/redacted.
- Added State Diff transport that preserves complete semantic text while replacing embedded screenshot bytes with evidence-bound unassessed markers; each request remains one compaction opportunity.

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
- S0b complete-message input population: 472/472 opportunities, SHA-256-bound to the frozen scan. The v32 artifact is 118,682,403 bytes with SHA-256 `8a760076b7ac09e592f1bec17dd51822b2a292c148b1aabaa5315d1b7b0c0aaf`; its widened T0 window retains deterministic temporal coverage plus recency (up to 48 evidence events) rather than only the last 12 messages.
- Cost policy is frozen as one full 472-opportunity primary State Diff plus a targeted independent rejudge: every primary suspect and low-confidence result, then Goal-root-stratified healthy and no-post controls to a 30-case target (normally 20–40). The second judge estimates precision, misses, and agreement; it is not a second prevalence scan.
- The retracted v8 primary State Diff completed 472/472 opportunities across all 8 Goal roots: 44 machine suspects, 408 `NO_MATERIAL_CHANGE`, and 20 `UNASSESSABLE`. These labels are retained only as historical provenance and cannot support calibration or prevalence.
- The targeted v8 secondary Judge completed 51 cases across all 8 Goal roots: 45 mandatory suspect/normalized cases plus 3 no-post and 3 healthy controls. Mandatory cases alone exceeded the nominal 40-case maximum, and that overflow is recorded rather than silently dropping cases.
- The v8 30-case human calibration queue and its two draft answers are retracted. The response-annotation truncation defect affected 123/472 opportunities; those 123 were regraded with complete text. The other 349 did not contain the reproduced defect and remain usable for low-cost Screening with their original provenance. They are not represented as one uniform v32 academic-style run, because Screening does not require that irrelevant serialization difference to trigger 349 extra calls.
- Known v8 State Diff usage is 17,099,724 primary tokens plus 1,774,150 targeted-secondary tokens. The completed results and queue are SHA-256-bound, mode 0600, and passed local path, email, private-key, and secret-value probes.
- Stratified audit queue: 6 high-signal, 3 no-keyword recall probes, and 1 suspicious-looking no-consequence hard-negative candidate across 6 Goal clusters. The hard-negative stratum reports a two-case shortfall instead of backfilling from another stratum.
- Conservative machine prelabel: all 10 cases remain `UNCERTAIN`. These are preliminary labels, not completed human review, so no precision, missed-positive, or false-pause metric is claimed.
- The v29 multimodal smoke completed 12/12 using Luna low: 3 controls were `UNASSESSABLE`, all 9 post-plan cases were assessable, and 1 was a suspect. It used 391,163 input and 25,547 output tokens (416,710 total). This is a transport/evidence-contract result, not accuracy evidence.
- Of the 123 packets affected by the old excerpt bug, the superseded multimodal run completed 87 before its inline-image ceiling stopped it. The replacement v32 text-evidence run completed all 123: 13 suspects, 105 `NO_MATERIAL_CHANGE`, and 5 `UNASSESSABLE`, using 4,339,078 input and 293,882 output tokens. Five lost-response cases were re-dispatched in a separate recovery ledger after server logs proved their original HTTP 200 responses were unrecoverable. Request bodies contained no screenshot bytes and produced no context-window 502.
- Complete text changed the old primary label in 26/123 affected cases: 13 moved from `SUSPECT` to `NO_MATERIAL_CHANGE`, and 13 moved in the opposite direction. This is a material screening signal, but the 26 changed labels remain machine prelabels rather than Ground Truth.
- A targeted independent Luna-low rejudge covered 10 changed-label cases across 5 Goal roots and agreed with the corrected primary binary label in only 5/10 cases (383,337 tokens). It supported 4/5 removed suspects but only 1/5 newly surfaced suspects. It also mislabeled the user-confirmed current-book case as suspect. Therefore a single machine `SUSPECT` is not reliable Ground Truth. Human calibration would remain mandatory before promoting any such label to a causal positive, but no-consequence disagreements need not be exhaustively calibrated after they can no longer change the pragmatic Screening decision.
- The user-audited current-book-search case is `NO_MATERIAL_CHANGE` at 0.98 confidence under the complete-text contract: its pre-compaction state explicitly rejects cross-book full-library search, and the post-compaction plan preserves current-book-only search. The earlier drift label was caused by the truncated evidence, not by that task's actual conversation.
- A final consequence-focused audit covered the only two unaffected opportunities that combined a primary `SUSPECT` label with a deterministic outcome signal. In the June case the scanner matched the literal summary `0 failed`; all 22 tests passed. In the August case the failures were ordinary UI-test/flow iteration (an unsupported XCUITest predicate and an incomplete photo-selection path), the no-foreground-focus constraint remained preserved, and the complete real flow subsequently passed. Neither case supports compaction-caused engineering loss.
- Across the targeted independent review, 11 two-Judge `SUSPECT` agreements had no deterministic observable outcome. The only two primary-suspect cases with an outcome were rejected by the second Judge and by the focused consequence audit above. No confirmed Type A/B/C causal failure with engineering loss remains in the screened Temporal cohort.
- Current Temporal Screening status is `STOP`; the 123 defect-affected opportunities are fully regraded, while the unaffected 349 retain their original provenance for Screening. Cross-Agent/Type B remains a separate unvalidated technical proposition and is not silently folded into this Temporal result.
- Authoritative corrected ignored runtime workspace: `.coordy/screening-s0-v32-text-evidence/data/screening/`. The v26/v8, v27, v29, v30, and v31 workspaces are retracted historical evidence only.

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
- Human review of the second v8 calibration card found that the original transcript explicitly rejected whole-library search before compaction, while the Judge input showed only the leading response-annotation wrapper. The generic 280-character head excerpt had removed the entire user request. This affected 76 wrapped event instances across 45 opportunities and changed 123 packet hashes because events are reused across later compaction windows. The v8 calibration queue is therefore invalid even though all artifact hashes were internally consistent.
- The v27 request-priority repair was also retracted: deleting the annotation prefix removed potentially relevant user context. Complete-message v29 keeps both regions instead of adapting to individual wrapper formats.
- The user-audited current-book-search opportunity contains 73,033 bytes of text and two original screenshots whose data URLs total 2,667,988 bytes. The user-owned proxy has no `/v1/files` endpoint (404), and a one-worker original multimodal request returned HTTP 502 `input exceeds the context window`; this is an observed payload limitation, not evidence that five-way concurrency is unstable. No 504 retry was attempted for that 502.
- The first complete-text transport implementation still inspected the outer `{packet: ...}` wrapper instead of its nested packet. That test-gap left inline image data inside the actual request and reproduced a 2.81 MB context-window 502. v32 fixes the earliest boundary, tests the real wrapper shape, records the request-body hash/size, and sends the same case as a 144 KB text-only request that returned 200. Later bare 504s were intermittent gateway timeouts: eight cases succeeded on attempt 2 and three on attempt 3.
- The earlier seven-case and four-case `STOP` attempts were invalid. The first capped raw signals before deduplication; the second scanned only 8 MiB prefixes and treated a keyword subset as a global upper bound. Both conclusions are explicitly retracted.
- Structural cards are not yet confirmed causal Decision Points and do not replace complete repository cutoff manifests.
- Only 8 independently timed multi-hour Goals exist in the v26 snapshot; the other 92 selected rows are explicitly clustered lineage sessions and cannot be treated as 100 independent long tasks.
- Repository concentration is no longer a PIVOT proxy; PIVOT requires an explicit scenario repeated across independent Goal roots or a separately recorded high-value rationale.
- Type B structural opportunity enumeration has run, but semantic invalidation and causal confirmation have not, so S0 cannot produce a terminal decision.
- S1–S3 and confirmatory validation have not run.

## Next

Stop further Temporal State Consistency calls and implementation under the
low-cost falsification rule. The remaining machine disagreements and
no-consequence cases cannot change this Screening direction and are recorded,
not expanded into paper-level calibration. If work continues, treat Cross-Agent
plan invalidation as a separate proposition with its own evidence and decision;
do not reuse this Temporal `STOP` as its conclusion.

## Early-stop status

`STOP` for **Temporal State Consistency** — complete-text regrading materially
changed machine labels, the targeted second Judge showed those labels were
unstable, and focused inspection found no remaining case where compaction-caused
state loss led to an observable engineering loss. Further calibration of
no-consequence disagreements would not change the startup-direction decision.
Type B/Cross-Agent still has structural opportunity evidence only and remains
unvalidated rather than being assigned the same result.
