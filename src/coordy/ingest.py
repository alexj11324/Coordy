from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import defaultdict
from pathlib import Path
from typing import Any

from .models import CanonicalEvent
from .redaction import redact_value
from .sources import JsonExportSource

SCHEMA_VERSION = 1


def _stable_event_id(session_id: str, offset: int, row: dict[str, Any]) -> str:
    basis = json.dumps([session_id, offset, row], sort_keys=True, default=str).encode()
    return "evt_" + hashlib.sha256(basis).hexdigest()[:20]


def normalize(source: JsonExportSource) -> tuple[list[CanonicalEvent], dict[str, Any]]:
    events: list[CanonicalEvent] = []
    errors: list[dict[str, Any]] = []
    redactions = 0
    for session_id in source.list_sessions():
        sequence = 0
        for offset, raw in source.iter_events(session_id):
            try:
                clean, count = redact_value(raw)
                redactions += count
                content = clean.get("content", "")
                if not isinstance(content, str):
                    content = json.dumps(content, sort_keys=True)
                event = CanonicalEvent(
                    event_id=str(clean.get("event_id") or _stable_event_id(session_id, offset, clean)),
                    session_id=session_id,
                    timestamp=str(clean["timestamp"]),
                    sequence_number=int(clean.get("sequence_number", sequence)),
                    actor=str(clean["actor"]),
                    event_type=str(clean.get("event_type", "message")),
                    content=content,
                    tool_name=clean.get("tool_name"),
                    tool_input=clean.get("tool_input"),
                    tool_output=clean.get("tool_output"),
                    cwd=clean.get("cwd"),
                    file_paths=tuple(str(p) for p in clean.get("file_paths", [])),
                    parent_event_id=clean.get("parent_event_id"),
                    source_artifact=str(source.path),
                    source_offset=offset,
                    source_hash=source.source_hash,
                )
                events.append(event)
                sequence += 1
            except (KeyError, TypeError, ValueError) as exc:
                errors.append({"session_id": session_id, "source_offset": offset, "error": str(exc)})
    events.sort(key=lambda event: (event.session_id, event.timestamp, event.sequence_number))
    return events, {"errors": errors, "redaction_count": redactions}


def write_jsonl(events: list[CanonicalEvent], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps(event.to_dict(), sort_keys=True) + "\n")


def build_index(events: list[CanonicalEvent], database: Path) -> None:
    database.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database)
    try:
        connection.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events (
                event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, timestamp TEXT NOT NULL,
                sequence_number INTEGER NOT NULL, actor TEXT NOT NULL, event_type TEXT NOT NULL,
                content TEXT NOT NULL, file_paths TEXT NOT NULL, source_hash TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS events_session_time ON events(session_id, timestamp, sequence_number);
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
                message_count INTEGER NOT NULL, tool_call_count INTEGER NOT NULL
            );
        """)
        # A workspace represents one reproducible input snapshot. Rebuilding
        # the index must therefore remove rows from an earlier input rather
        # than quietly mixing two different source artifacts.
        connection.execute("DELETE FROM events")
        connection.execute("DELETE FROM sessions")
        connection.execute("INSERT OR REPLACE INTO metadata VALUES ('schema_version', ?)", (str(SCHEMA_VERSION),))
        by_session: dict[str, list[CanonicalEvent]] = defaultdict(list)
        for event in events:
            by_session[event.session_id].append(event)
            connection.execute(
                "INSERT OR REPLACE INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (event.event_id, event.session_id, event.timestamp, event.sequence_number,
                 event.actor, event.event_type, event.content, json.dumps(event.file_paths), event.source_hash),
            )
        for session_id, rows in by_session.items():
            connection.execute(
                "INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?, ?)",
                (session_id, rows[0].timestamp, rows[-1].timestamp, len(rows),
                 sum(1 for event in rows if event.tool_name or event.event_type == "tool_call")),
            )
        connection.commit()
    finally:
        connection.close()


def ingest(input_path: Path, workspace: Path) -> dict[str, Any]:
    source = JsonExportSource(input_path)
    events, result = normalize(source)
    canonical_path = workspace / "data/canonical/events.jsonl"
    write_jsonl(events, canonical_path)
    build_index(events, workspace / "data/index.sqlite")
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "source": source.discover(),
        "accepted_events": len(events),
        "rejected_events": len(result["errors"]),
        **result,
    }
    manifest_path = workspace / "data/manifests/ingestion_report.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest
