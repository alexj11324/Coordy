from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import __version__
from .pipeline import run
from .protocol import initialize


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="coordy", description="Agent coordination validation harness")
    root.add_argument("--version", action="version", version=__version__)
    commands = root.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="freeze a validation protocol")
    init.add_argument("--workspace", type=Path, required=True)
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
