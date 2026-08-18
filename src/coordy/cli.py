from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from . import __version__
from .action import (
    ResponsesAPIActionJudge,
    ResponsesAPIActionProbe,
    prepare_incident_action_packets,
    run_action_check,
    run_action_probe,
    run_action_probe_pair,
)
from .discovery import discover_codex_environment
from .incidents import (
    ResponsesAPIIncidentFragmentJudge,
    ResponsesAPIIncidentCausalPrelabelJudge,
    ResponsesAPIIncidentLinkJudge,
    adjudicate_incident_causal_review,
    build_incident_cases,
    prepare_incident_causal_inputs,
    prepare_incident_causal_review,
    prepare_cross_shard_incident_link_inputs,
    prepare_goal_global_incident_link_inputs,
    prepare_incident_fragment_inputs,
    prepare_incident_link_inputs,
    run_incident_fragment_judge,
    run_incident_causal_prelabels,
    run_incident_link_judge,
)
from .pipeline import run
from .protocol import initialize
from .review import adjudicate_s0, prepare_s0_review
from .review_ui import serve_incident_causal_review
from .replay import (
    ResponsesAPIReplayModel,
    prepare_incident_detection_replay,
    prepare_detection_replay,
    prepare_healthy_detection_replay,
    run_incident_detection_replay,
    run_detection_replay,
    score_detection_replay,
    score_healthy_false_alarms,
)
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
from .trajectory import (
    ResponsesAPITrajectoryJudge,
    aggregate_trajectory_discovery,
    prepare_trajectory_windows,
    run_trajectory_discovery,
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
    grade_smoke.add_argument("--model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
    grade_smoke.add_argument("--reasoning-effort", default="low")
    grade_smoke.add_argument("--env-file", type=Path, default=Path(".env.local"))
    grade_smoke.add_argument("--retry-http-504", action="store_true")
    grade_semantic = commands.add_parser(
        "grade-s0b-state", help="run primary and independent state continuity judges"
    )
    grade_semantic.add_argument("--workspace", type=Path, required=True)
    grade_semantic.add_argument("--primary-model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
    grade_semantic.add_argument("--secondary-model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
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
    grade_causal.add_argument("--primary-model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
    grade_causal.add_argument("--secondary-model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
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
    prepare_replay = commands.add_parser(
        "prepare-s0c-replay", help="freeze pre-action five-condition detection replay sources"
    )
    prepare_replay.add_argument("--workspace", type=Path, required=True)
    prepare_replay.add_argument("--evidence-audit", type=Path, required=True)
    prepare_incident_replay = commands.add_parser(
        "prepare-incident-detection-replay",
        help="freeze outcome-blinded five-condition replay sources from human T0-T5 labels",
    )
    prepare_incident_replay.add_argument("--workspace", type=Path, required=True)
    prepare_incident_replay.add_argument("--eligible-sessions", type=Path)
    prepare_incident_replay.add_argument("--commitment-findings", type=Path)
    prepare_healthy_replay = commands.add_parser(
        "prepare-s0c-healthy", help="freeze Goal-root-balanced healthy replay controls"
    )
    prepare_healthy_replay.add_argument("--source-workspace", type=Path, required=True)
    prepare_healthy_replay.add_argument("--workspace", type=Path, required=True)
    prepare_healthy_replay.add_argument("--evidence-audit", type=Path, required=True)
    prepare_healthy_replay.add_argument("--count", type=int, default=3)
    run_replay = commands.add_parser(
        "run-s0c-replay", help="run the five-condition pre-action detection replay"
    )
    run_replay.add_argument("--workspace", type=Path, required=True)
    run_replay.add_argument("--model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
    run_replay.add_argument("--reasoning-effort", default="low")
    run_replay.add_argument("--incremental-batch-size", type=int, default=8)
    run_replay.add_argument("--env-file", type=Path, default=Path(".env.local"))
    score_replay = commands.add_parser(
        "score-s0c-replay", help="score blinded S0c replay results against confirmed evidence"
    )
    score_replay.add_argument("--workspace", type=Path, required=True)
    score_replay.add_argument("--model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
    score_replay.add_argument("--reasoning-effort", default="low")
    score_replay.add_argument("--env-file", type=Path, default=Path(".env.local"))
    score_healthy = commands.add_parser(
        "score-s0c-healthy", help="score healthy replay controls for false alarms"
    )
    score_healthy.add_argument("--workspace", type=Path, required=True)
    action_check = commands.add_parser(
        "grade-action-check", help="run one source-grounded pre-action commitment check"
    )
    action_check.add_argument("--workspace", type=Path, required=True)
    action_check.add_argument("--packet", type=Path, required=True)
    action_check.add_argument("--model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
    action_check.add_argument("--reasoning-effort", default="low")
    action_check.add_argument("--env-file", type=Path, default=Path(".env.local"))
    action_probe = commands.add_parser(
        "run-action-probe", help="run the cutoff-bound next-action probe with an optional warning"
    )
    action_probe.add_argument("--workspace", type=Path, required=True)
    action_probe.add_argument("--packet", type=Path, required=True)
    action_probe.add_argument("--warning", type=Path)
    action_probe.add_argument("--model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
    action_probe.add_argument("--reasoning-effort", default="low")
    action_probe.add_argument("--env-file", type=Path, default=Path(".env.local"))
    action_probe_pair = commands.add_parser(
        "run-action-probe-pair", help="compare the same cutoff action probe with and without a warning"
    )
    action_probe_pair.add_argument("--workspace", type=Path, required=True)
    action_probe_pair.add_argument("--packet", type=Path, required=True)
    action_probe_pair.add_argument("--warning", type=Path, required=True)
    action_probe_pair.add_argument("--model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
    action_probe_pair.add_argument("--reasoning-effort", default="low")
    action_probe_pair.add_argument("--env-file", type=Path, default=Path(".env.local"))
    prepare_incident_action = commands.add_parser(
        "prepare-incident-action-packets",
        help="freeze source-bound pre-action packets from human T0-T5 labels",
    )
    prepare_incident_action.add_argument("--workspace", type=Path, required=True)
    prepare_incident_action.add_argument("--eligible-sessions", type=Path)
    prepare_incident_action.add_argument("--commitment-findings", type=Path)
    prepare_trajectory = commands.add_parser(
        "prepare-trajectory", help="build uncapped natural compaction windows for discovery"
    )
    prepare_trajectory.add_argument("--source-workspace", type=Path, required=True)
    prepare_trajectory.add_argument("--workspace", type=Path, required=True)
    grade_trajectory = commands.add_parser(
        "grade-trajectory", help="run forward or independent backward Luna discovery"
    )
    grade_trajectory.add_argument("--workspace", type=Path, required=True)
    grade_trajectory.add_argument("--direction", choices=["forward", "backward"], required=True)
    grade_trajectory.add_argument("--model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
    grade_trajectory.add_argument("--reasoning-effort", default="low")
    grade_trajectory.add_argument("--workers", type=int, default=5)
    grade_trajectory.add_argument("--env-file", type=Path, default=Path(".env.local"))
    grade_trajectory.add_argument("--retry-http-504", action="store_true")
    grade_trajectory.add_argument("--retry-http-502", action="store_true")
    aggregate_trajectory = commands.add_parser(
        "aggregate-trajectory", help="bind and union complete forward/backward discovery"
    )
    aggregate_trajectory.add_argument("--workspace", type=Path, required=True)
    prepare_incidents = commands.add_parser(
        "prepare-incident-fragments", help="bind one event-fragment packet per real compaction"
    )
    prepare_incidents.add_argument("--workspace", type=Path, required=True)
    grade_incidents = commands.add_parser(
        "grade-incident-fragments", help="group local discovery paraphrases by source event"
    )
    grade_incidents.add_argument("--workspace", type=Path, required=True)
    grade_incidents.add_argument("--model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
    grade_incidents.add_argument("--reasoning-effort", default="low")
    grade_incidents.add_argument("--workers", type=int, default=5)
    grade_incidents.add_argument("--env-file", type=Path, default=Path(".env.local"))
    grade_incidents.add_argument("--retry-http-504", action="store_true")
    grade_incidents.add_argument("--retry-http-502", action="store_true")
    prepare_incident_links = commands.add_parser(
        "prepare-incident-links",
        help="merge exact source-event duplicates and freeze complete semantic-link packets",
    )
    prepare_incident_links.add_argument("--workspace", type=Path, required=True)
    grade_incident_links = commands.add_parser(
        "grade-incident-links", help="semantically partition cross-compaction event components"
    )
    grade_incident_links.add_argument("--workspace", type=Path, required=True)
    grade_incident_links.add_argument("--model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
    grade_incident_links.add_argument("--reasoning-effort", default="low")
    grade_incident_links.add_argument("--workers", type=int, default=5)
    grade_incident_links.add_argument("--env-file", type=Path, default=Path(".env.local"))
    grade_incident_links.add_argument("--retry-http-504", action="store_true")
    grade_incident_links.add_argument("--retry-http-502", action="store_true")
    prepare_cross_links = commands.add_parser(
        "prepare-cross-incident-links",
        help="freeze a complete second-pass link over first-pass event clusters",
    )
    prepare_cross_links.add_argument("--workspace", type=Path, required=True)
    grade_cross_links = commands.add_parser(
        "grade-cross-incident-links", help="merge event clusters across transport shards"
    )
    grade_cross_links.add_argument("--workspace", type=Path, required=True)
    grade_cross_links.add_argument("--model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
    grade_cross_links.add_argument("--reasoning-effort", default="low")
    grade_cross_links.add_argument("--workers", type=int, default=5)
    grade_cross_links.add_argument("--env-file", type=Path, default=Path(".env.local"))
    grade_cross_links.add_argument("--retry-http-504", action="store_true")
    grade_cross_links.add_argument("--retry-http-502", action="store_true")
    prepare_global_links = commands.add_parser(
        "prepare-global-incident-links", help="freeze one final semantic-link packet per Goal root"
    )
    prepare_global_links.add_argument("--workspace", type=Path, required=True)
    grade_global_links = commands.add_parser(
        "grade-global-incident-links", help="globally deduplicate events within each Goal root"
    )
    grade_global_links.add_argument("--workspace", type=Path, required=True)
    grade_global_links.add_argument("--model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
    grade_global_links.add_argument("--reasoning-effort", default="low")
    grade_global_links.add_argument("--workers", type=int, default=5)
    grade_global_links.add_argument("--timeout-seconds", type=int, default=300)
    grade_global_links.add_argument("--env-file", type=Path, default=Path(".env.local"))
    grade_global_links.add_argument("--retry-http-504", action="store_true")
    grade_global_links.add_argument("--retry-http-502", action="store_true")
    build_cases = commands.add_parser(
        "build-incident-cases", help="resolve final event clusters to frozen source evidence"
    )
    build_cases.add_argument("--workspace", type=Path, required=True)
    prepare_incident_causal = commands.add_parser(
        "prepare-incident-causal",
        help="bind every final review bundle to exact source events and compaction boundaries",
    )
    prepare_incident_causal.add_argument("--workspace", type=Path, required=True)
    grade_incident_causal = commands.add_parser(
        "grade-incident-causal",
        help="split every review bundle into source-bound T0-T5 machine prelabels",
    )
    grade_incident_causal.add_argument("--workspace", type=Path, required=True)
    grade_incident_causal.add_argument("--model", choices=["gpt-5.6-luna"], default="gpt-5.6-luna")
    grade_incident_causal.add_argument("--reasoning-effort", default="low")
    grade_incident_causal.add_argument("--workers", type=int, default=5)
    grade_incident_causal.add_argument("--timeout-seconds", type=int, default=600)
    grade_incident_causal.add_argument("--env-file", type=Path, default=Path(".env.local"))
    grade_incident_causal.add_argument("--retry-http-504", action="store_true")
    grade_incident_causal.add_argument("--retry-http-502", action="store_true")
    grade_incident_causal.add_argument(
        "--allow-legacy-unassessable", action="store_true",
        help="convert legacy checkpoints without durable accepted results into explicit UNASSESSABLE records",
    )
    prepare_incident_review = commands.add_parser(
        "prepare-incident-causal-review",
        help="freeze a complete source-bound human T0-T5 review queue",
    )
    prepare_incident_review.add_argument("--workspace", type=Path, required=True)
    adjudicate_incident_review = commands.add_parser(
        "adjudicate-incident-causal-review",
        help="validate and persist complete human T0-T5 answers",
    )
    adjudicate_incident_review.add_argument("--workspace", type=Path, required=True)
    adjudicate_incident_review.add_argument("--answers", type=Path, required=True)
    serve_incident_review = commands.add_parser(
        "serve-incident-causal-review",
        help="serve the local click-to-review human causal triage website",
    )
    serve_incident_review.add_argument("--workspace", type=Path, required=True)
    serve_incident_review.add_argument("--host", default="127.0.0.1")
    serve_incident_review.add_argument("--port", type=int, default=8765)
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
            allow_http_504_retry=args.retry_http_504,
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
    elif args.command == "prepare-incident-action-packets":
        print(json.dumps(prepare_incident_action_packets(
            args.workspace,
            eligible_sessions_path=args.eligible_sessions,
            commitment_findings_path=args.commitment_findings,
        ), sort_keys=True))
    elif args.command == "grade-action-check":
        api_key, base_url = _judge_api_settings(args.env_file)
        judge = ResponsesAPIActionJudge(
            judge_id=f"responses-action-v1:{args.model}", api_key=api_key, base_url=base_url,
            model=args.model, reasoning_effort=args.reasoning_effort,
            dispatch_log_dir=args.workspace / "data/screening/api_dispatch_action",
        )
        print(json.dumps(run_action_check(
            packet_path=args.packet, workspace=args.workspace, judge=judge,
        ), sort_keys=True))
    elif args.command == "run-action-probe":
        api_key, base_url = _judge_api_settings(args.env_file)
        probe = ResponsesAPIActionProbe(
            judge_id=f"responses-action-probe-v1:{args.model}", api_key=api_key, base_url=base_url,
            model=args.model, reasoning_effort=args.reasoning_effort,
            dispatch_log_dir=args.workspace / "data/screening/api_dispatch_action_probe",
        )
        print(json.dumps(run_action_probe(
            packet_path=args.packet, workspace=args.workspace, probe=probe,
            warning_path=args.warning,
        ), sort_keys=True))
    elif args.command == "run-action-probe-pair":
        api_key, base_url = _judge_api_settings(args.env_file)
        probe = ResponsesAPIActionProbe(
            judge_id=f"responses-action-probe-v1:{args.model}", api_key=api_key, base_url=base_url,
            model=args.model, reasoning_effort=args.reasoning_effort,
            dispatch_log_dir=args.workspace / "data/screening/api_dispatch_action_probe",
        )
        print(json.dumps(run_action_probe_pair(
            packet_path=args.packet, workspace=args.workspace, probe=probe,
            warning_path=args.warning,
        ), sort_keys=True))
    elif args.command == "prepare-trajectory":
        print(json.dumps(prepare_trajectory_windows(
            args.source_workspace, args.workspace,
        ), sort_keys=True))
    elif args.command == "grade-trajectory":
        api_key, base_url = _judge_api_settings(args.env_file)
        judge = ResponsesAPITrajectoryJudge(
            direction=args.direction,
            judge_id=f"responses-trajectory-{args.direction}:{args.model}",
            api_key=api_key, base_url=base_url, model=args.model,
            reasoning_effort=args.reasoning_effort,
            dispatch_log_dir=args.workspace / f"data/screening/api_dispatch_trajectory_{args.direction}",
            allow_http_504_retry=args.retry_http_504,
            allow_http_502_retry=args.retry_http_502,
        )
        print(json.dumps(run_trajectory_discovery(
            args.workspace, judge, workers=args.workers,
        ), sort_keys=True))
    elif args.command == "aggregate-trajectory":
        print(json.dumps(aggregate_trajectory_discovery(args.workspace), sort_keys=True))
    elif args.command == "prepare-incident-fragments":
        print(json.dumps(prepare_incident_fragment_inputs(args.workspace), sort_keys=True))
    elif args.command == "grade-incident-fragments":
        api_key, base_url = _judge_api_settings(args.env_file)
        judge = ResponsesAPIIncidentFragmentJudge(
            judge_id=f"responses-incident-fragments:{args.model}",
            api_key=api_key, base_url=base_url, model=args.model,
            reasoning_effort=args.reasoning_effort,
            dispatch_log_dir=args.workspace / "data/screening/api_dispatch_incident_fragments",
            allow_http_504_retry=args.retry_http_504,
            allow_http_502_retry=args.retry_http_502,
        )
        print(json.dumps(run_incident_fragment_judge(
            args.workspace, judge, workers=args.workers,
        ), sort_keys=True))
    elif args.command == "prepare-incident-links":
        print(json.dumps(prepare_incident_link_inputs(args.workspace), sort_keys=True))
    elif args.command == "grade-incident-links":
        api_key, base_url = _judge_api_settings(args.env_file)
        judge = ResponsesAPIIncidentLinkJudge(
            judge_id=f"responses-incident-links:{args.model}",
            api_key=api_key, base_url=base_url, model=args.model,
            reasoning_effort=args.reasoning_effort,
            dispatch_log_dir=args.workspace / "data/screening/api_dispatch_incident_links_v3",
            allow_http_504_retry=args.retry_http_504,
            allow_http_502_retry=args.retry_http_502,
        )
        print(json.dumps(run_incident_link_judge(
            args.workspace, judge, workers=args.workers,
        ), sort_keys=True))
    elif args.command == "prepare-cross-incident-links":
        print(json.dumps(prepare_cross_shard_incident_link_inputs(args.workspace), sort_keys=True))
    elif args.command == "grade-cross-incident-links":
        api_key, base_url = _judge_api_settings(args.env_file)
        judge = ResponsesAPIIncidentLinkJudge(
            judge_id=f"responses-cross-incident-links:{args.model}",
            api_key=api_key, base_url=base_url, model=args.model,
            reasoning_effort=args.reasoning_effort,
            dispatch_log_dir=args.workspace / "data/screening/api_dispatch_cross_incident_links_v1",
            allow_http_504_retry=args.retry_http_504,
            allow_http_502_retry=args.retry_http_502,
        )
        print(json.dumps(run_incident_link_judge(
            args.workspace, judge, workers=args.workers,
            input_name="incident_cross_shard_inputs_v1.jsonl",
            result_name="incident_cross_shard_results_v1.jsonl",
            input_manifest_key="incident_cross_shard_inputs_v1",
            grading_manifest_key="incident_cross_shard_grading_v1",
        ), sort_keys=True))
    elif args.command == "prepare-global-incident-links":
        print(json.dumps(prepare_goal_global_incident_link_inputs(args.workspace), sort_keys=True))
    elif args.command == "grade-global-incident-links":
        api_key, base_url = _judge_api_settings(args.env_file)
        judge = ResponsesAPIIncidentLinkJudge(
            judge_id=f"responses-global-incident-links:{args.model}",
            api_key=api_key, base_url=base_url, model=args.model,
            reasoning_effort=args.reasoning_effort,
            timeout_seconds=args.timeout_seconds,
            dispatch_log_dir=args.workspace / "data/screening/api_dispatch_global_incident_links_v1",
            allow_http_504_retry=args.retry_http_504,
            allow_http_502_retry=args.retry_http_502,
        )
        print(json.dumps(run_incident_link_judge(
            args.workspace, judge, workers=args.workers,
            input_name="incident_goal_global_inputs_v1.jsonl",
            result_name="incident_goal_global_results_v1.jsonl",
            input_manifest_key="incident_goal_global_inputs_v1",
            grading_manifest_key="incident_goal_global_grading_v1",
        ), sort_keys=True))
    elif args.command == "build-incident-cases":
        print(json.dumps(build_incident_cases(args.workspace), sort_keys=True))
    elif args.command == "prepare-incident-causal":
        print(json.dumps(prepare_incident_causal_inputs(args.workspace), sort_keys=True))
    elif args.command == "grade-incident-causal":
        api_key, base_url = _judge_api_settings(args.env_file)
        judge = ResponsesAPIIncidentCausalPrelabelJudge(
            judge_id=f"responses-incident-causal:{args.model}",
            api_key=api_key, base_url=base_url, model=args.model,
            reasoning_effort=args.reasoning_effort, timeout_seconds=args.timeout_seconds,
            dispatch_log_dir=args.workspace / "data/screening/api_dispatch_incident_causal_v1",
            allow_http_504_retry=args.retry_http_504,
            allow_http_502_retry=args.retry_http_502,
        )
        print(json.dumps(run_incident_causal_prelabels(
            args.workspace, judge, workers=args.workers,
            allow_legacy_unassessable=args.allow_legacy_unassessable,
        ), sort_keys=True))
    elif args.command == "prepare-incident-causal-review":
        print(json.dumps(prepare_incident_causal_review(args.workspace), sort_keys=True))
    elif args.command == "adjudicate-incident-causal-review":
        print(json.dumps(
            adjudicate_incident_causal_review(args.workspace, args.answers),
            sort_keys=True,
        ))
    elif args.command == "serve-incident-causal-review":
        serve_incident_causal_review(
            args.workspace,
            host=args.host,
            port=args.port,
        )
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
    elif args.command == "prepare-s0c-replay":
        print(json.dumps(prepare_detection_replay(
            args.workspace, args.evidence_audit
        ), sort_keys=True))
    elif args.command == "prepare-incident-detection-replay":
        print(json.dumps(prepare_incident_detection_replay(
            args.workspace,
            eligible_sessions_path=args.eligible_sessions,
            commitment_findings_path=args.commitment_findings,
        ), sort_keys=True))
    elif args.command == "prepare-s0c-healthy":
        print(json.dumps(prepare_healthy_detection_replay(
            args.source_workspace,
            args.workspace,
            args.evidence_audit,
            healthy_count=args.count,
        ), sort_keys=True))
    elif args.command == "run-s0c-replay":
        api_key, base_url = _judge_api_settings(args.env_file)
        replay_model = ResponsesAPIReplayModel(
            api_key=api_key,
            base_url=base_url,
            model=args.model,
            reasoning_effort=args.reasoning_effort,
            dispatch_log_dir=args.workspace / "data/screening/api_dispatch_s0c",
        )
        replay_manifest = json.loads(
            (args.workspace / "data/screening/s0c_detection_replay_manifest.json").read_text(encoding="utf-8")
        )
        runner = (
            run_incident_detection_replay
            if replay_manifest.get("source_protocol_version") == "incident-causal-ground-truth-v1"
            else run_detection_replay
        )
        print(json.dumps(runner(
            args.workspace,
            replay_model,
            incremental_batch_size=args.incremental_batch_size,
        ), sort_keys=True))
    elif args.command == "score-s0c-replay":
        api_key, base_url = _judge_api_settings(args.env_file)
        replay_model = ResponsesAPIReplayModel(
            api_key=api_key,
            base_url=base_url,
            model=args.model,
            reasoning_effort=args.reasoning_effort,
            dispatch_log_dir=args.workspace / "data/screening/api_dispatch_s0c",
        )
        print(json.dumps(score_detection_replay(args.workspace, replay_model), sort_keys=True))
    elif args.command == "score-s0c-healthy":
        print(json.dumps(score_healthy_false_alarms(args.workspace), sort_keys=True))
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
