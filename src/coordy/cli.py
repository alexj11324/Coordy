from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import __version__
from .discovery import discover_codex_environment
from .pipeline import run
from .protocol import initialize
from .review import adjudicate_s0, prepare_s0_review
from .screening import run_s0_screening


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
    review = commands.add_parser("review-s0", help="prepare privacy-safe S0 evidence cards")
    review.add_argument("--workspace", type=Path, required=True)
    review.add_argument("--max-reviews", type=int, default=12)
    adjudicate = commands.add_parser("adjudicate-s0", help="apply frozen S0 gates to reviewed evidence")
    adjudicate.add_argument("--workspace", type=Path, required=True)
    adjudicate.add_argument("--answers", type=Path, required=True)
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
        print(json.dumps(run_s0_screening(
            args.workspace,
            [args.codex_home / "sessions", args.codex_home / "archived_sessions"],
            max_sessions=args.max_sessions,
            exclude_session_ids=args.exclude_session,
        ), sort_keys=True))
    elif args.command == "review-s0":
        print(json.dumps(prepare_s0_review(args.workspace, max_reviews=args.max_reviews), sort_keys=True))
    elif args.command == "adjudicate-s0":
        print(json.dumps(adjudicate_s0(args.workspace, args.answers), sort_keys=True))
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
