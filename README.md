# Coordy

**An experimental framework for detecting and mitigating long-horizon task
drift in AI agents.**

Long-running agents can lose an active goal, constraint, decision, or plan after
context compaction. They can also continue executing a plan after another
session has invalidated its assumptions. Coordy turns real agent histories into
evidence-bound drift cases, tests whether the drift can be detected before the
first harmful action, and compares structured state with simpler baselines.

Coordy is currently a research harness, not a production agent runtime, message
bus, desktop client, or generic memory platform. The central question is still
under evaluation: does persistent structured state detect genuine task drift
earlier and more accurately than native context, goal reinjection, periodic
checkpoints, or better compaction?

## Research workflow

```text
complete agent history
        ↓
confirm whether forgotten state actually caused a wrong action
        ↓
freeze the history after state loss but before the first wrong action
        ↓
compare Native / Goal Reinjection / Checkpoint / Better Compaction / Coordy
        ↓
report DETECTED / MISSED / LATE / FALSE ALARM / UNCERTAIN
```

Ground truth is not inferred from keywords or a single model judgment. State
Diff and causal judges produce machine prelabels; confirmed cases require
evidence-linked T0–T5 timelines, deterministic Git/test/tool outcomes, and human
calibration. The detector is evaluated without access to later failures,
rework, or user corrections.

## Current status

- Deterministic evidence collection and full compaction-opportunity enumeration
  are implemented.
- Outcome-blinded State Diff and independent causal-review pipelines are
  implemented.
- Full causal confirmation and the five-condition pre-action detector comparison
  are still in progress.
- Existing suspect counts are investigation inputs, not proof that drift
  occurred or that Coordy detected it.
- Screening may conclude only `STOP`, `PIVOT`, or
  `PROCEED_TO_CONFIRMATION`; it never emits `GO`.

Version 0.1.0 separates deterministic evidence infrastructure (S0a) from
model-assisted semantic grading (S0b). Rules may enumerate and rank evidence,
but they never stand in for a state-loss or causal judgment.

## What 0.1.0 does

- reads exported JSON or JSONL without modifying the source;
- normalizes events and redacts likely secrets before persistence;
- records source hashes and schema provenance;
- indexes sessions and events in SQLite;
- maintains source-backed state atoms with active/superseded lifecycles;
- mines drift signals without treating keywords as ground truth;
- detects cross-session changes that overlap active dependencies;
- emits auditable candidates and `INSUFFICIENT_EVIDENCE` reports by default.
- runs an outcome-blinded LLM State Diff over every compaction opportunity;
- sends every final primary semantic suspect to stronger, outcome-aware causal
  judges;
- requires independent judging and human calibration before machine prelabels
  can contribute to a research conclusion.

## Quick start

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e .
cp .env.example .env.local
# Edit .env.local, then chmod 600 .env.local
coordy init --workspace .
coordy discover --workspace .coordy/discovery
coordy screen --workspace .coordy/screening-s0 --max-sessions 100 --min-goal-seconds 7200
coordy review-s0 --workspace .coordy/screening-s0 --max-reviews 12
coordy adjudicate-s0 --workspace .coordy/screening-s0 --answers .coordy/screening-s0/data/screening/user_review_answers.json
coordy prepare-s0b --workspace .coordy/screening-s0
coordy prepare-s0b-smoke --workspace .coordy/screening-s0 --sample-size 12 --no-post-plan-controls 3
coordy grade-s0b-smoke --workspace .coordy/screening-s0 --approved-smoke-sha256 <approved-sha256> --approved-judge-configuration-sha256 <approved-config-sha256>
coordy grade-s0b-state --workspace .coordy/screening-s0 --batch-size 1 --workers 4
coordy calibrate-s0b-state --workspace .coordy/screening-s0 --answers <human-answers.json>
coordy prepare-s0b-causal --workspace .coordy/screening-s0
coordy grade-s0b-causal --workspace .coordy/screening-s0 --workers 2
coordy calibrate-s0b-causal --workspace .coordy/screening-s0 --answers <human-causal-answers.json>
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

S0a ends there: it proves that complete, read-only, privacy-bound evidence can
be enumerated. It does **not** prove that long-horizon drift occurred. In S0b,
`prepare-s0b` creates a blinded packet for every opportunity containing only
pre-compaction state, the compaction summary, and the first post-compaction
plan. The lightweight State Diff Judge extracts Goal, Constraint, Decision,
Rejected Option, Plan, Dependency, and Acceptance Criteria with evidence IDs,
then labels each item `missing`, `contradicted`, `stale_reactivated`, or
`preserved`. Final tool outcomes and user corrections are hidden at this stage
to reduce hindsight bias.

`prepare-s0b-smoke` freezes the exact external-evaluation payload before any
model call. It records the source-input hash, payload hash and byte count,
Goal-root coverage, control quota, destination, judge scope, and an explicit
`external_transmission_completed=false` marker. Preparing this artifact does
not authorize or perform transmission. `grade-s0b-smoke` requires the approved
SHA-256 and consumes only that frozen file; it never authorizes the 472-case
population. Once frozen, changing smoke size or control quota fails closed and
requires a fresh workspace. `grade-s0b-state` is the separate full-population
path and must not be used on smoke-only approval.
Smoke approval binds both the immutable payload SHA-256 and the complete
non-secret Judge configuration SHA-256; changing the prompt, schema, endpoint,
model, effort, or timeout requires a new explicit approval.

All State Diff opportunities receive a primary judge. Every suspect and
low-confidence case, plus a reproducible Goal-root-stratified sample of healthy
cases and no-post controls, receives an independently identified second judge.
The target is 30 second-judge cases (normally 20–40 and no more than about 10%);
if mandatory suspect/low-confidence cases exceed that range, the manifest
reports the overflow instead of dropping them. Each model call is one direct
OpenAI-compatible Responses API
request for one opportunity. The request fixes `instructions`, sends `tools=[]`,
sets `store=false` and `parallel_tool_calls=false`, and supplies a strict schema
that admits only the exact opportunity and evidence IDs in that packet. The
client verifies those fields again in the server response before accepting any
output. Malformed output and unknown transport outcomes fail closed without an
automatic retry. A concrete HTTP 504 with no request ID, response ID, or usage
may receive up to two explicitly authorized, audited retries; valid results are atomically checkpointed
with input, schema,
request/response IDs, token usage, and full judge-configuration hashes. API
smoke dispatch is serial. Every grading path durably records dispatch before
each POST, so an interrupted or otherwise uncertain dispatch blocks automatic
resend. API credentials are read only from a private `0600` `.env.local` or process
environment; `.env*` files are ignored except for `.env.example`.
The top-level suspect flag is treated as a deterministic summary of the
fine-grained diffs: only a missing, contradicted, or stale-reactivated item with
`DIRECT` downstream relevance is a suspect. A model mismatch is preserved,
normalized without another API call, and forced into independent/human review.
S0b semantic packets preserve the complete textual message, including Codex
response annotations and the explicit `My request for Codex` body. They do not
truncate or redact semantic text. Embedded screenshot bytes are not sent to the
State Diff Judge; an evidence-bound marker says that their visual content was
not assessed. One request still represents exactly one compaction opportunity.
The compact S0a human-review artifacts keep
their separate bounded/redacted display policy.
A reproducible 20–40 case human calibration queue includes disagreements,
suspects, and actual no-post/healthy controls. Mandatory rejudge cases may exceed
the nominal cap, but they cannot displace the control probes or be mislabeled as
controls. Bound `HUMAN_CONFIRMED` answers produce
precision, recall, false-pause rate, primary/secondary agreement, and a
missed-positive control-probe rate; fewer than 20 decided cases or failure of
the frozen 0.80/0.70/0.10 quality floor remains insufficient evidence.

Every final primary State Diff `SUSPECT` proceeds to causal grading; secondary
State Diff disagreement is retained as evidence and cannot filter a primary
suspect out. The causal
packet carries direct T0 pre-state, T1 compaction summary, T2 post-plan, T3
actions, T4 program-verified outcomes, and T5 follow-up when available; it does
not ask the causal judge to reconstruct T0/T1 from the derived State Diff.
Assistant prose such as “tests failed” or “rolled back” is contextual text, not
an engineering result. A consequence can be `VERIFIED` only by a structured
tool result with an exit code, `patch_apply_end`, or later bound Git/test/replay
evidence. Two stronger causal judges independently assess wrong action,
engineering consequence, state-loss causality, the ordinary-reasoning
alternative, Type A/B/C/D/U, and a distinguishing counterfactual. Their output
remains a machine prelabel until a hash-bound `HUMAN_CONFIRMED` causal answer
file is ingested by `calibrate-s0b-causal`.
The core causal question is whether the agent did something wrong because it
forgot or distorted still-active important state across compaction. A summary
omission alone, a normal plan update or phase transition, and ordinary
reasoning or implementation error are negatives, not drift.
This detection gate is only the first part of Question A. A successful
pre-action alert supports continuing to the minimal State Probe, Action Probe,
and baseline comparison; it does not by itself prove that Structured State
reduces drift, rework, tokens, elapsed time, or human intervention.
For a human `YES`, two agreeing evidence-bound causal judges may supply the
system Type A/B/C classification. The classification is written into the S0
evidence card, the card set is re-hashed, and any older S0 answer file therefore
fails closed and must be reviewed against the updated evidence.

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
