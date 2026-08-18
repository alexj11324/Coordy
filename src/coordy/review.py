from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from .redaction import redact_text, redact_value
from .screening import (
    CROSS_SESSION_OPPORTUNITY_SCHEMA_VERSION,
    GOAL_CONTEXT,
    INTERNAL_MESSAGE_ENVELOPE,
    SCANNER_VERSION,
    _is_engineering_consequence_event,
    _matched_signals,
)

ALLOWED_ANSWERS = {"YES", "NO", "UNCERTAIN"}
ALLOWED_REVIEWER_TYPES = {"HUMAN_CONFIRMED", "MACHINE_PRELABEL"}
PIVOT_MAX_CONFIRMED_FAILURES = 4
MAX_EXCERPT_CHARS = 280


def _pending_system_classification(reason: str) -> dict[str, Any]:
    return {
        "status": "PENDING_CAUSAL_CLASSIFICATION",
        "failure_type": None,
        "reason": reason,
    }


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
        clean = GOAL_CONTEXT.sub("[goal context withheld]", value)
        yield INTERNAL_MESSAGE_ENVELOPE.sub("[internal context withheld]", clean)[:4096]
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
        excerpt = "[test or build command failed; output withheld]" if "test_failure" in signals else "[tool output content withheld]"
    elif record_type == "event_msg" and payload_type == "tool_error":
        excerpt = "[tool execution error; details withheld]"
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
            "session_id_hash": str(candidate["session_id_hash"]),
            "repository_identity_hash": candidate.get("repository_identity_hash"),
            "classification": "uncertain",
            "suggested_failure_type": None,
            "system_classification": _pending_system_classification("The frozen source could not be reconstructed."),
            "source_status": "unavailable",
            "source_error": type(exc).__name__,
            "evidence_completeness": {
                "has_pre_cutoff_state": False,
                "has_compaction": False,
                "has_post_cutoff_action": False,
                "has_post_cutoff_consequence": False,
                "structural_opportunity": False,
            },
            "contemporaneous_evidence": [],
            "retrospective_outcome_evidence": [],
        }
    if target_index is None:
        return {
            "candidate_id": candidate["candidate_id"],
            "session_id_hash": str(candidate["session_id_hash"]),
            "repository_identity_hash": candidate.get("repository_identity_hash"),
            "classification": "uncertain",
            "suggested_failure_type": None,
            "system_classification": _pending_system_classification("The compaction cutoff could not be reconstructed."),
            "source_status": "candidate_not_found",
            "evidence_completeness": {
                "has_pre_cutoff_state": False,
                "has_compaction": False,
                "has_post_cutoff_action": False,
                "has_post_cutoff_consequence": False,
                "structural_opportunity": False,
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
    has_consequence = bool(candidate.get("has_observable_outcome"))
    for row in outcome_rows:
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        record_type = str(row.get("type") or row.get("record_type") or "")
        payload_type = str(payload.get("type") or "")
        matched = _matched_signals(record_type, payload)
        post_signals.update(matched)
        has_consequence = has_consequence or _is_engineering_consequence_event(record_type, payload, matched)
        has_action = has_action or (
            record_type == "response_item"
            and (
                (payload_type == "message" and payload.get("role") == "assistant")
                or payload_type in {"function_call", "custom_tool_call"}
            )
        ) or (record_type == "event_msg" and payload_type == "agent_message")
    has_pre_state = bool(pre_messages)
    has_compaction = cutoff_index is not None
    structural_opportunity = has_pre_state and has_compaction and has_action
    candidate_signals = set(candidate.get("rule_signals") or [])
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
    post_start = cutoff_index + 1 if cutoff_index is not None else 0
    if cutoff_index is not None:
        paired_markers = [
            index for index in range(cutoff_index + 1, min(len(rows), cutoff_index + 6))
            if _is_compaction(rows[index])
            and _timestamps_are_close(rows[cutoff_index].get("timestamp"), rows[index].get("timestamp"))
        ]
        if paired_markers:
            post_start = paired_markers[-1] + 1
    post_boundary = rows[post_start:]
    next_compaction = next((index for index, row in enumerate(post_boundary) if _is_compaction(row)), len(post_boundary))
    causal_rows = post_boundary[:next_compaction]
    t2 = next((row for row in causal_rows if (
        (str(row.get("type") or row.get("record_type") or "") == "response_item"
         and str((row.get("payload") or {}).get("type") or "") == "message"
         and (row.get("payload") or {}).get("role") == "assistant")
        or (str(row.get("type") or row.get("record_type") or "") == "event_msg"
            and str((row.get("payload") or {}).get("type") or "") == "agent_message")
    )), None)
    t3 = next((row for row in causal_rows if str((row.get("payload") or {}).get("type") or "") in {"function_call", "custom_tool_call"}), None)
    t4 = next((row for row in causal_rows if candidate.get("has_observable_outcome") and _is_engineering_consequence_event(
        str(row.get("type") or row.get("record_type") or ""),
        row.get("payload") if isinstance(row.get("payload"), dict) else {},
        _matched_signals(
            str(row.get("type") or row.get("record_type") or ""),
            row.get("payload") if isinstance(row.get("payload"), dict) else {},
        ),
    )), None)
    t5 = next((row for row in causal_rows if "user_correction" in _matched_signals(
        str(row.get("type") or row.get("record_type") or ""),
        row.get("payload") if isinstance(row.get("payload"), dict) else {},
    )), None)
    def describe(row: dict[str, Any] | None) -> dict[str, Any] | None:
        return _event_descriptor(row, int(row["_line_number"])) if row is not None else None

    chain = {
        "T0_pre_compaction_state": describe(pre_messages[-1] if pre_messages else None),
        "T1_compaction_cutoff": describe(rows[cutoff_index]) if cutoff_index is not None else None,
        "T2_post_compaction_plan_or_judgment": describe(t2),
        "T3_actual_action": describe(t3),
        "T4_observable_engineering_result": describe(t4),
        "T5_user_correction_or_recovery": describe(t5),
    }
    missing_links = [label for label, value in chain.items() if value is None]
    plain_case = {
        "original_constraint": (chain["T0_pre_compaction_state"] or {}).get("redacted_excerpt") or "[not recovered]",
        "subsequent_behavior": (
            (chain["T3_actual_action"] or chain["T2_post_compaction_plan_or_judgment"] or {}).get("redacted_excerpt")
            or "[not recovered]"
        ),
        "actual_consequence": (chain["T4_observable_engineering_result"] or {}).get("redacted_excerpt") or "[not established]",
        "judgment_reason": (
            "This is a compaction opportunity only. Answer YES only if the full T0-T5 chain shows that lost or distorted "
            "cross-compaction state caused a wrong action with an engineering consequence."
        ),
        "missing_causal_links": missing_links,
    }
    return {
        "candidate_id": candidate["candidate_id"],
        "session_id_hash": str(candidate["session_id_hash"]),
        "repository_identity_hash": candidate.get("repository_identity_hash"),
        "classification": "uncertain",
        "suggested_failure_type": None,
        "classification_note": "S0 does not assign Type A/B/C until external-change exclusions and a causal state-loss chain are reconstructed.",
        "system_classification": _pending_system_classification(
            "Relevant external-change exclusion and complete causal attribution have not yet been established."
        ),
        "source_status": "frozen_prefix_verified",
        "source_prefix_sha256": session["scanned_prefix_sha256"],
        "candidate_signals": sorted(candidate_signals),
        "state_change_signal": int(candidate.get("missing_state_category_count", 0)) > 0,
        "episode_id_hash": candidate.get("episode_id_hash"),
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
            "structural_opportunity": structural_opportunity,
            "causal_chain_complete": structural_opportunity and has_consequence,
        },
        "contemporaneous_evidence": [
            _event_descriptor(row, int(row["_line_number"])) for row in pre_messages
        ] + ([
            _event_descriptor(rows[cutoff_index], int(rows[cutoff_index]["_line_number"]))
        ] if cutoff_index is not None else []),
        "retrospective_outcome_evidence": [
            _event_descriptor(row, int(row["_line_number"])) for row in outcome_rows
        ],
        "causal_chain": chain,
        "plain_language_case": plain_case,
    }


def _select_review_cards(cards: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    eligible = [card for card in cards if card["source_status"] == "frozen_prefix_verified"]

    def sample(pool: list[dict[str, Any]], quota: int, seed: str) -> list[dict[str, Any]]:
        groups: dict[str, list[dict[str, Any]]] = {}
        for card in pool:
            group = str(card.get("goal_thread_id_hash") or card["session_id_hash"])
            groups.setdefault(group, []).append(card)
        for group, values in groups.items():
            values.sort(key=lambda card: _hash(f"{seed}:{group}:{card.get('episode_id_hash')}"))
        order = sorted(groups, key=lambda group: _hash(f"{seed}:root:{group}"))
        chosen: list[dict[str, Any]] = []
        while len(chosen) < quota and any(groups[group] for group in order):
            for group in order:
                if groups[group] and len(chosen) < quota:
                    chosen.append(groups[group].pop(0))
        return chosen

    pools = [
        ("high_signal", [card for card in eligible if card.get("candidate_signals") and card["evidence_completeness"].get("has_post_cutoff_consequence")], 6),
        ("recall_probe", [card for card in eligible if not card.get("candidate_signals") and card["evidence_completeness"].get("structural_opportunity")], 3),
        ("healthy_hard_negative", [
            card for card in eligible
            if card["evidence_completeness"].get("structural_opportunity")
            and not card["evidence_completeness"].get("has_post_cutoff_consequence")
            and (card.get("candidate_signals") or card.get("state_change_signal"))
        ], 3),
    ]
    selected: list[dict[str, Any]] = []
    selected_ids: set[str] = set()
    for stratum, pool, quota in pools:
        available = [card for card in pool if card["candidate_id"] not in selected_ids]
        for card in sample(available, min(quota, max(0, limit - len(selected))), f"s0-{stratum}-v1"):
            card["selection_stratum"] = stratum
            selected.append(card)
            selected_ids.add(card["candidate_id"])
    return selected


def _render_review_markdown(cards: list[dict[str, Any]]) -> str:
    lines = [
        "# Coordy S0 evidence review",
        "",
        "每例只回答 `YES`、`NO` 或 `UNCERTAIN`：这条证据链是否显示，跨 compaction 的任务状态丢失或失真，导致了有工程后果的错误行动？",
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
            f"抽样层：`{card.get('selection_stratum', 'unassigned')}`",
            f"Goal cluster：`{card.get('goal_thread_id_hash') or card['session_id_hash']}`",
            "",
            f"- 原约束/状态：{card['plain_language_case']['original_constraint']}",
            f"- 后续行为：{card['plain_language_case']['subsequent_behavior']}",
            f"- 实际后果：{card['plain_language_case']['actual_consequence']}",
            f"- 判断理由：{card['plain_language_case']['judgment_reason']}",
            f"- 缺失证据：{', '.join(card['plain_language_case']['missing_causal_links']) or 'none'}",
            "",
            "T0-T5 因果链：",
            "",
        ])
        for label, event in card["causal_chain"].items():
            excerpt = event.get("redacted_excerpt") if event else "[missing]"
            lines.append(f"- {label}: {excerpt}")
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
    opportunity_path = output / "opportunity_population.jsonl"
    cross_session_path = output / "cross_session_opportunity_population.jsonl"
    rule_discovered_path = output / "rule_discovered_episodes.jsonl"
    candidates = _read_jsonl(candidate_path)
    session_rows = _read_jsonl(session_path)
    opportunity_rows = _read_jsonl(opportunity_path)
    cross_session_rows = _read_jsonl(cross_session_path)
    rule_discovered_rows = _read_jsonl(rule_discovered_path)
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
        or artifact_hashes.get("opportunity_population_jsonl") != _hash(opportunity_path.read_bytes())
        or artifact_hashes.get("cross_session_opportunity_population_jsonl") != _hash(cross_session_path.read_bytes())
        or artifact_hashes.get("rule_discovered_episodes_jsonl") != _hash(rule_discovered_path.read_bytes())
        or screening_summary.get("candidate_decision_points") != len(candidates)
        or screening_summary.get("eligible_sessions") != len(session_rows)
        or screening_summary.get("opportunity_population_count") != len(opportunity_rows)
        or screening_summary.get("cross_session_opportunity_count") != len(cross_session_rows)
        or screening_summary.get("cross_session_opportunity_schema_version")
        != CROSS_SESSION_OPPORTUNITY_SCHEMA_VERSION
        or screening_summary.get("rule_discovered_episode_count") != len(rule_discovered_rows)
        or overflow_value != max(0, len(opportunity_rows) - len(candidates))
        or not isinstance(overflow_value, int)
        or isinstance(overflow_value, bool)
        or overflow_value < 0
        or any(
            row.get("scan_run_id") != scan_run_id
            for row in candidates + session_rows + opportunity_rows + cross_session_rows + rule_discovered_rows
        )
        or any(
            row.get("schema_version") != CROSS_SESSION_OPPORTUNITY_SCHEMA_VERSION
            for row in cross_session_rows
        )
    ):
        raise RuntimeError("screening artifacts do not belong to one complete compatible scan run")
    structural_opportunity_count = sum(1 for row in opportunity_rows if row.get("structural_opportunity") is True)
    if screening_summary.get("structural_opportunity_count") != structural_opportunity_count:
        raise RuntimeError("screening structural opportunity count does not match its population")
    sessions = {
        (_hash(str(row["session_id"])), row["scanned_prefix_sha256"]): row
        for row in session_rows
    }
    cards = []
    for candidate in candidates:
        session = sessions.get((candidate.get("session_id_hash"), candidate.get("source_prefix_sha256")))
        if session is None:
            card = {
                "candidate_id": candidate["candidate_id"],
                "session_id_hash": str(candidate.get("session_id_hash")),
                "repository_identity_hash": candidate.get("repository_identity_hash"),
                "classification": "uncertain",
                "suggested_failure_type": None,
                "system_classification": _pending_system_classification("The candidate has no bound session manifest."),
                "source_status": "missing_session_manifest",
                "evidence_completeness": {
                    "has_pre_cutoff_state": False,
                    "has_compaction": False,
                    "has_post_cutoff_action": False,
                    "has_post_cutoff_consequence": False,
                    "structural_opportunity": False,
                },
                "contemporaneous_evidence": [],
                "retrospective_outcome_evidence": [],
            }
        else:
            card = _build_card(candidate, session)
        card["goal_thread_id_hash"] = candidate.get("goal_thread_id_hash")
        card["goal_lineage_depth"] = candidate.get("goal_lineage_depth")
        cards.append(card)
    episode_overflow = overflow_value
    selected = _select_review_cards(cards, max_reviews)
    stratum_targets = {"high_signal": 6, "recall_probe": 3, "healthy_hard_negative": 3}
    stratum_actual = {
        name: sum(1 for card in selected if card.get("selection_stratum") == name)
        for name in stratum_targets
    }
    stratum_shortfalls = {
        name: f"only {stratum_actual[name]} eligible cases available for target {target}"
        for name, target in stratum_targets.items() if stratum_actual[name] < target
    }
    population_replayability_validated = (
        len(opportunity_rows) <= len(candidates)
        and all(card["source_status"] == "frozen_prefix_verified" for card in cards)
        and screening_summary.get("truncated_session_count") == 0
    )
    queue = [
        {
            "candidate_id": card["candidate_id"],
            "question": "Does this evidence chain show that lost or distorted state across compaction caused a wrong action with an engineering consequence?",
            "allowed_answers": ["YES", "NO", "UNCERTAIN"],
            "selection_stratum": card["selection_stratum"],
            "goal_cluster_hash": card.get("goal_thread_id_hash") or card["session_id_hash"],
        }
        for card in selected
    ]
    evidence_content = "".join(json.dumps(row, sort_keys=True) + "\n" for row in cards)
    queue_content = json.dumps(queue, indent=2, sort_keys=True) + "\n"
    _secure_write(output / "evidence_cards.jsonl", evidence_content)
    _secure_write(output / "user_review_queue.json", queue_content)
    answer_template = {
        "scan_run_id": scan_run_id,
        "evidence_cards_sha256": _hash(evidence_content),
        "user_review_queue_sha256": _hash(queue_content),
        "reviewer_type": None,
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
        "opportunity_population_count": len(opportunity_rows),
        "cross_session_opportunity_count": len(cross_session_rows),
        "cross_session_opportunity_schema_version": CROSS_SESSION_OPPORTUNITY_SCHEMA_VERSION,
        "structural_opportunity_count": structural_opportunity_count,
        "population_replayability_validated": population_replayability_validated,
        "cross_session_invalidation_mining_status": screening_summary.get("cross_session_invalidation_mining_status"),
        "opportunity_population_sha256": artifact_hashes["opportunity_population_jsonl"],
        "cross_session_opportunity_population_sha256": artifact_hashes["cross_session_opportunity_population_jsonl"],
        "selection_stratum_targets": stratum_targets,
        "selection_stratum_actual": stratum_actual,
        "selection_stratum_shortfalls": stratum_shortfalls,
        "evidence_cards_sha256": _hash(evidence_content),
        "user_review_queue_sha256": _hash(queue_content),
    }
    _secure_write(output / "s0_review_manifest.json", json.dumps(review_manifest, indent=2, sort_keys=True) + "\n")
    result = {
        "evidence_cards": len(cards),
        "review_cards": len(selected),
        "opportunity_population_count": len(opportunity_rows),
        "cross_session_opportunity_count": len(cross_session_rows),
        "structural_opportunity_count": structural_opportunity_count,
        "rule_discovered_episode_count": len(rule_discovered_rows),
        "candidate_episode_overflow": episode_overflow,
        "selection_stratum_actual": stratum_actual,
        "selection_stratum_shortfalls": stratum_shortfalls,
        "unavailable_sources": sum(1 for card in cards if card["source_status"] != "frozen_prefix_verified"),
        "status": "PENDING_USER_REVIEW",
        "decision": None,
    }
    if summary_path.is_file():
        summary = screening_summary
        summary.update({
            "status": result["status"],
            "decision": result["decision"],
            "user_review_queue_size": result["review_cards"],
            "evidence_cards": result["evidence_cards"],
            "rule_discovered_episode_count": result["rule_discovered_episode_count"],
            "opportunity_population_count": result["opportunity_population_count"],
            "structural_opportunity_count": result["structural_opportunity_count"],
            "s0_stop_rules_evaluated": False,
            "decision_reason": "The frozen stratified review queue must be fully answered before S0 adjudication.",
        })
        _secure_write(summary_path, json.dumps(summary, indent=2, sort_keys=True) + "\n")
    return result


def adjudicate_s0(workspace: Path, answers_path: Path) -> dict[str, Any]:
    output = workspace / "data/screening"
    evidence_path = output / "evidence_cards.jsonl"
    queue_path = output / "user_review_queue.json"
    summary_path = output / "screening_summary.json"
    manifest_path = output / "s0_review_manifest.json"
    opportunity_path = output / "opportunity_population.jsonl"
    cross_session_path = output / "cross_session_opportunity_population.jsonl"
    if not summary_path.is_file() or not manifest_path.is_file():
        raise RuntimeError("missing bound S0 review artifacts; rerun review-s0")
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    overflow_value = manifest.get("candidate_episode_overflow")
    population_count = manifest.get("opportunity_population_count")
    if (
        manifest.get("scanner_version") != SCANNER_VERSION
        or manifest.get("scan_run_id") != summary.get("scan_run_id")
        or manifest.get("evidence_cards_sha256") != _hash(evidence_path.read_bytes())
        or manifest.get("user_review_queue_sha256") != _hash(queue_path.read_bytes())
        or manifest.get("opportunity_population_sha256") != _hash(opportunity_path.read_bytes())
        or manifest.get("cross_session_opportunity_population_sha256") != _hash(cross_session_path.read_bytes())
        or not isinstance(overflow_value, int)
        or isinstance(overflow_value, bool)
        or overflow_value < 0
        or not isinstance(population_count, int)
        or isinstance(population_count, bool)
        or population_count < 0
        or summary.get("candidate_episode_overflow") != overflow_value
        or summary.get("opportunity_population_count") != population_count
        or summary.get("cross_session_opportunity_count") != manifest.get("cross_session_opportunity_count")
        or summary.get("cross_session_opportunity_schema_version")
        != manifest.get("cross_session_opportunity_schema_version")
        or summary.get("cross_session_invalidation_mining_status") != manifest.get("cross_session_invalidation_mining_status")
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
    if (
        not isinstance(answer_value, dict)
        or answer_value.get("scan_run_id") != manifest.get("scan_run_id")
        or answer_value.get("evidence_cards_sha256") != manifest.get("evidence_cards_sha256")
        or answer_value.get("user_review_queue_sha256") != manifest.get("user_review_queue_sha256")
    ):
        raise RuntimeError("S0 answers are not bound to the current evidence cards and review queue")
    answers = answer_value.get("answers") if isinstance(answer_value, dict) else None
    reviewer_type = answer_value.get("reviewer_type")
    if reviewer_type not in ALLOWED_REVIEWER_TYPES:
        raise ValueError("reviewer_type must be HUMAN_CONFIRMED or MACHINE_PRELABEL")
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
        system_classification = cards[candidate_id].get("system_classification")
        failure_type = (
            system_classification.get("failure_type")
            if isinstance(system_classification, dict)
            and system_classification.get("status") == "CLASSIFIED"
            and system_classification.get("failure_type") in {"A", "B", "C"}
            else None
        )
        normalized[candidate_id] = {
            "candidate_id": candidate_id,
            "answer": answer,
            "failure_type": failure_type if answer == "YES" else None,
        }
    missing = [candidate_id for candidate_id in queue_ids if candidate_id not in normalized]
    queue_by_id = {str(row["candidate_id"]): row for row in queue_value}
    answered_by_stratum: dict[str, list[str]] = {}
    for candidate_id, row in normalized.items():
        stratum = str(queue_by_id[candidate_id].get("selection_stratum") or "unknown")
        answered_by_stratum.setdefault(stratum, []).append(row["answer"])
    high = answered_by_stratum.get("high_signal", [])
    recall = answered_by_stratum.get("recall_probe", [])
    healthy = answered_by_stratum.get("healthy_hard_negative", [])
    high_decided = [answer for answer in high if answer != "UNCERTAIN"]
    recall_decided = [answer for answer in recall if answer != "UNCERTAIN"]
    healthy_decided = [answer for answer in healthy if answer != "UNCERTAIN"]
    confirmed_ids = [candidate_id for candidate_id, row in normalized.items() if row["answer"] == "YES"]
    confirmed_classified_ids = [
        candidate_id for candidate_id in confirmed_ids
        if normalized[candidate_id]["failure_type"] in {"A", "B", "C"}
    ]
    unclassified_confirmed_ids = sorted(set(confirmed_ids) - set(confirmed_classified_ids))
    confirmed_consequences = sum(
        1 for candidate_id in confirmed_ids
        if cards[candidate_id]["evidence_completeness"].get("has_post_cutoff_consequence")
    )
    confirmed_roots = {
        cards[candidate_id].get("goal_thread_id_hash") or cards[candidate_id].get("session_id_hash")
        for candidate_id in confirmed_ids
    }
    base = {
        "review_queue_size": len(queue_ids),
        "answers_received": len(normalized),
        "confirmed_type_abc": sum(1 for row in normalized.values() if row["failure_type"] in {"A", "B", "C"}),
        "unclassified_confirmed_cases": len(unclassified_confirmed_ids),
        "uncertain_answers": sum(1 for row in normalized.values() if row["answer"] == "UNCERTAIN"),
        "confirmed_causal_failures": len(confirmed_ids),
        "confirmed_engineering_consequences": confirmed_consequences,
        "distinct_confirmed_goal_roots": len(confirmed_roots),
        "high_signal_precision": (high.count("YES") / len(high_decided)) if high_decided else None,
        "missed_positive_probe_rate": (recall.count("YES") / len(recall_decided)) if recall_decided else None,
        "false_pause_rate": (healthy.count("YES") / len(healthy_decided)) if healthy_decided else None,
        "cluster_aware_answer_counts": {
            "distinct_goal_clusters": len({row.get("goal_cluster_hash") for row in queue_value}),
            "answers_by_stratum": {key: len(value) for key, value in answered_by_stratum.items()},
        },
        "candidate_episode_overflow": overflow_value,
        "opportunity_population_count": population_count,
        "reviewer_type": reviewer_type,
        "metrics_status": "CALIBRATED" if reviewer_type == "HUMAN_CONFIRMED" else "PRELIMINARY_MACHINE_PRELABEL",
        "scan_run_id": manifest["scan_run_id"],
        "answers_sha256": _hash(answers_path.read_bytes()),
        "evidence_cards_sha256": manifest["evidence_cards_sha256"],
        "user_review_queue_sha256": manifest["user_review_queue_sha256"],
        "opportunity_population_sha256": manifest["opportunity_population_sha256"],
        "cross_session_opportunity_population_sha256": manifest["cross_session_opportunity_population_sha256"],
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
    elif reviewer_type != "HUMAN_CONFIRMED":
        result = {
            **base,
            "status": "PENDING_HUMAN_CALIBRATION",
            "decision": None,
            "stage_outcome": None,
            "decision_reasons": ["Machine prelabels are not a substitute for the required human confirmation of the frozen stratified queue."],
        }
    else:
        recall_miss = recall.count("YES") > 0 or healthy.count("YES") > 0
        if recall_miss:
            result = {
                **base,
                "status": "PENDING_CANDIDATE_EXPANSION",
                "decision": None,
                "stage_outcome": None,
                "decision_reasons": ["A recall probe or healthy hard negative was labeled YES; expand candidate discovery before deciding."],
            }
        elif base["uncertain_answers"]:
            result = {
                **base,
                "status": "INSUFFICIENT_EVIDENCE",
                "decision": None,
                "stage_outcome": None,
                "decision_reasons": ["At least one stratified audit case remains UNCERTAIN."],
            }
        elif manifest.get("cross_session_invalidation_mining_status") != "COMPLETE":
            result = {
                **base,
                "status": "INSUFFICIENT_EVIDENCE",
                "decision": None,
                "stage_outcome": None,
                "decision_reasons": [
                    "Compaction opportunities do not cover Type B cross-session invalidation; that opportunity layer is not complete."
                ],
            }
        elif unclassified_confirmed_ids:
            result = {
                **base,
                "status": "INSUFFICIENT_EVIDENCE",
                "decision": None,
                "stage_outcome": None,
                "unclassified_confirmed_candidate_ids": unclassified_confirmed_ids,
                "decision_reasons": [
                    "At least one human-confirmed causal failure still lacks a system Type A/B/C classification with the required causal exclusions."
                ],
            }
        else:
            pivot = answer_value.get("pivot_scenario")
            if pivot is not None and not isinstance(pivot, dict):
                raise ValueError("pivot_scenario must be an object when provided")
            raw_pivot_case_ids = pivot.get("case_ids") if isinstance(pivot, dict) else []
            if not isinstance(raw_pivot_case_ids, list) or any(not isinstance(value, str) for value in raw_pivot_case_ids):
                raise ValueError("pivot_scenario.case_ids must be a list of candidate IDs")
            pivot_case_ids = set(raw_pivot_case_ids)
            if len(pivot_case_ids) != len(raw_pivot_case_ids):
                raise ValueError("pivot_scenario.case_ids must not contain duplicates")
            unknown_pivot_ids = pivot_case_ids.difference(queue_ids)
            if unknown_pivot_ids:
                raise ValueError(f"pivot_scenario references cases outside the review queue: {sorted(unknown_pivot_ids)}")
            pivot_roots = {
                cards[candidate_id].get("goal_thread_id_hash") or cards[candidate_id].get("session_id_hash")
                for candidate_id in confirmed_classified_ids if candidate_id in pivot_case_ids
            }
            pivot_reason = str(pivot.get("high_value_reason") or "").strip() if isinstance(pivot, dict) else ""
            pivot_tag = str(pivot.get("tag") or "").strip() if isinstance(pivot, dict) else ""
            confirmed_classified_set = set(confirmed_classified_ids)
            pivot_is_rare = 0 < len(confirmed_classified_set) <= PIVOT_MAX_CONFIRMED_FAILURES
            pivot_is_concentrated = pivot_case_ids == confirmed_classified_set
            if (
                pivot_tag
                and pivot_case_ids
                and pivot_is_rare
                and pivot_is_concentrated
                and (len(pivot_roots) >= 3 or pivot_reason)
            ):
                result = {
                    **base,
                    "status": "DECIDED",
                    "decision": "PIVOT",
                    "stage_outcome": "PIVOT",
                    "pivot_scenario_tag": pivot_tag,
                    "pivot_distinct_goal_roots": len(pivot_roots),
                    "pivot_confirmed_failure_count": len(confirmed_classified_set),
                    "pivot_population_rule": f"all confirmed classified failures in scenario and count <= {PIVOT_MAX_CONFIRMED_FAILURES}",
                    "decision_reasons": ["Confirmed failures repeat in an explicitly tagged narrow scenario with the required independent-root or high-value rationale."],
                }
                _secure_write(output / "s0_adjudication.json", json.dumps(result, indent=2, sort_keys=True) + "\n")
                summary.update({"status": result["status"], "decision": result["decision"], "confirmed_type_abc": result["confirmed_type_abc"], "s0_stop_rules_evaluated": True})
                _secure_write(summary_path, json.dumps(summary, indent=2, sort_keys=True) + "\n")
                return result
            reasons = []
            if manifest.get("population_replayability_validated") is True and population_count < 10:
                reasons.append("fewer than 10 replayable compaction opportunities in the complete validated population")
            if base["confirmed_type_abc"] < 5:
                reasons.append("confirmed Type A/B/C below 5 in the completed stratified queue")
            if confirmed_consequences == 0:
                reasons.append("no confirmed observable engineering consequence")
            if reasons:
                result = {
                    **base,
                    "status": "DECIDED",
                    "decision": "STOP",
                    "stage_outcome": "STOP",
                    "decision_reasons": reasons,
                }
            else:
                result = {
                    **base,
                    "status": "DECIDED",
                    "decision": "PROCEED_TO_CONFIRMATION",
                    "stage_outcome": "PROCEED_TO_CONFIRMATION",
                    "decision_reasons": ["The completed stratified audit found at least five causal failures with engineering consequences and no recall-probe miss."],
                }
    _secure_write(output / "s0_adjudication.json", json.dumps(result, indent=2, sort_keys=True) + "\n")
    if summary_path.is_file():
        summary.update({
            "status": result["status"],
            "decision": result["decision"],
            "confirmed_type_abc": result["confirmed_type_abc"],
            "s0_stop_rules_evaluated": result["status"] == "DECIDED",
        })
        _secure_write(summary_path, json.dumps(summary, indent=2, sort_keys=True) + "\n")
    return result
