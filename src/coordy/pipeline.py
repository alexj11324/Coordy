from __future__ import annotations

import json
from pathlib import Path

from .ingest import ingest
from .mining import detect_invalidations, mine_drift_candidates
from .models import CanonicalEvent
from .protocol import initialize, write_reports
from .state import serializable, update_state


def _read_events(path: Path) -> list[CanonicalEvent]:
    events = []
    for line in path.read_text().splitlines():
        row = json.loads(line)
        row["file_paths"] = tuple(row.get("file_paths", []))
        events.append(CanonicalEvent(**row))
    return events


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows))


def run(input_path: Path, workspace: Path) -> dict[str, int]:
    initialize(workspace)
    manifest = ingest(input_path, workspace)
    events = _read_events(workspace / "data/canonical/events.jsonl")
    states = update_state(events)
    candidates = mine_drift_candidates(events)
    invalidations = detect_invalidations(events, states)
    _write_jsonl(workspace / "data/state/state_items.jsonl", serializable(states))
    _write_jsonl(workspace / "data/candidates/candidate_decision_points.jsonl", candidates)
    _write_jsonl(workspace / "data/candidates/invalidations.jsonl", invalidations)
    counts = {
        "events": len(events), "sessions": len({event.session_id for event in events}),
        "state_items": len(states), "drift_candidates": len(candidates),
        "invalidations": len(invalidations), "rejected_events": manifest["rejected_events"],
    }
    write_reports(workspace, counts)
    return counts
