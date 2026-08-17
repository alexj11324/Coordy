from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .redaction import redact_text

SCANNER_VERSION = "s0-v1"
MAX_SCAN_BYTES_PER_SESSION = 8 * 1024 * 1024

SIGNALS = {
    "user_correction": ("你忘了", "之前已经决定", "不是原来的要求", "跑偏", "re-read", "replan"),
    "rollback_or_revert": ("git revert", "git reset", "git restore", "rollback", "hard stop"),
    "test_failure": ("test failed", "tests failed", "failed (", "assertionerror", "build failed"),
    "plan_rewrite": ("plan rewrite", "重新规划", "重新实现", "rewrite"),
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _hash(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode()
    return hashlib.sha256(value).hexdigest()


def _strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value[:4096]
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            if re.search(r"(?i)(token|secret|password|api.?key|encrypted)", str(key)):
                continue
            yield from _strings(item)


def _matched_signals(record_type: str, payload: dict[str, Any]) -> list[str]:
    """Match behavior at its owning event boundary, not in quoted tool output."""
    payload_type = str(payload.get("type") or "")
    role = str(payload.get("role") or "")
    text = "\n".join(_strings(payload)).lower()
    clean, _ = redact_text(text)
    if (record_type == "response_item" and payload_type == "message" and role in {"user", "assistant"}) or (
        record_type == "event_msg" and payload_type in {"user_message", "agent_message"}
    ):
        return [name for name, patterns in SIGNALS.items() if any(pattern in clean for pattern in patterns)]
    if record_type == "response_item" and payload_type in {"function_call", "custom_tool_call"}:
        raw_input = payload.get("arguments") or payload.get("input") or {}
        if isinstance(raw_input, str):
            try:
                raw_input = json.loads(raw_input)
            except json.JSONDecodeError:
                raw_input = {"cmd": raw_input}
        command = str(raw_input.get("cmd") or raw_input.get("command") or "") if isinstance(raw_input, dict) else ""
        actual_git_rollback = re.search(r"(?:^|[;&|]\s*)git\s+(?:revert|reset|restore)\b", command)
        return ["rollback_or_revert"] if actual_git_rollback else []
    if record_type == "response_item" and payload_type in {"function_call_output", "custom_tool_call_output"}:
        return ["test_failure"] if any(pattern in clean for pattern in SIGNALS["test_failure"]) else []
    if record_type == "event_msg" and payload_type == "tool_error":
        return ["test_failure"]
    return []


def _secure_write(path: Path, content: str) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(content)


def _scan_rollout(path: Path) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    stat_before = path.stat()
    digest = hashlib.sha256()
    session_id: str | None = None
    cwd_hash: str | None = None
    first_timestamp: str | None = None
    last_timestamp: str | None = None
    event_count = tool_calls = compactions = summaries = 0
    signals: list[dict[str, Any]] = []
    seen_compaction = False
    bytes_read = 0
    parse_errors = 0
    with path.open("rb") as handle:
        offset = 0
        while bytes_read < MAX_SCAN_BYTES_PER_SESSION:
            remaining = MAX_SCAN_BYTES_PER_SESSION - bytes_read
            raw_line = handle.readline(remaining + 1)
            if not raw_line:
                break
            if len(raw_line) > remaining:
                break
            offset += 1
            bytes_read += len(raw_line)
            digest.update(raw_line)
            if not raw_line.strip():
                continue
            try:
                row = json.loads(raw_line)
            except (json.JSONDecodeError, UnicodeDecodeError):
                parse_errors += 1
                continue
            if not isinstance(row, dict):
                parse_errors += 1
                continue
            event_count += 1
            timestamp = row.get("timestamp")
            if isinstance(timestamp, str):
                first_timestamp = first_timestamp or timestamp
                last_timestamp = timestamp
            record_type = str(row.get("type") or row.get("record_type") or "")
            payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
            payload_type = str(payload.get("type") or "")
            if record_type == "session_meta":
                raw_id = payload.get("id") or payload.get("session_id")
                if isinstance(raw_id, str):
                    session_id = raw_id
                cwd = payload.get("cwd")
                if isinstance(cwd, str):
                    cwd_hash = _hash(cwd)
            if record_type == "response_item" and payload_type in {"function_call", "custom_tool_call"}:
                tool_calls += 1
            explicit = "compact" in record_type.lower() or "compact" in payload_type.lower()
            summary = payload.get("summary")
            probable = record_type == "turn_context" and bool(summary)
            if explicit or probable:
                compactions += int(explicit)
                summaries += int(probable)
                seen_compaction = True
            matched = _matched_signals(record_type, payload)
            if matched:
                event_basis = str(payload.get("id") or row.get("id") or f"{offset}:{timestamp}")
                signals.append({
                    "event_id_hash": _hash(event_basis),
                    "timestamp": timestamp,
                    "signals": matched,
                    "after_compaction": seen_compaction,
                    "engineering_consequence_signal": any(name in {"rollback_or_revert", "test_failure"} for name in matched),
                    "score": sum(3 if name == "user_correction" else 2 for name in matched) + int(seen_compaction),
                })
    stat_after = path.stat()
    if (stat_before.st_size, stat_before.st_mtime_ns) != (stat_after.st_size, stat_after.st_mtime_ns):
        return None, []
    if not session_id:
        return None, []
    eligible_reasons = []
    if compactions or summaries:
        eligible_reasons.append("compaction_or_summary")
    if event_count >= 100 or tool_calls >= 20 or stat_before.st_size >= 1_000_000:
        eligible_reasons.append("long_or_multistage")
    if not eligible_reasons:
        return None, []
    session = {
        "session_id": session_id,
        "source_path": str(path),
        "source_size": stat_before.st_size,
        "scanned_bytes": bytes_read,
        "scan_truncated": stat_before.st_size > bytes_read,
        "scanned_prefix_sha256": digest.hexdigest(),
        "scanner_version": SCANNER_VERSION,
        "first_timestamp": first_timestamp,
        "last_timestamp": last_timestamp,
        "repository_identity_hash": cwd_hash,
        "event_count_scanned": event_count,
        "tool_call_count_scanned": tool_calls,
        "compaction_count_scanned": compactions,
        "summary_count_scanned": summaries,
        "parse_errors": parse_errors,
        "eligible_reasons": eligible_reasons,
        "candidate_signal_count": len(signals),
    }
    for signal in signals:
        signal.update({"session_id": session_id, "repository_identity_hash": cwd_hash})
    return session, signals


def run_s0_screening(
    workspace: Path,
    rollout_roots: Iterable[Path],
    *,
    max_sessions: int = 100,
    max_candidates: int = 30,
    exclude_session_ids: Iterable[str] = (),
) -> dict[str, Any]:
    if not 1 <= max_sessions <= 100:
        raise ValueError("max_sessions must be between 1 and 100")
    if not 1 <= max_candidates <= 30:
        raise ValueError("max_candidates must be between 1 and 30")
    excluded = set(exclude_session_ids)
    files = []
    for root in rollout_roots:
        if root.is_dir():
            files.extend(root.rglob("*.jsonl"))
    files.sort(key=lambda path: (path.stat().st_mtime_ns, path.stat().st_size), reverse=True)
    sessions: list[dict[str, Any]] = []
    signals: list[dict[str, Any]] = []
    inspected = 0
    for path in files:
        if len(sessions) >= max_sessions:
            break
        inspected += 1
        session, found = _scan_rollout(path)
        if session and session["session_id"] in excluded:
            continue
        if session:
            sessions.append(session)
            signals.extend(found)
    candidates = sorted(signals, key=lambda row: (-row["score"], str(row.get("timestamp"))))[:max_candidates]
    candidate_rows = []
    for index, row in enumerate(candidates, 1):
        candidate_rows.append({
            "candidate_id": f"s0_{index:03d}_{row['event_id_hash'][:12]}",
            **row,
            "classification": "uncertain",
            "note": "Deterministic signals generate a review candidate; they do not establish Type A/B/C ground truth.",
        })
    review_queue = [
        {
            "candidate_id": row["candidate_id"],
            "question": "Does the evidence chain show consequential Type A, B, or C state failure?",
            "allowed_answers": ["YES", "NO", "UNCERTAIN"],
        }
        for row in candidate_rows[:12]
    ]
    consequence_count = sum(1 for row in candidate_rows if row["engineering_consequence_signal"])
    summary = {
        "screening_version": "1",
        "scanner_version": SCANNER_VERSION,
        "created_at": _now(),
        "files_inspected": inspected,
        "excluded_sessions": len(excluded),
        "eligible_sessions": len(sessions),
        "candidate_decision_points": len(candidate_rows),
        "engineering_consequence_candidates": consequence_count,
        "confirmed_type_abc": 0,
        "user_review_queue_size": len(review_queue),
        "status": "PENDING_EVIDENCE_REVIEW",
        "decision": None,
        "decision_reason": "No Screening decision is emitted until candidate evidence is reviewed.",
        "s0_stop_rules_evaluated": False,
    }
    output = workspace / "data/screening"
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    _secure_write(output / "eligible_sessions.jsonl", "".join(json.dumps(row, sort_keys=True) + "\n" for row in sessions))
    _secure_write(output / "candidate_decision_points.jsonl", "".join(json.dumps(row, sort_keys=True) + "\n" for row in candidate_rows))
    _secure_write(output / "user_review_queue.json", json.dumps(review_queue, indent=2, sort_keys=True) + "\n")
    _secure_write(output / "screening_summary.json", json.dumps(summary, indent=2, sort_keys=True) + "\n")
    return summary
