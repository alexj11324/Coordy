# Changelog

## 0.1.0 - 2026-08-16

- Add a standard-library-only command-line validation harness.
- Add read-only JSON/JSONL ingestion, redaction, hashing, and SQLite indexing.
- Add incremental structured state with explicit supersession.
- Add drift candidate mining and cross-session dependency invalidation.
- Add frozen protocol artifacts, evidence reports, examples, and CI tests.
- Add bounded Codex source discovery and low-cost S0 screening with fail-closed live-file checks.
- Add privacy-safe S0 evidence cards, auxiliary-session filtering, and frozen-gate adjudication.
- Deduplicate and diversify S0 candidates by compaction episode before applying the review cap.
- Bind screening, evidence, and adjudication artifacts to one scan run and carry overflow gates end to end.
- Prioritize measured multi-hour Goals, balance lineage sessions and candidates across Goal roots, and preserve the first session identity in inherited transcripts.
- Enumerate every compaction boundary as a Goal-clustered opportunity and demote keyword rules to ranking signals.
- Add reproducible high-signal, no-keyword recall-probe, and healthy-hard-negative review strata with bound answers and cluster-aware metrics.
- Fail closed on oversized rollouts instead of treating a scanned prefix as complete; stream accepted rollouts in full.
- Record and correct an S0 execution drift: retract the old prefix/keyword-derived STOPs, remove auxiliary-review and expected-TDD false positives, and restore T0-T5 causal evidence as the validation standard. This retracts the flawed method, not the Pro validation direction or the underlying hypothesis.
- Separate machine prelabels from human-confirmed calibration, bind final adjudication provenance, and require an explicit evidence-backed scenario before PIVOT.
- Keep human causal confirmation separate from system Type A/B/C classification so unclassified positives cannot trigger terminal S0 gates.
- Split rule-based S0a evidence infrastructure from S0b semantic grading: run an outcome-blinded State Diff over every compaction opportunity, independently rejudge suspects/low-confidence/audit samples, and checkpoint only evidence-ID-valid outputs.
- Bound the independent State Diff rejudge to all primary suspects and low-confidence cases plus a reproducible Goal-root-stratified healthy/control sample (target 30, normally 20–40), rather than a second full-population pass.
- Permit at most two explicit, provenance-preserving retries for repeated bare HTTP 504 gateway responses; all other transport and semantic failures remain non-retryable.
- Derive the State Diff top-level suspect label from evidence-bound direct risks; preserve inconsistent model summaries and route them to independent/human review without another model call.
- Complete the v8 State Diff run across all 472 frozen compaction opportunities and 8 Goal roots, then target the independent Judge at 45 mandatory cases plus 3 no-post and 3 healthy controls.
- Require real rejudged no-post/healthy cases for the calibration control stratum; do not relabel arbitrary mandatory disagreements as deterministic controls.
- Preserve complete S0b text, including response annotations and the actual user request, without semantic truncation or redaction; replace embedded screenshot bytes with evidence-bound unassessed markers and retract calibration artifacts built from header-only excerpts.
- Fix the real nested packet transport so screenshot data is actually omitted, bind request-body size/hash in dispatch provenance, and regrade 118/123 excerpt-affected packets without another context-window 502 or resending five outcome-unknown dispatches.
- Bind stronger causal judging to structured tool exit codes and successful patch facts, keep prose from masquerading as engineering outcomes, and require human review before any machine Type A/B/C/D/U prelabel becomes ground truth.
- Close the pragmatic Temporal S0 screening with `STOP`: the final two primary-suspect cases carrying deterministic outcome signals were a literal `0 failed` false positive and ordinary UI-test iteration that later passed, leaving no confirmed compaction-caused engineering loss; keep Cross-Agent/Type B explicitly separate and unvalidated.
- Make S0b resumability fail closed: one semantic writer lock, atomic/fsynced checkpoints, full judge-configuration provenance, frozen-session binding, direct T0/T1 causal evidence, and hash-bound causal answer ingestion; the former subprocess cleanup path is retained only in retracted history.
- Add the local-report-driven Active Plan State scope as a protocol amendment while keeping the ignored report itself out of Git.
- Retire the earlier one-opportunity-per-`codex exec` grading transport after its interruption and isolation defects; retain its invalid artifacts only as retracted history.
- Replace the retired `codex exec` grader with a direct Responses API adapter that fixes and verifies instructions, tools, storage, parallel calls, model, and exact schema; load credentials only from an ignored private env file or runtime environment.
- Run the approved v26 direct-API smoke serially: three controls and one post-plan result validated, then a fifth response failed the required earlier-to-post evidence comparison; abort without retry or full-population authorization and record 161,380 total tokens across five dispatches.
- Partition State Diff comparison evidence into schema-constrained earlier-state and post-plan IDs, and require a fresh exact judge-configuration hash approval before a revised smoke can transmit anything.
- Record the approved v5 smoke abort after 4 dispatches and remove its redundant diff-level pre-evidence list; v6 binds each diff to one phase-validated pre-state item plus post-plan evidence.
- Complete the approved v6 12-case smoke with 3/3 controls and 9/9 post-plan cases passing the safety/evidence-binding gate; retain accuracy and full-population claims as false pending calibration.
- Replace numeric pre-state indices with exact statement binding after the first full-population attempt exposed an off-by-one Judge output; submit concurrent work in bounded worker-sized batches so failures stop further dispatch.
- Remove the remaining states-to-diff cross-reference after v7 showed exact-text copying was brittle; bind each diff directly to pre-compaction and post-plan evidence instead.
