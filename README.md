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
coordy screen --workspace .coordy/screening-s0 --max-sessions 100 --min-goal-seconds 7200
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
100 eligible sessions. Each selected rollout is streamed in full, with a
2 GiB fail-closed safety ceiling; no prefix-truncated session is accepted.
Every generated case stays `uncertain` until evidence review, and Screening
can never emit `GO`.
When the standard Codex Goal database is available, screening first makes a
verified filesystem snapshot of the database and its WAL sidecars without
opening the live database, then reads only Goal identity/status/duration. Goals
lasting at least two hours are selected before transcript-size proxies, their
rollout descendants are linked through `session_meta.parent_thread_id`, and
selection rotates across Goal roots before filling the 100-session cap. A
descendant is reported as a lineage session, not misrepresented as an
independently multi-hour Goal. Goal objectives are neither selected nor
persisted, Goal lineage uses a hashed root identity, and the existing session
identity remains only for frozen source binding. Unknown or ambiguous Goal
schemas and parent lineages fail closed.

Every real compaction boundary becomes a privacy-safe structural opportunity,
whether or not a keyword matched. Opportunities are clustered by Goal root plus
boundary; descendant sessions are observations inside that cluster, not
independent long tasks. `rule_discovered_episodes.jsonl` is only a ranked subset
of `opportunity_population.jsonl`, never a population estimate or upper bound.

`coordy review-s0` verifies frozen source hashes before writing local 0600 T0-T5
evidence cards. The maximum-12 queue is stratified into six high-signal cases,
three deterministic no-keyword recall probes, and three healthy-looking hard
negatives. Missing quota is reported rather than silently backfilled. Each case
asks exactly one `YES`/`NO`/`UNCERTAIN` causal question. Answer files are bound to
the scan run, evidence-card hash, and queue hash. A positive recall probe or hard
negative forces candidate expansion; incomplete Type B cross-session coverage
keeps the result at `INSUFFICIENT_EVIDENCE` rather than allowing a premature
`STOP` or `PIVOT`. The answer artifact must also declare whether answers are
`HUMAN_CONFIRMED` or only a `MACHINE_PRELABEL`. Machine prelabels produce
preliminary metrics and `PENDING_HUMAN_CALIBRATION`; they can never trigger a
Screening decision. A `PIVOT` additionally requires 1-4 confirmed classified
failures, all bound to one scenario tag, plus cases spanning at least three
Goal roots or a separately recorded high-value rationale.

## Privacy and evidence

Coordy persists redacted content, short evidence references, and hashes. The
`discover` and `screen` commands inspect bounded standard Codex history roots
only when explicitly invoked; `run` reads only the export path supplied by the
operator. Coordy never scans arbitrary system paths. Unknown, concurrently
changing, or malformed records fail closed rather than being silently guessed.

## Versioning

Coordy follows semantic versioning. `VERSION`, the package version, changelog,
and Git tag must agree. Validation output records the Coordy version.
