from __future__ import annotations

import hashlib
import re
from dataclasses import asdict
from typing import Iterable

from .models import CanonicalEvent, StateItem

PREFIX_TYPES = {
    "GOAL": "goal", "CONSTRAINT": "hard_constraint",
    "ACCEPTANCE": "acceptance_criterion", "BOUNDARY": "architectural_boundary",
    "NON_GOAL": "non_goal", "DECISION": "decision",
    "REJECTED": "rejected_alternative", "PLAN": "active_plan",
    "ASSUMPTION": "assumption", "DEPENDS": "dependency",
    "QUESTION": "open_question", "RISK": "known_risk",
    "NEXT": "next_action", "WORLD_VERSION": "world_version",
    "REPO_VERSION": "repository_version",
}


def _id(session_id: str, event_id: str, state_type: str, content: str) -> str:
    value = "|".join((session_id, event_id, state_type, content)).encode()
    return "state_" + hashlib.sha256(value).hexdigest()[:20]


def extract_state_items(event: CanonicalEvent) -> list[StateItem]:
    items: list[StateItem] = []
    for line in event.content.splitlines():
        match = re.match(r"^([A-Z_]+):\s*(.+)$", line.strip())
        if not match or match.group(1) not in PREFIX_TYPES:
            continue
        state_type, content = PREFIX_TYPES[match.group(1)], match.group(2).strip()
        linked = list(event.file_paths)
        if state_type == "dependency":
            linked.extend(part.strip() for part in content.split(",") if part.strip())
        items.append(StateItem(
            state_item_id=_id(event.session_id, event.event_id, state_type, content),
            type=state_type, content=content, status="active", scope=event.session_id,
            owner=event.actor, valid_from=event.timestamp, linked_entities=sorted(set(linked)),
            evidence_ids=[event.event_id], confidence=1.0,
        ))
    return items


def update_state(events: Iterable[CanonicalEvent]) -> list[StateItem]:
    """Incrementally update state. Same-type replacement preserves history."""
    all_items: list[StateItem] = []
    active: dict[tuple[str, str], StateItem] = {}
    singleton = {"goal", "active_plan", "world_version", "repository_version", "next_action"}
    for event in sorted(events, key=lambda item: (item.timestamp, item.sequence_number)):
        for item in extract_state_items(event):
            key = (item.scope, item.type)
            previous = active.get(key)
            if previous and item.type in singleton and previous.content != item.content:
                previous.status = "superseded"
                previous.valid_to = event.timestamp
                item.supersedes = previous.state_item_id
            active[key] = item
            all_items.append(item)
    return all_items


def serializable(items: Iterable[StateItem]) -> list[dict]:
    return [asdict(item) for item in items]
