from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from . import __version__
from .discovery import discover_codex_environment
from .pipeline import run
from .protocol import initialize
from .review import adjudicate_s0, prepare_s0_review
from .screening import run_s0_screening
from .semantic import (
    ResponsesAPICausalJudge,
    ResponsesAPIStateJudge,
    adjudicate_s0b_causal_review,
    adjudicate_s0b_state_calibration,
    prepare_s0b_causal_inputs,
    prepare_s0b_state_smoke,
    prepare_s0b_state_inputs,
    run_s0b_causal_judges,
    run_s0b_state_smoke,
    run_s0b_state_diff,
)


def _judge_api_settings(env_file: Path) -> tuple[str, str]:
    values: dict[str, str] = {}
    if env_file.is_file():
        if env_file.stat().st_mode & 0o077:
            raise RuntimeError(f"judge env file must be private (0600): {env_file}")
        for line_number, raw_line in enumerate(env_file.read_text(encoding="utf-8").splitlines(), 1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                raise RuntimeError(f"invalid judge env line {line_number}")
            key, value = line.split("=", 1)
            if key not in {"COORDY_JUDGE_API_KEY", "COORDY_JUDGE_BASE_URL"}:
                raise RuntimeError(f"unexpected judge env key on line {line_number}")
            if key in values or not value:
                raise RuntimeError(f"invalid or duplicate judge env key on line {line_number}")
            values[key] = value
    api_key = os.environ.get("COORDY_JUDGE_API_KEY") or values.get("COORDY_JUDGE_API_KEY")
    base_url = os.environ.get("COORDY_JUDGE_BASE_URL") or values.get("COORDY_JUDGE_BASE_URL")
    if not api_key or not base_url:
        raise RuntimeError(
            "COORDY_JUDGE_API_KEY and COORDY_JUDGE_BASE_URL must be set in the environment "
            f"or {env_file}"
        )
    return api_key, base_url


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="coordy", description="Agent coordination validation harness")
    root.add_argument("--version", action="version", version=__version__)
    commands = root.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="freeze a validation protocol")
    init.add_argument("--workspace", type=Path, required=True)
    discover = commands.add_parser("discover", help="discover read-only Codex history interfaces")
    discover.add_argument("--workspace", type=Path, required=True)
    discover.add_argument("--codex-home", type=Path)
    discover.add_argument("--codex-executable", type=Path)
    screen = commands.add_parser("screen", help="run bounded low-cost S0 prevalence screening")
    screen.add_argument("--workspace", type=Path, required=True)
    screen.add_argument("--codex-home", type=Path, default=Path.home() / ".codex")
    screen.add_argument("--max-sessions", type=int, default=100)
    screen.add_argument("--exclude-session", action="append", default=[])
    screen.add_argument("--goals-db", type=Path)
    screen.add_argument("--min-goal-seconds", type=int, default=7200)
    review = commands.add_parser("review-s0", help="prepare privacy-safe S0 evidence cards")
    review.add_argument("--workspace", type=Path, required=True)
    review.add_argument("--max-reviews", type=int, default=12)
    adjudicate = commands.add_parser("adjudicate-s0", help="apply frozen S0 gates to reviewed evidence")
    adjudicate.add_argument("--workspace", type=Path, required=True)
    adjudicate.add_argument("--answers", type=Path, required=True)
    prepare_semantic = commands.add_parser(
        "prepare-s0b", help="prepare outcome-blinded state continuity inputs"
    )
    prepare_semantic.add_argument("--workspace", type=Path, required=True)
    prepare_smoke = commands.add_parser(
        "prepare-s0b-smoke", help="freeze a privacy-bound State Diff smoke sample"
    )
    prepare_smoke.add_argument("--workspace", type=Path, required=True)
    prepare_smoke.add_argument("--sample-size", type=int, default=12)
    prepare_smoke.add_argument("--no-post-plan-controls", type=int, default=3)
    grade_smoke = commands.add_parser(
        "grade-s0b-smoke", help="grade only an explicitly approved frozen smoke payload"
    )
    grade_smoke.add_argument("--workspace", type=Path, required=True)
    grade_smoke.add_argument("--approved-smoke-sha256", required=True)
    grade_smoke.add_argument("--approved-judge-configuration-sha256", required=True)
    grade_smoke.add_argument("--model", default="gpt-5.6-luna")
    grade_smoke.add_argument("--reasoning-effort", default="low")
    grade_smoke.add_argument("--env-file", type=Path, default=Path(".env.local"))
    grade_semantic = commands.add_parser(
        "grade-s0b-state", help="run primary and independent state continuity judges"
    )
    grade_semantic.add_argument("--workspace", type=Path, required=True)
    grade_semantic.add_argument("--primary-model", default="gpt-5.6-luna")
    grade_semantic.add_argument("--secondary-model", default="gpt-5.6-luna")
    grade_semantic.add_argument("--batch-size", type=int, default=1)
    grade_semantic.add_argument("--workers", type=int, default=1)
    grade_semantic.add_argument("--reasoning-effort", default="low")
    grade_semantic.add_argument("--env-file", type=Path, default=Path(".env.local"))
    grade_semantic.add_argument("--retry-http-504", action="store_true")
    prepare_causal = commands.add_parser(
        "prepare-s0b-causal", help="bind program-verified outcomes to state-change suspects"
    )
    prepare_causal.add_argument("--workspace", type=Path, required=True)
    grade_causal = commands.add_parser(
        "grade-s0b-causal", help="run two stronger causal judges over semantic suspects"
    )
    grade_causal.add_argument("--workspace", type=Path, required=True)
    grade_causal.add_argument("--primary-model", default="gpt-5.6-sol")
    grade_causal.add_argument("--secondary-model", default="gpt-5.6-sol")
    grade_causal.add_argument("--workers", type=int, default=2)
    grade_causal.add_argument("--reasoning-effort", default="medium")
    grade_causal.add_argument("--env-file", type=Path, default=Path(".env.local"))
    calibrate_state = commands.add_parser(
        "calibrate-s0b-state", help="measure State Diff judges against bound human answers"
    )
    calibrate_state.add_argument("--workspace", type=Path, required=True)
    calibrate_state.add_argument("--answers", type=Path, required=True)
    calibrate_causal = commands.add_parser(
        "calibrate-s0b-causal", help="measure causal prelabels against bound human answers"
    )
    calibrate_causal.add_argument("--workspace", type=Path, required=True)
    calibrate_causal.add_argument("--answers", type=Path, required=True)
    execute = commands.add_parser("run", help="ingest and analyze an authorized export")
    execute.add_argument("--input", type=Path, required=True)
    execute.add_argument("--workspace", type=Path, required=True)
    summary = commands.add_parser("summary", help="print the evidence summary")
    summary.add_argument("--workspace", type=Path, required=True)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.command == "init":
        initialize(args.workspace)
        print(json.dumps({"workspace": str(args.workspace), "status": "initialized"}))
    elif args.command == "discover":
        print(json.dumps(discover_codex_environment(
            args.workspace,
            codex_home=args.codex_home,
            codex_executable=args.codex_executable,
        ), sort_keys=True))
    elif args.command == "screen":
        default_goals_db = args.codex_home / "goals_1.sqlite"
        goals_db = args.goals_db if args.goals_db is not None else (
            default_goals_db if default_goals_db.is_file() else None
        )
        print(json.dumps(run_s0_screening(
            args.workspace,
            [args.codex_home / "sessions", args.codex_home / "archived_sessions"],
            max_sessions=args.max_sessions,
            exclude_session_ids=args.exclude_session,
            goal_db=goals_db,
            min_goal_seconds=args.min_goal_seconds,
        ), sort_keys=True))
    elif args.command == "review-s0":
        print(json.dumps(prepare_s0_review(args.workspace, max_reviews=args.max_reviews), sort_keys=True))
    elif args.command == "adjudicate-s0":
        print(json.dumps(adjudicate_s0(args.workspace, args.answers), sort_keys=True))
    elif args.command == "prepare-s0b":
        print(json.dumps(prepare_s0b_state_inputs(args.workspace), sort_keys=True))
    elif args.command == "prepare-s0b-smoke":
        print(json.dumps(prepare_s0b_state_smoke(
            args.workspace,
            sample_size=args.sample_size,
            no_post_plan_quota=args.no_post_plan_controls,
        ), sort_keys=True))
    elif args.command == "grade-s0b-smoke":
        api_key, base_url = _judge_api_settings(args.env_file)
        judge = ResponsesAPIStateJudge(
            judge_id=f"responses-state-smoke:{args.model}",
            api_key=api_key,
            base_url=base_url,
            model=args.model,
            reasoning_effort=args.reasoning_effort,
            dispatch_log_dir=args.workspace / "data/screening/api_dispatch",
        )
        print(json.dumps(run_s0b_state_smoke(
            args.workspace,
            judge,
            args.approved_smoke_sha256,
            args.approved_judge_configuration_sha256,
            workers=1,
        ), sort_keys=True))
    elif args.command == "grade-s0b-state":
        api_key, base_url = _judge_api_settings(args.env_file)
        primary = ResponsesAPIStateJudge(
            judge_id=f"responses-primary:{args.primary_model}",
            api_key=api_key,
            base_url=base_url,
            model=args.primary_model,
            reasoning_effort=args.reasoning_effort,
            dispatch_log_dir=args.workspace / "data/screening/api_dispatch",
            allow_http_504_retry=args.retry_http_504,
        )
        secondary = ResponsesAPIStateJudge(
            judge_id=f"responses-secondary-targeted:{args.secondary_model}",
            api_key=api_key,
            base_url=base_url,
            model=args.secondary_model,
            reasoning_effort=args.reasoning_effort,
            dispatch_log_dir=args.workspace / "data/screening/api_dispatch",
            allow_http_504_retry=args.retry_http_504,
        )
        print(json.dumps(run_s0b_state_diff(
            args.workspace,
            primary,
            secondary,
            batch_size=args.batch_size,
            workers=args.workers,
        ), sort_keys=True))
    elif args.command == "prepare-s0b-causal":
        print(json.dumps(prepare_s0b_causal_inputs(args.workspace), sort_keys=True))
    elif args.command == "grade-s0b-causal":
        api_key, base_url = _judge_api_settings(args.env_file)
        primary = ResponsesAPICausalJudge(
            judge_id=f"responses-primary-causal:{args.primary_model}",
            api_key=api_key,
            base_url=base_url,
            model=args.primary_model,
            reasoning_effort=args.reasoning_effort,
            dispatch_log_dir=args.workspace / "data/screening/api_dispatch",
        )
        secondary = ResponsesAPICausalJudge(
            judge_id=f"responses-secondary-causal:{args.secondary_model}",
            api_key=api_key,
            base_url=base_url,
            model=args.secondary_model,
            reasoning_effort=args.reasoning_effort,
            dispatch_log_dir=args.workspace / "data/screening/api_dispatch",
        )
        print(json.dumps(run_s0b_causal_judges(
            args.workspace,
            primary,
            secondary,
            workers=args.workers,
        ), sort_keys=True))
    elif args.command == "calibrate-s0b-state":
        print(json.dumps(adjudicate_s0b_state_calibration(
            args.workspace, args.answers
        ), sort_keys=True))
    elif args.command == "calibrate-s0b-causal":
        print(json.dumps(adjudicate_s0b_causal_review(
            args.workspace, args.answers
        ), sort_keys=True))
    elif args.command == "run":
        print(json.dumps(run(args.input, args.workspace), sort_keys=True))
    else:
        path = args.workspace / "data/reports/evidence_summary.json"
        if not path.is_file():
            raise SystemExit(f"missing report: {path}")
        print(path.read_text(), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
