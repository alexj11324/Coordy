from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from .redaction import redact_text, redact_value
from .screening import GOAL_CONTEXT, SCANNER_VERSION, _matched_signals

ALLOWED_ANSWERS = {"YES", "NO", "UNCERTAIN"}
ALLOWED_FAILURE_TYPES = {"A", "B", "C"}
MAX_EXCERPT_CHARS = 280


def _hash(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode()
    return hashlib.sha256(value).hexdigest()


def _secure_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(content)
    os.chmod(path, 0o600)


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict):
            raise ValueError(f"{path} line {line_number} is not an object")
        rows.append(row)
    return rows


def _strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield GOAL_CONTEXT.sub("[goal context withheld]", value)[:4096]
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            if re.search(r"(?i)(token|secret|password|api.?key|encrypted)", str(key)):
                continue
            yield from _strings(item)


def _excerpt(payload: dict[str, Any]) -> str:
    preferred = [
        payload[key]
        for key in ("content", "text", "message")
        if key in payload
    ]
    text = " ".join(part for value in preferred for part in _strings(value) if part)[:4096]
    if not text:
        text = str(payload.get("type") or "")
    text = GOAL_CONTEXT.sub("[goal context withheld]", text)
    text = re.sub(r"/Users/[^/\s]+/", "$HOME/", text)
    text = re.sub(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[EMAIL]", text, flags=re.I)
    text, _ = redact_text(text)
    return re.sub(r"\s+", " ", text).strip()[:MAX_EXCERPT_CHARS]


def _is_compaction(row: dict[str, Any]) -> bool:
    record_type = str(row.get("type") or row.get("record_type") or "")
    payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    payload_type = str(payload.get("type") or "")
    return record_type in {"compacted", "context_compacted"} or payload_type == "context_compacted"


def _is_primary_compaction(row: dict[str, Any]) -> bool:
    return str(row.get("type") or row.get("record_type") or "") == "compacted"


def _timestamps_are_close(left: Any, right: Any, seconds: int = 5) -> bool:
    if not isinstance(left, str) or not isinstance(right, str):
        return False
    try:
        first = datetime.fromisoformat(left.replace("Z", "+00:00"))
        second = datetime.fromisoformat(right.replace("Z", "+00:00"))
    except ValueError:
        return False
    return abs((first - second).total_seconds()) <= seconds


def _is_state_evidence(row: dict[str, Any]) -> bool:
    record_type = str(row.get("type") or row.get("record_type") or "")
    payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    payload_type = str(payload.get("type") or "")
    return (record_type == "response_item" and payload_type == "message" and payload.get("role") in {"user", "assistant"}) or (
        record_type == "event_msg" and payload_type in {"user_message", "agent_message"}
    )


def _is_outcome_evidence(row: dict[str, Any]) -> bool:
    record_type = str(row.get("type") or row.get("record_type") or "")
    payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    payload_type = str(payload.get("type") or "")
    message = record_type == "response_item" and payload_type == "message" and payload.get("role") in {"user", "assistant"}
    tool = record_type == "response_item" and payload_type in {
        "function_call", "custom_tool_call", "function_call_output", "custom_tool_call_output"
    }
    return message or tool or (record_type == "event_msg" and payload_type in {"user_message", "agent_message", "tool_error"})


def _event_descriptor(row: dict[str, Any], line_number: int) -> dict[str, Any]:
    payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    clean_payload, _ = redact_value(payload)
    record_type = str(row.get("type") or row.get("record_type") or "unknown")
    payload_type = str(payload.get("type") or "unknown")
    basis = str(payload.get("id") or row.get("id") or f"{line_number}:{row.get('timestamp')}")
    signals = _matched_signals(record_type, payload)
    if record_type == "compacted" or payload_type == "context_compacted":
        excerpt = "[compaction boundary; summary content withheld]"
    elif payload_type in {"function_call", "custom_tool_call"}:
        excerpt = f"[tool call: {payload.get('name') or payload.get('tool_name') or 'unknown'}; arguments withheld]"
    elif payload_type in {"function_call_output", "custom_tool_call_output"}:
        excerpt = "[tool output content withheld]"
    elif record_type == "event_msg" and payload_type == "tool_error":
        excerpt = "[tool error content withheld]"
    else:
        excerpt = _excerpt(clean_payload)
    return {
        "evidence_id": _hash(basis),
        "timestamp": row.get("timestamp"),
        "record_type": record_type,
        "payload_type": payload_type,
        "actor": payload.get("role"),
        "deterministic_signals": signals,
        "redacted_excerpt": excerpt,
    }


def _read_frozen_prefix(session: dict[str, Any]) -> list[dict[str, Any]]:
    path = Path(str(session["source_path"]))
    byte_count = int(session["scanned_bytes"])
    before = path.stat()
    with path.open("rb") as handle:
        content = handle.read(byte_count)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise RuntimeError("source changed while evidence was read")
    if len(content) != byte_count or _hash(content) != session["scanned_prefix_sha256"]:
        raise RuntimeError("source prefix no longer matches the frozen S0 scan")
    rows = []
    for line_number, raw_line in enumerate(content.splitlines(), 1):
        try:
            row = json.loads(raw_line)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise RuntimeError(f"frozen source line {line_number} is not valid JSON") from exc
        if not isinstance(row, dict):
            raise RuntimeError(f"frozen source line {line_number} is not an object")
        row["_line_number"] = line_number
        rows.append(row)
    return rows


def _candidate_index(rows: list[dict[str, Any]], candidate: dict[str, Any]) -> int | None:
    for index, row in enumerate(rows):
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        basis = str(payload.get("id") or row.get("id") or f"{row['_line_number']}:{row.get('timestamp')}")
        if _hash(basis) == candidate["event_id_hash"]:
            return index
    return None


def _build_card(candidate: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    try:
        rows = _read_frozen_prefix(session)
        target_index = _candidate_index(rows, candidate)
    except (OSError, RuntimeError, KeyError, ValueError) as exc:
        return {
            "candidate_id": candidate["candidate_id"],
            "session_id_hash": _hash(str(candidate["session_id"])),
            "repository_identity_hash": candidate.get("repository_identity_hash"),
            "classification": "uncertain",
            "suggested_failure_type": None,
            "source_status": "unavailable",
            "source_error": type(exc).__name__,
            "evidence_completeness": {
                "has_pre_cutoff_state": False,
                "has_compaction": False,
                "has_post_cutoff_action": False,
                "has_post_cutoff_consequence": False,
                "structural_replay_candidate": False,
            },
            "contemporaneous_evidence": [],
            "retrospective_outcome_evidence": [],
        }
    if target_index is None:
        return {
            "candidate_id": candidate["candidate_id"],
            "session_id_hash": _hash(str(candidate["session_id"])),
            "repository_identity_hash": candidate.get("repository_identity_hash"),
            "classification": "uncertain",
            "suggested_failure_type": None,
            "source_status": "candidate_not_found",
            "evidence_completeness": {
                "has_pre_cutoff_state": False,
                "has_compaction": False,
                "has_post_cutoff_action": False,
                "has_post_cutoff_consequence": False,
                "structural_replay_candidate": False,
            },
            "contemporaneous_evidence": [],
            "retrospective_outcome_evidence": [],
        }

    compaction_indices = [index for index in range(target_index) if _is_compaction(rows[index])]
    cutoff_index = compaction_indices[-1] if compaction_indices else None
    if cutoff_index is not None and not _is_primary_compaction(rows[cutoff_index]):
        paired_primary = [
            index for index in compaction_indices
            if _is_primary_compaction(rows[index]) and 0 <= cutoff_index - index <= 5
            and _timestamps_are_close(rows[index].get("timestamp"), rows[cutoff_index].get("timestamp"))
        ]
        if paired_primary:
            cutoff_index = paired_primary[-1]
    cutoff_timestamp = rows[cutoff_index].get("timestamp") if cutoff_index is not None else None
    pre_rows = rows[:cutoff_index] if cutoff_index is not None else []
    pre_messages = [row for row in pre_rows if _is_state_evidence(row) and _excerpt(row.get("payload") or {})][-3:]
    local_start = max((cutoff_index + 1 if cutoff_index is not None else 0), target_index - 12)
    local_end = min(len(rows), target_index + 13)
    indexed_outcomes = [
        (index, rows[index])
        for index in range(local_start, local_end)
        if _is_outcome_evidence(rows[index]) or index == target_index
    ]
    before_target = [(index, row) for index, row in indexed_outcomes if index < target_index][-3:]
    target_rows = [(index, row) for index, row in indexed_outcomes if index == target_index]
    after_target = [(index, row) for index, row in indexed_outcomes if index > target_index][:3]
    outcome_rows = [row for _, row in before_target + target_rows + after_target]
    post_signals: set[str] = set()
    has_action = False
    for row in outcome_rows:
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        record_type = str(row.get("type") or row.get("record_type") or "")
        payload_type = str(payload.get("type") or "")
        post_signals.update(_matched_signals(record_type, payload))
        has_action = has_action or (
            record_type == "response_item"
            and payload_type in {"message", "function_call", "custom_tool_call"}
            and payload.get("role") != "user"
        )
    has_pre_state = bool(pre_messages)
    has_compaction = cutoff_index is not None
    has_consequence = bool({"rollback_or_revert", "test_failure"} & post_signals) or bool(candidate.get("engineering_consequence_signal"))
    structural_replay_candidate = has_pre_state and has_compaction and has_action and has_consequence
    candidate_signals = set(candidate.get("signals") or [])
    has_interpretable_outcome = any(
        descriptor["redacted_excerpt"] and not descriptor["redacted_excerpt"].startswith("[")
        for descriptor in (
            _event_descriptor(row, int(row["_line_number"])) for row in outcome_rows
        )
    )
    cutoff_basis = None
    if cutoff_index is not None:
        cutoff_payload = rows[cutoff_index].get("payload") if isinstance(rows[cutoff_index].get("payload"), dict) else {}
        cutoff_basis = str(
            cutoff_payload.get("id")
            or rows[cutoff_index].get("id")
            or f"{rows[cutoff_index]['_line_number']}:{rows[cutoff_index].get('timestamp')}"
        )
    return {
        "candidate_id": candidate["candidate_id"],
        "session_id_hash": _hash(str(candidate["session_id"])),
        "repository_identity_hash": candidate.get("repository_identity_hash"),
        "classification": "uncertain",
        "suggested_failure_type": None,
        "classification_note": "S0 does not assign Type A/B/C until external-change exclusions and a causal state-loss chain are reconstructed.",
        "source_status": "frozen_prefix_verified",
        "source_prefix_sha256": session["scanned_prefix_sha256"],
        "candidate_signals": sorted(candidate_signals),
        "cutoff": {
            "timestamp": cutoff_timestamp,
            "maximum_allowed_event_id": _hash(cutoff_basis) if cutoff_basis is not None else None,
            "rule": "Contemporaneous replay input ends at the latest compaction before the candidate action.",
        },
        "evidence_completeness": {
            "has_pre_cutoff_state": has_pre_state,
            "has_compaction": has_compaction,
            "has_post_cutoff_action": has_action,
            "has_post_cutoff_consequence": has_consequence,
            "has_interpretable_outcome": has_interpretable_outcome,
            "structural_replay_candidate": structural_replay_candidate,
        },
        "contemporaneous_evidence": [
            _event_descriptor(row, int(row["_line_number"])) for row in pre_messages
        ] + ([
            _event_descriptor(rows[cutoff_index], int(rows[cutoff_index]["_line_number"]))
        ] if cutoff_index is not None else []),
        "retrospective_outcome_evidence": [
            _event_descriptor(row, int(row["_line_number"])) for row in outcome_rows
        ],
    }


def _structural_incident_key(card: dict[str, Any]) -> tuple[str, str] | None:
    cutoff = card.get("cutoff") if isinstance(card.get("cutoff"), dict) else {}
    timestamp = cutoff.get("timestamp")
    if not card.get("session_id_hash") or not isinstance(timestamp, str):
        return None
    if not card["evidence_completeness"].get("structural_replay_candidate"):
        return None
    return str(card["session_id_hash"]), timestamp


def _unique_structural_count(cards: Iterable[dict[str, Any]]) -> int:
    return len({key for card in cards if (key := _structural_incident_key(card)) is not None})


def _select_review_cards(cards: list[dict[str, Any]], candidates: dict[str, dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    ranked = sorted(
        cards,
        key=lambda card: (
            -int(card["evidence_completeness"]["structural_replay_candidate"]),
            -int(card["evidence_completeness"]["has_post_cutoff_consequence"]),
            -int(candidates[card["candidate_id"]].get("score", 0)),
            card["candidate_id"],
        ),
    )
    groups: dict[str, list[dict[str, Any]]] = {}
    group_order: list[str] = []
    for card in ranked:
        group = str(card.get("goal_thread_id_hash") or "not_goal_backed")
        if group not in groups:
            groups[group] = []
            group_order.append(group)
        groups[group].append(card)
    balanced: list[dict[str, Any]] = []
    while any(groups[group] for group in group_order):
        for group in group_order:
            if groups[group]:
                balanced.append(groups[group].pop(0))
    selected = []
    per_session: dict[str, int] = {}
    seen_incidents: set[tuple[Any, ...]] = set()
    for card in balanced:
        candidate = candidates[card["candidate_id"]]
        incident = (
            candidate.get("session_id"),
            card.get("cutoff", {}).get("timestamp") or candidate.get("timestamp"),
        )
        session_hash = card["session_id_hash"]
        if incident in seen_incidents or per_session.get(session_hash, 0) >= 2:
            continue
        if card["source_status"] != "frozen_prefix_verified":
            continue
        if not card["evidence_completeness"]["structural_replay_candidate"]:
            continue
        if not card["evidence_completeness"].get("has_interpretable_outcome"):
            continue
        selected.append(card)
        seen_incidents.add(incident)
        per_session[session_hash] = per_session.get(session_hash, 0) + 1
        if len(selected) >= limit:
            break
    return selected


def _render_review_markdown(cards: list[dict[str, Any]]) -> str:
    lines = [
        "# Coordy S0 evidence review",
        "",
        "For each case, answer exactly `YES`, `NO`, or `UNCERTAIN`. `YES` means the shown chain supports a consequential Type A, B, or C state failure.",
        "",
    ]
    if not cards:
        lines.extend([
            "No user review is required: an earlier deterministic S0 gate already reached a decision.",
            "",
        ])
    for card in cards:
        lines.extend([
            f"## {card['candidate_id']}",
            "",
            f"System assessment: `{card.get('suggested_failure_type') or 'UNCLASSIFIED_CAUSAL_FAILURE'}`",
            f"Assessment note: {card['classification_note']}",
            f"Structural replay candidate: `{str(card['evidence_completeness']['structural_replay_candidate']).lower()}`",
            "",
            "Contemporaneous evidence (cutoff-safe):",
            "",
        ])
        for event in card["contemporaneous_evidence"]:
            signal_note = f" [signals: {', '.join(event['deterministic_signals'])}]" if event.get("deterministic_signals") else ""
            lines.append(f"- {event.get('timestamp')}: {event.get('redacted_excerpt') or '[no text]'}{signal_note}")
        lines.extend(["", "Retrospective outcome evidence (never replay input):", ""])
        for event in card["retrospective_outcome_evidence"]:
            signal_note = f" [signals: {', '.join(event['deterministic_signals'])}]" if event.get("deterministic_signals") else ""
            lines.append(f"- {event.get('timestamp')}: {event.get('redacted_excerpt') or '[no text]'}{signal_note}")
        lines.extend(["", "Answer: `[YES / NO / UNCERTAIN]`", ""])
    return "\n".join(lines) + "\n"


def prepare_s0_review(workspace: Path, *, max_reviews: int = 12) -> dict[str, Any]:
    if not 1 <= max_reviews <= 12:
        raise ValueError("max_reviews must be between 1 and 12")
    output = workspace / "data/screening"
    summary_path = output / "screening_summary.json"
    if not summary_path.is_file():
        raise RuntimeError("missing screening summary; rerun screen")
    screening_summary = json.loads(summary_path.read_text(encoding="utf-8"))
    candidate_path = output / "candidate_decision_points.jsonl"
    session_path = output / "eligible_sessions.jsonl"
    candidates = _read_jsonl(candidate_path)
    session_rows = _read_jsonl(session_path)
    scan_run_id = screening_summary.get("scan_run_id")
    artifact_hashes = screening_summary.get("artifact_hashes")
    overflow_value = screening_summary.get("candidate_episode_overflow")
    if (
        screening_summary.get("scanner_version") != SCANNER_VERSION
        or not isinstance(scan_run_id, str)
        or not scan_run_id
        or not isinstance(artifact_hashes, dict)
        or artifact_hashes.get("candidate_decision_points_jsonl") != _hash(candidate_path.read_bytes())
        or artifact_hashes.get("eligible_sessions_jsonl") != _hash(session_path.read_bytes())
        or screening_summary.get("candidate_decision_points") != len(candidates)
        or screening_summary.get("eligible_sessions") != len(session_rows)
        or not isinstance(overflow_value, int)
        or isinstance(overflow_value, bool)
        or overflow_value < 0
        or any(row.get("scan_run_id") != scan_run_id for row in candidates + session_rows)
    ):
        raise RuntimeError("screening artifacts do not belong to one complete compatible scan run")
    sessions = {
        (row["session_id"], row["scanned_prefix_sha256"]): row
        for row in session_rows
    }
    cards = []
    for candidate in candidates:
        session = sessions.get((candidate.get("session_id"), candidate.get("source_prefix_sha256")))
        if session is None:
            card = {
                "candidate_id": candidate["candidate_id"],
                "session_id_hash": _hash(str(candidate.get("session_id"))),
                "repository_identity_hash": candidate.get("repository_identity_hash"),
                "classification": "uncertain",
                "suggested_failure_type": None,
                "source_status": "missing_session_manifest",
                "evidence_completeness": {
                    "has_pre_cutoff_state": False,
                    "has_compaction": False,
                    "has_post_cutoff_action": False,
                    "has_post_cutoff_consequence": False,
                    "structural_replay_candidate": False,
                },
                "contemporaneous_evidence": [],
                "retrospective_outcome_evidence": [],
            }
        else:
            card = _build_card(candidate, session)
        card["goal_thread_id_hash"] = candidate.get("goal_thread_id_hash")
        card["goal_lineage_depth"] = candidate.get("goal_lineage_depth")
        cards.append(card)
    by_id = {row["candidate_id"]: row for row in candidates}
    structural_upper_bound = _unique_structural_count(cards)
    episode_overflow = overflow_value
    structural_stop = episode_overflow == 0 and structural_upper_bound < 10
    selected = [] if structural_stop else _select_review_cards(cards, by_id, max_reviews)
    reviewable_population_size = sum(
        1 for card in cards
        if card["source_status"] == "frozen_prefix_verified"
        and card["evidence_completeness"]["structural_replay_candidate"]
        and card["evidence_completeness"].get("has_interpretable_outcome")
    )
    queue = [
        {
            "candidate_id": card["candidate_id"],
            "question": "Does the evidence chain show consequential Type A, B, or C state failure?",
            "allowed_answers": ["YES", "NO", "UNCERTAIN"],
            "suggested_failure_type": card.get("suggested_failure_type"),
        }
        for card in selected
    ]
    evidence_content = "".join(json.dumps(row, sort_keys=True) + "\n" for row in cards)
    queue_content = json.dumps(queue, indent=2, sort_keys=True) + "\n"
    _secure_write(output / "evidence_cards.jsonl", evidence_content)
    _secure_write(output / "user_review_queue.json", queue_content)
    answer_template = {
        "answers": [
            {
                "candidate_id": card["candidate_id"],
                "answer": None,
            }
            for card in selected
        ]
    }
    _secure_write(output / "user_review_answers.json", json.dumps(answer_template, indent=2, sort_keys=True) + "\n")
    _secure_write(output / "user_review.md", _render_review_markdown(selected))
    review_manifest = {
        "scan_run_id": scan_run_id,
        "scanner_version": SCANNER_VERSION,
        "candidate_episode_overflow": episode_overflow,
        "reviewable_population_size": reviewable_population_size,
        "evidence_cards_sha256": _hash(evidence_content),
        "user_review_queue_sha256": _hash(queue_content),
    }
    _secure_write(output / "s0_review_manifest.json", json.dumps(review_manifest, indent=2, sort_keys=True) + "\n")
    result = {
        "evidence_cards": len(cards),
        "review_cards": len(selected),
        "structural_replay_candidates": sum(
            1 for card in cards if card["evidence_completeness"]["structural_replay_candidate"]
        ),
        "unique_structural_replay_upper_bound": structural_upper_bound,
        "candidate_episode_overflow": episode_overflow,
        "unavailable_sources": sum(1 for card in cards if card["source_status"] != "frozen_prefix_verified"),
        "status": "DECIDED" if structural_stop else "PENDING_USER_REVIEW",
        "decision": "STOP" if structural_stop else None,
    }
    if structural_stop:
        adjudication = {
            "status": "DECIDED",
            "decision": "STOP",
            "stage_outcome": "STOP",
            "confirmed_type_abc": 0,
            "confirmed_engineering_consequences": 0,
            "review_queue_size": 0,
            "answers_received": 0,
            "uncertain_answers": 0,
            "unique_structural_replay_upper_bound": structural_upper_bound,
            "decision_reasons": [
                "fewer than 10 unique structurally replayable compaction episodes; this is an upper bound, not confirmed Decision Points"
            ],
        }
        _secure_write(output / "s0_adjudication.json", json.dumps(adjudication, indent=2, sort_keys=True) + "\n")
    if summary_path.is_file():
        summary = screening_summary
        summary.update({
            "status": result["status"],
            "decision": result["decision"],
            "user_review_queue_size": result["review_cards"],
            "evidence_cards": result["evidence_cards"],
            "structural_replay_candidates": result["structural_replay_candidates"],
            "unique_structural_replay_upper_bound": result["unique_structural_replay_upper_bound"],
            "s0_stop_rules_evaluated": structural_stop,
            "decision_reason": (
                "The conservative structural upper bound contains fewer than 10 unique comparable episodes."
                if structural_stop else "User review is required before the remaining S0 gates can be evaluated."
            ),
        })
        _secure_write(summary_path, json.dumps(summary, indent=2, sort_keys=True) + "\n")
    return result


def adjudicate_s0(workspace: Path, answers_path: Path) -> dict[str, Any]:
    output = workspace / "data/screening"
    evidence_path = output / "evidence_cards.jsonl"
    queue_path = output / "user_review_queue.json"
    summary_path = output / "screening_summary.json"
    manifest_path = output / "s0_review_manifest.json"
    if not summary_path.is_file() or not manifest_path.is_file():
        raise RuntimeError("missing bound S0 review artifacts; rerun review-s0")
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    overflow_value = manifest.get("candidate_episode_overflow")
    reviewable_population_size = manifest.get("reviewable_population_size")
    if (
        manifest.get("scanner_version") != SCANNER_VERSION
        or manifest.get("scan_run_id") != summary.get("scan_run_id")
        or manifest.get("evidence_cards_sha256") != _hash(evidence_path.read_bytes())
        or manifest.get("user_review_queue_sha256") != _hash(queue_path.read_bytes())
        or not isinstance(overflow_value, int)
        or isinstance(overflow_value, bool)
        or overflow_value < 0
        or not isinstance(reviewable_population_size, int)
        or isinstance(reviewable_population_size, bool)
        or reviewable_population_size < 0
        or summary.get("candidate_episode_overflow") != overflow_value
    ):
        raise RuntimeError("S0 review artifacts do not belong to the current screening run")
    cards = {row["candidate_id"]: row for row in _read_jsonl(evidence_path)}
    queue_value = json.loads(queue_path.read_text(encoding="utf-8"))
    if not isinstance(queue_value, list) or len(queue_value) > 12:
        raise ValueError("review queue must contain at most 12 cases")
    queue_ids = [str(row["candidate_id"]) for row in queue_value]
    if len(queue_ids) != len(set(queue_ids)):
        raise ValueError("review queue contains duplicate cases")
    missing_cards = [candidate_id for candidate_id in queue_ids if candidate_id not in cards]
    if missing_cards:
        raise ValueError(f"review queue references missing evidence cards: {missing_cards}")
    answer_value = json.loads(answers_path.read_text(encoding="utf-8"))
    answers = answer_value.get("answers") if isinstance(answer_value, dict) else None
    if not isinstance(answers, list):
        raise ValueError("answers file must contain an answers list")
    normalized: dict[str, dict[str, Any]] = {}
    for row in answers:
        if not isinstance(row, dict):
            raise ValueError("each answer must be an object")
        candidate_id = str(row.get("candidate_id") or "")
        answer = str(row.get("answer") or "").upper()
        if candidate_id not in queue_ids:
            raise ValueError(f"answer references a case outside the review queue: {candidate_id}")
        if candidate_id in normalized:
            raise ValueError(f"duplicate answer: {candidate_id}")
        if answer not in ALLOWED_ANSWERS:
            raise ValueError(f"invalid answer for {candidate_id}: {answer}")
        failure_type = cards[candidate_id].get("suggested_failure_type") if answer == "YES" else None
        normalized[candidate_id] = {
            "candidate_id": candidate_id,
            "answer": answer,
            "failure_type": failure_type if failure_type in ALLOWED_FAILURE_TYPES else None,
        }
    missing = [candidate_id for candidate_id in queue_ids if candidate_id not in normalized]
    base = {
        "review_queue_size": len(queue_ids),
        "answers_received": len(normalized),
        "confirmed_type_abc": sum(1 for row in normalized.values() if row["answer"] == "YES"),
        "uncertain_answers": sum(1 for row in normalized.values() if row["answer"] == "UNCERTAIN"),
        "unique_structural_replay_upper_bound": _unique_structural_count(cards.values()),
        "candidate_episode_overflow": overflow_value,
        "reviewable_population_size": reviewable_population_size,
    }
    if missing:
        result = {
            **base,
            "status": "PENDING_USER_REVIEW",
            "decision": None,
            "stage_outcome": None,
            "missing_candidate_ids": missing,
            "decision_reasons": ["The frozen review queue is not fully answered."],
        }
    else:
        confirmed_ids = [row["candidate_id"] for row in normalized.values() if row["answer"] == "YES"]
        confirmed_consequences = sum(
            1 for candidate_id in confirmed_ids
            if cards[candidate_id]["evidence_completeness"].get("has_post_cutoff_consequence")
        )
        reasons = []
        if base["confirmed_type_abc"] < 5:
            reasons.append("confirmed Type A/B/C below 5")
        if confirmed_consequences == 0:
            reasons.append("no confirmed observable engineering consequence")
        if overflow_value == 0 and base["unique_structural_replay_upper_bound"] < 10:
            reasons.append("fewer than 10 unique structurally replayable compaction episodes")
        if reasons:
            result = {
                **base,
                "status": "DECIDED",
                "decision": "STOP",
                "stage_outcome": "STOP",
                "confirmed_engineering_consequences": confirmed_consequences,
                "decision_reasons": reasons,
            }
        else:
            confirmed_repositories = {
                cards[candidate_id].get("repository_identity_hash") for candidate_id in confirmed_ids
            } - {None}
            narrow_concentration = (
                overflow_value == 0
                and len(queue_ids) == reviewable_population_size
                and len(confirmed_repositories) == 1
                and base["confirmed_type_abc"] < 10
            )
            if narrow_concentration:
                result = {
                    **base,
                    "status": "DECIDED",
                    "decision": "PIVOT",
                    "stage_outcome": "PIVOT",
                    "confirmed_engineering_consequences": confirmed_consequences,
                    "decision_reasons": [
                        "confirmed failures are rare and concentrated in one repository-identity cohort"
                    ],
                }
            else:
                result = {
                    **base,
                    "status": "PENDING_CASE_CONSTRUCTION",
                    "decision": None,
                    "stage_outcome": "PROCEED_TO_CASE_CONSTRUCTION",
                    "confirmed_engineering_consequences": confirmed_consequences,
                    "decision_reasons": [
                        "S0 prevalence signals passed, but structurally complete cards are only an upper bound; build 10 causal case manifests before S1."
                    ],
                }
    _secure_write(output / "s0_adjudication.json", json.dumps(result, indent=2, sort_keys=True) + "\n")
    if summary_path.is_file():
        summary.update({
            "status": result["status"],
            "decision": result["decision"],
            "confirmed_type_abc": result["confirmed_type_abc"],
            "unique_structural_replay_upper_bound": result["unique_structural_replay_upper_bound"],
            "s0_stop_rules_evaluated": result["status"] == "DECIDED",
        })
        _secure_write(summary_path, json.dumps(summary, indent=2, sort_keys=True) + "\n")
    return result
