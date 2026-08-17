# Coordy

Coordy is a local research harness for a narrow question: can persistent,
structured state reduce long-horizon agent drift, and can the same state detect
when another session has invalidated an active plan?

It is deliberately **not** an agent runtime, message bus, desktop client, or
generic memory platform. Version 0.1.0 provides the smallest reproducible data
and rule baseline needed before paying for model replays.

## What 0.1.0 does

- reads exported JSON or JSONL without modifying the source;
- normalizes events and redacts likely secrets before persistence;
- records source hashes and schema provenance;
- indexes sessions and events in SQLite;
- maintains source-backed state atoms with active/superseded lifecycles;
- mines drift signals without treating keywords as ground truth;
- detects cross-session changes that overlap active dependencies;
- emits auditable candidates and `INSUFFICIENT_EVIDENCE` reports by default.

## Quick start

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e .
coordy run --input examples/synthetic_sessions.jsonl --workspace .coordy/demo
coordy summary --workspace .coordy/demo
python -m unittest discover -s tests -v
```

The input may be JSONL (one event object per line), a JSON array, or an object
with an `events` array. Required fields are `session_id`, `timestamp`, `actor`,
and `content`; other canonical fields are optional.

State-bearing lines can use explicit prefixes for the deterministic baseline:

```text
GOAL: preserve the release approval workflow
CONSTRAINT: automation must not deploy without approval
DECISION: the release owner authorizes production deployment
REJECTED: automatic production deployment
PLAN: prepare the staging release
DEPENDS: fixtures/release-policy.txt
```

This rule extractor is a cheap baseline, not semantic understanding. Its output
must be compared with simple memory and model-assisted conditions before a
GO/PIVOT/STOP claim.

## Privacy and evidence

Coordy persists redacted content, short evidence references, and hashes. It
does not scan arbitrary system paths or Codex private storage. Point it only at
an export you are authorized to evaluate. Unknown or malformed records fail
closed and are written to the ingestion report, not silently guessed.

## Versioning

Coordy follows semantic versioning. `VERSION`, the package version, changelog,
and Git tag must agree. Validation output records the Coordy version.
