# Coordy implementation invariants

- Treat `.local-specs/coordy-execution-agent-prompt.md`,
  `.local-specs/coordy-validation-plan.md`, and the operator-supplied local
  research report as execution context. `.local-specs/` is private and must
  never be staged or committed.
- S0a is deterministic evidence infrastructure only. Rules may parse events,
  enumerate opportunities, verify tool facts, and rank candidates; they may
  not infer state loss, causality, failure type, or prevalence.
- S0b semantic grading must cover every compaction opportunity with an
  outcome-blinded State Diff. Stronger causal judges run only after state
  grading and may count an engineering consequence only from program-verified
  Git/test/tool/patch/replay evidence.
- Machine judges produce prelabels, not ground truth. Independent judging,
  evidence-ID validation, readable human calibration, and fail-closed artifact
  lineage are required before any Screening decision.
- Keep original Codex history read-only. Persist only redacted excerpts, hashed
  identities, safe structured facts, and SHA-256/run-ID provenance. Unknown,
  changing, mixed, or tampered inputs fail closed.
- Goal descendants are observations within a Goal-root cluster, not independent
  long tasks. `goal_time_used_seconds` is observed Codex Goal time, not a human
  task-duration or METR-horizon claim.
- Screening may emit only `STOP`, `PIVOT`, or `PROCEED_TO_CONFIRMATION`; it may
  never emit `GO`.

## Scope and stopping rule

Coordy is currently a low-cost falsification experiment, not a production
platform. Apply instructions in this order:

1. The user's explicit current request.
2. The current phase's frozen acceptance criteria.
3. Data-safety and experimental-validity invariants above.
4. Optional robustness and future extensibility.

Lower-priority concerns must not expand a higher-priority task. Implement the
smallest complete change that satisfies the frozen acceptance criteria, run the
matching real validation, and stop when those criteria pass.

Do not add automatic retries, compatibility layers, provider abstractions,
distributed recovery, migration frameworks, or production hardening unless a
failure on the current approved path demonstrates the need. A smoke test or
research probe must not be designed as a production service.

Review findings block the current task only when they show a reproducible
failure on the approved path that would make the present result unsafe,
incorrect, or unauditable. Record theoretical, future-deployment, or inactive-
path risks as follow-ups instead of expanding the current implementation.

If a proposed change would materially expand the approved scope, report the
evidence and ask before implementing it. Do not create a shared abstraction
without at least two current, concrete consumers.

## Cursor Cloud specific instructions

Coordy is a pure-Python (>=3.11) research CLI with zero third-party runtime
dependencies; there is no long-running backend, database server, or container
to start. The only required "service" is the `coordy` CLI operating on a local
`.coordy/` workspace. Development commands are the same as CI
(`.github/workflows/ci.yml`) and the README Quick start.

- A `.venv` virtualenv at the repo root is the working environment. Activate it
  (`. .venv/bin/activate`) or call binaries directly (`.venv/bin/coordy`,
  `.venv/bin/python`) before running anything. The startup update script
  recreates/refreshes it, so `python -m pip install -e .` normally does not need
  to be rerun by hand.
- Lint/static checks (no ruff/black/flake8 configured): `python -m pip check`,
  `python -m compileall -q src`, and `node --check web/incident-review/app.js`
  for the static browser UI. Tests: `python -m unittest discover -s tests -v`.
  Build: `python -m build`.
- Known pre-existing test failure (not an environment issue):
  `test_s0_excludes_guardian_sessions_and_does_not_treat_turn_settings_as_compaction`
  in `tests/test_coordy.py` fails deterministically (`auxiliary_sessions_excluded`
  is 0, expected 1). All other 123 tests pass. Do not treat this as a broken
  setup.
- End-to-end smoke without any credentials: `coordy run --input
  examples/synthetic_sessions.jsonl --workspace .coordy/demo` then `coordy
  summary --workspace .coordy/demo`. S0a is deterministic and correctly reports
  `INSUFFICIENT_EVIDENCE` / `PENDING_EVIDENCE_REVIEW`; that is expected, not a
  failure.
- Model-graded S0b/causal stages and `grade-*` commands require an
  OpenAI-compatible Responses API via a private `0600` `.env.local`
  (`COORDY_JUDGE_API_KEY`, `COORDY_JUDGE_BASE_URL`; see `.env.example`). These
  are optional and not needed for S0a, `run`, or the test suite.
- The review web UI (`coordy serve-incident-causal-review`, loopback
  `127.0.0.1:8765`) is optional and only loads once the upstream
  incident-causal review artifacts exist (i.e. after the LLM-graded pipeline);
  it fails closed on a bare workspace. Its store logic is covered by
  `tests/test_review_ui.py`.
