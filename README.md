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
coordy init --workspace .
coordy discover --workspace .coordy/discovery
coordy screen --workspace .coordy/screening-s0 --max-sessions 100
coordy review-s0 --workspace .coordy/screening-s0 --max-reviews 12
coordy adjudicate-s0 --workspace .coordy/screening-s0 --answers .coordy/screening-s0/data/screening/user_review_answers.json
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

`coordy discover` performs bounded, read-only environment discovery. It checks
the installed Codex CLI and official App Server schema before inspecting known
local storage candidates. Discovery persists only paths, counts, hashes, schema
keys, and limitations; it never writes transcript content or reads config/auth
contents. An unknown history schema fails closed with no selected adapter.

`coordy screen` runs only the low-cost S0 prevalence gate. It scans at most
100 eligible sessions and at most 8 MiB per rollout. Every generated case stays
`uncertain` until evidence review, and Screening can never emit `GO`.

`coordy review-s0` verifies each frozen source prefix before writing local
0600 evidence cards. Cutoff-safe evidence and retrospective outcome evidence
remain separate, auxiliary approval-reviewer sessions are excluded, and cards
are deduplicated by session plus compaction episode. These cards are only a
structural upper bound: they are not called replayable Decision Points until a
causal case manifest and repository cutoff are reconstructed. Fewer than 10
unique structural episodes can trigger the frozen S0 `STOP` rule without asking
the user to label noise only when the full candidate population was retained
(`candidate_episode_overflow == 0`). Otherwise, only structurally complete cases
with interpretable outcome evidence may enter the maximum-12 queue; the user
answers only `YES`, `NO`, or `UNCERTAIN`. S0 leaves the exact A/B/C type
unclassified until external-change exclusions and the causal chain are built.
Passing those prevalence gates proceeds to causal case construction, not S1 or
a premature GO.

## Privacy and evidence

Coordy persists redacted content, short evidence references, and hashes. The
`discover` and `screen` commands inspect bounded standard Codex history roots
only when explicitly invoked; `run` reads only the export path supplied by the
operator. Coordy never scans arbitrary system paths. Unknown, concurrently
changing, or malformed records fail closed rather than being silently guessed.

## Versioning

Coordy follows semantic versioning. `VERSION`, the package version, changelog,
and Git tag must agree. Validation output records the Coordy version.
