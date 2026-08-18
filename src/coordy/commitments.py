from __future__ import annotations

from collections.abc import Iterable

from .models import CanonicalEvent, Check, Commitment

SUPERSEDING_AUTHORITIES = {"USER", "SPEC", "REPOSITORY_FACT", "AUTHORIZED_DECISION"}


def events_through_cutoff(
    events: Iterable[CanonicalEvent], *, session_id: str, cutoff_sequence: int
) -> list[CanonicalEvent]:
    """Return the complete session history visible at a strict event-time cutoff."""
    if cutoff_sequence < 0:
        raise ValueError("cutoff_sequence must be non-negative")
    return sorted(
        (
            event for event in events
            if event.session_id == session_id and event.sequence_number <= cutoff_sequence
        ),
        key=lambda event: (event.sequence_number, event.timestamp),
    )


def active_commitments(commitments: Iterable[Commitment], *, topic: str | None = None) -> list[Commitment]:
    return [
        commitment for commitment in commitments
        if commitment.status == "ACTIVE" and (topic is None or commitment.topic == topic)
    ]


def supersede_commitment(
    commitments: Iterable[Commitment], *, old_id: str, replacement: Commitment
) -> list[Commitment]:
    """Apply an explicit authoritative replacement; agent plans cannot rewrite authority."""
    rows = list(commitments)
    old = next((row for row in rows if row.commitment_id == old_id), None)
    if old is None:
        raise ValueError(f"unknown commitment: {old_id}")
    if old.status != "ACTIVE":
        raise ValueError(f"commitment is not active: {old_id}")
    if replacement.authority not in SUPERSEDING_AUTHORITIES:
        raise ValueError("agent-authored state cannot supersede an authoritative commitment")
    if replacement.topic != old.topic or replacement.goal_root_id != old.goal_root_id:
        raise ValueError("replacement must remain in the same Goal root and topic")
    old.status = "SUPERSEDED"
    old.superseded_by = replacement.commitment_id
    rows.append(replacement)
    return rows


def should_continue_topic_tracking(checks: Iterable[Check]) -> bool:
    """LOCAL stability is diagnostic only; it never closes anchored/action tracking."""
    rows = list(checks)
    return not any(
        row.kind in {"ANCHORED", "ACTION"} and row.verdict == "SUPERSEDED"
        for row in rows
    )


def validate_check_at_cutoff(
    check: Check,
    *,
    commitments: Iterable[Commitment],
    visible_events: Iterable[CanonicalEvent],
) -> None:
    """Fail closed if a semantic check cites future or unknown evidence."""
    event_ids = {event.event_id for event in visible_events}
    commitment_by_id = {row.commitment_id: row for row in commitments}
    cited_events = set(check.observed_event_ids + check.action_event_ids)
    if not cited_events <= event_ids:
        raise ValueError("check cites evidence outside the cutoff")
    for commitment_id in check.commitment_ids:
        commitment = commitment_by_id.get(commitment_id)
        if commitment is None:
            raise ValueError(f"check cites unknown commitment: {commitment_id}")
        if not set(commitment.source_event_ids) <= event_ids:
            raise ValueError("commitment source is outside the cutoff")


def classify_topic_checks(checks: Iterable[Check]) -> str:
    """Classify evidence without promoting a local text change into drift."""
    rows = list(checks)
    action = [row for row in rows if row.kind == "ACTION"]
    if any(row.verdict == "CONTRADICTED" for row in action):
        return "DRIFT_CANDIDATE"
    if any(row.verdict == "UNCERTAIN" for row in action):
        return "UNCERTAIN"
    if any(row.verdict == "SUPERSEDED" for row in rows):
        return "VALID_UPDATE"
    if action and all(row.verdict == "CONSISTENT" for row in action):
        return "CONSISTENT"
    return "INSUFFICIENT_ACTION_EVIDENCE"
