from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

STATE_STATUSES = {
    "proposed", "active", "blocked", "satisfied", "superseded",
    "abandoned", "uncertain",
}

STATE_TYPES = {
    "goal", "hard_constraint", "acceptance_criterion",
    "architectural_boundary", "non_goal", "decision",
    "rejected_alternative", "active_plan", "assumption", "dependency",
    "evidence", "open_question", "known_risk", "next_action",
    "world_version", "repository_version",
}


def utc_timestamp(value: str) -> str:
    """Return a strict, UTC ISO-8601 timestamp or raise ValueError."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True, slots=True)
class CanonicalEvent:
    event_id: str
    session_id: str
    timestamp: str
    sequence_number: int
    actor: str
    event_type: str
    content: str
    tool_name: str | None = None
    tool_input: Any = None
    tool_output: Any = None
    cwd: str | None = None
    file_paths: tuple[str, ...] = ()
    parent_event_id: str | None = None
    source_artifact: str = ""
    source_offset: int = 0
    source_hash: str = ""

    def __post_init__(self) -> None:
        if not self.event_id or not self.session_id:
            raise ValueError("event_id and session_id are required")
        if self.sequence_number < 0:
            raise ValueError("sequence_number must be non-negative")
        object.__setattr__(self, "timestamp", utc_timestamp(self.timestamp))

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["file_paths"] = list(self.file_paths)
        return value


@dataclass(slots=True)
class StateItem:
    state_item_id: str
    type: str
    content: str
    status: str
    scope: str
    owner: str
    valid_from: str
    valid_to: str | None = None
    supersedes: str | None = None
    linked_entities: list[str] = field(default_factory=list)
    evidence_ids: list[str] = field(default_factory=list)
    confidence: float = 1.0
    repository_version: str | None = None

    def __post_init__(self) -> None:
        if self.type not in STATE_TYPES:
            raise ValueError(f"unsupported state type: {self.type}")
        if self.status not in STATE_STATUSES:
            raise ValueError(f"unsupported state status: {self.status}")
        if not 0 <= self.confidence <= 1:
            raise ValueError("confidence must be between 0 and 1")
        self.valid_from = utc_timestamp(self.valid_from)
        if self.valid_to:
            self.valid_to = utc_timestamp(self.valid_to)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
