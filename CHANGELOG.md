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
