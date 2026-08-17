from __future__ import annotations

from collections import defaultdict
from pathlib import PurePath
from typing import Iterable

from .models import CanonicalEvent, StateItem

DRIFT_SIGNALS = {
    "你忘了": 3, "之前已经决定": 3, "不是原来的要求": 3,
    "跑偏了": 3, "重新检查原始要求": 2, "replan": 2,
    "rollback": 2, "revert": 2, "hard stop": 3, "plan rewrite": 2,
}


def mine_drift_candidates(events: Iterable[CanonicalEvent]) -> list[dict]:
    candidates = []
    for event in events:
        lowered = event.content.lower()
        matches = [signal for signal in DRIFT_SIGNALS if signal.lower() in lowered]
        engineering = event.event_type in {"revert", "rollback", "test_failure"}
        score = sum(DRIFT_SIGNALS[signal] for signal in matches) + (2 if engineering else 0)
        if score:
            candidates.append({
                "candidate_id": f"candidate_{event.event_id}",
                "session_ids": [event.session_id], "event_id": event.event_id,
                "timestamp": event.timestamp, "score": score, "signals": matches,
                "engineering_signal": engineering,
                "classification": "unreviewed",
                "note": "Signals generate candidates only; they are not ground truth.",
            })
    return sorted(candidates, key=lambda row: (-row["score"], row["timestamp"]))


def _normalized_entity(value: str) -> str:
    return str(PurePath(value)).lower()


def detect_invalidations(events: Iterable[CanonicalEvent], states: Iterable[StateItem]) -> list[dict]:
    dependencies: dict[str, list[StateItem]] = defaultdict(list)
    for item in states:
        if item.type == "dependency" and item.status == "active":
            for entity in item.linked_entities:
                dependencies[_normalized_entity(entity)].append(item)

    results = []
    change_types = {"external_change", "file_change", "commit", "config_change"}
    for event in events:
        if event.event_type not in change_types:
            continue
        for path in event.file_paths:
            entity = _normalized_entity(path)
            for dependency in dependencies.get(entity, []):
                if dependency.scope == event.session_id or dependency.valid_from >= event.timestamp:
                    continue
                results.append({
                    "invalidation_id": f"inv_{event.event_id}_{dependency.state_item_id}",
                    "change_event_id": event.event_id,
                    "changed_by_session": event.session_id,
                    "affected_session": dependency.scope,
                    "affected_state_item_id": dependency.state_item_id,
                    "entity": path,
                    "detected_at": event.timestamp,
                    "severity": "verify",
                    "reason": "A changed entity overlaps an active dependency in another session.",
                })
    return results
