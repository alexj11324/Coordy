from __future__ import annotations

import hashlib
import json
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Iterator


class SessionSource(ABC):
    @abstractmethod
    def discover(self) -> dict[str, Any]: ...

    @abstractmethod
    def list_sessions(self) -> list[str]: ...

    @abstractmethod
    def iter_events(self, session_id: str) -> Iterator[tuple[int, dict[str, Any]]]: ...

    @abstractmethod
    def get_raw_artifact(self, session_id: str) -> Path: ...


class JsonExportSource(SessionSource):
    """Read a user-selected JSON/JSONL export without mutating it."""

    def __init__(self, path: str | Path):
        self.path = Path(path).resolve()
        if not self.path.is_file():
            raise FileNotFoundError(self.path)
        self._before = self._fingerprint()
        self._events = self._load()
        self._after = self._fingerprint()
        if self._before != self._after:
            raise RuntimeError("source changed while being read")

    def _fingerprint(self) -> tuple[int, int, str]:
        stat = self.path.stat()
        digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        return stat.st_size, stat.st_mtime_ns, digest

    @property
    def source_hash(self) -> str:
        return self._before[2]

    def _load(self) -> list[dict[str, Any]]:
        text = self.path.read_text(encoding="utf-8")
        if self.path.suffix.lower() == ".jsonl":
            rows = []
            for line_number, line in enumerate(text.splitlines(), 1):
                if line.strip():
                    value = json.loads(line)
                    if not isinstance(value, dict):
                        raise ValueError(f"line {line_number} is not an object")
                    value.setdefault("_source_offset", line_number)
                    rows.append(value)
            return rows
        value = json.loads(text)
        rows = value.get("events") if isinstance(value, dict) else value
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise ValueError("JSON must be an event array or contain an events array")
        for index, row in enumerate(rows, 1):
            row.setdefault("_source_offset", index)
        return rows

    def discover(self) -> dict[str, Any]:
        keys = sorted({key for row in self._events for key in row if not key.startswith("_")})
        signature = hashlib.sha256("\n".join(keys).encode()).hexdigest()
        return {
            "source_type": "json_export",
            "path": str(self.path),
            "sha256": self.source_hash,
            "event_count": len(self._events),
            "schema_keys": keys,
            "schema_signature": signature,
            "read_only_verified": self._before == self._after,
        }

    def list_sessions(self) -> list[str]:
        # Keep the empty sentinel so normalization can reject and report rows
        # with a missing session_id instead of silently dropping them.
        return sorted({str(row.get("session_id", "")) for row in self._events})

    def iter_events(self, session_id: str) -> Iterator[tuple[int, dict[str, Any]]]:
        for row in self._events:
            if str(row.get("session_id", "")) == session_id:
                yield int(row["_source_offset"]), dict(row)

    def get_raw_artifact(self, session_id: str) -> Path:
        if session_id not in self.list_sessions():
            raise KeyError(session_id)
        return self.path
