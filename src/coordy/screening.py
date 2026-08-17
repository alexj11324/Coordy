from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import tempfile
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .redaction import redact_text

SCANNER_VERSION = "s0-v7"
MAX_SCAN_BYTES_PER_SESSION = 2 * 1024 * 1024 * 1024
MAX_SESSION_META_BYTES = 256 * 1024
REQUIRED_GOAL_COLUMNS = {
    "thread_id",
    "status",
    "tokens_used",
    "time_used_seconds",
    "created_at_ms",
    "updated_at_ms",
}

SIGNALS = {
    "user_correction": ("你忘了", "之前已经决定", "不是原来的要求", "跑偏", "re-read", "replan"),
    "rollback_or_revert": ("git revert", "git reset", "git restore", "rollback", "hard stop"),
    "test_failure": ("test failed", "tests failed", "failed (", "assertionerror", "build failed"),
    "plan_rewrite": ("plan rewrite", "重新规划", "重新实现", "rewrite"),
}
GOAL_CONTEXT = re.compile(
    r"<codex_internal_context\b[^>]*\bsource\s*=\s*['\"]goal['\"][^>]*>.*?(?:</codex_internal_context>|$)",
    flags=re.I | re.S,
)
INTERNAL_MESSAGE_ENVELOPE = re.compile(
    r"<(?P<tag>subagent_notification|recommended_plugins|environment_context|codex_delegation)\b[^>]*>.*?(?:</(?P=tag)>|$)",
    flags=re.I | re.S,
)
STATE_MARKERS = {
    "goal": ("goal", "目标"),
    "constraint": ("constraint", "requirement", "must", "禁止", "约束", "要求", "必须"),
    "decision": ("decision", "decided", "决定"),
    "plan": ("plan", "roadmap", "计划"),
    "acceptance": ("acceptance", "verify", "验收", "验证"),
}
EXPECTED_TEST_FAILURE = re.compile(
    r"\b(?:expect(?:ed|ing)?\b.{0,40}\bfail|red\s+test|should\s+fail|run\s+the\s+red)\b|预期失败|先看.{0,12}失败",
    flags=re.I | re.S,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _hash(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode()
    return hashlib.sha256(value).hexdigest()


def _timestamps_are_close(left: str | None, right: str | None, seconds: int = 5) -> bool:
    if not left or not right:
        return False
    try:
        first = datetime.fromisoformat(left.replace("Z", "+00:00"))
        second = datetime.fromisoformat(right.replace("Z", "+00:00"))
    except ValueError:
        return False
    return abs((first - second).total_seconds()) <= seconds


def _strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        clean = GOAL_CONTEXT.sub("[goal context withheld]", value)
        clean = INTERNAL_MESSAGE_ENVELOPE.sub("[internal context withheld]", clean)
        yield clean[:4096]
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            if re.search(r"(?i)(token|secret|password|api.?key|encrypted)", str(key)):
                continue
            yield from _strings(item)


def _state_categories(value: Any) -> set[str]:
    text = "\n".join(_strings(value)).lower()
    return {
        category
        for category, markers in STATE_MARKERS.items()
        if any(marker in text for marker in markers)
    }


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


def _is_engineering_consequence_event(
    record_type: str,
    payload: dict[str, Any],
    matched: Iterable[str],
    *,
    expected_test_failure: bool = False,
) -> bool:
    payload_type = str(payload.get("type") or "")
    role = str(payload.get("role") or "")
    signals = set(matched)
    if record_type == "response_item" and payload_type in {"function_call", "custom_tool_call"}:
        return "rollback_or_revert" in signals
    if record_type == "response_item" and payload_type in {"function_call_output", "custom_tool_call_output"}:
        return "test_failure" in signals and not expected_test_failure
    if record_type == "event_msg" and payload_type == "tool_error":
        return True
    actual_user_message = (
        record_type == "response_item" and payload_type == "message" and role == "user"
    ) or (record_type == "event_msg" and payload_type == "user_message")
    return actual_user_message and bool(signals & {"user_correction", "rollback_or_revert"})


def _auxiliary_exclusion_reason(source: Any) -> str | None:
    if not isinstance(source, dict):
        return None
    subagent = source.get("subagent")
    if not isinstance(subagent, dict):
        return None
    if subagent.get("other") == "guardian":
        return "approval_reviewer_session"
    spawn = subagent.get("thread_spawn")
    if not isinstance(spawn, dict):
        return None
    role = str(spawn.get("agent_role") or "").lower()
    reviewer_roles = {
        "code-reviewer", "reviewer", "security-reviewer", "python-reviewer",
        "typescript-reviewer", "java-reviewer", "database-reviewer",
        "sol_advisor_sol_reviewer",
    }
    if role in reviewer_roles:
        return "auxiliary_reviewer_session"
    path = str(spawn.get("agent_path") or "").lower().rstrip("/").split("/")[-1]
    reviewer_name = re.search(
        r"(?:^|_)(?:"
        r"spec(?:_review\d*|_retry|_default)?|"
        r"standards(?:_review\d*|_retry|_default)?|"
        r"review_spec|review_standards|standards_axis|spec_axis|"
        r"code_review|security_review|combined_review|reviewer|"
        r"audit|audit_verifier"
        r")$",
        path,
    )
    if reviewer_name and not role.endswith("implementer"):
        return "auxiliary_reviewer_session"
    return None


def _secure_write(path: Path, content: str) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(content)


def _file_signature(path: Path) -> tuple[int, int, str] | None:
    if not path.exists():
        return None
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns, _hash(path.read_bytes())


def _snapshot_sqlite_database(source: Path, destination_dir: Path) -> Path:
    """Copy a live SQLite database and sidecars without opening the source."""
    source_paths = [source, Path(f"{source}-wal"), Path(f"{source}-shm")]
    destination = destination_dir / source.name
    for _ in range(3):
        before = {path: _file_signature(path) for path in source_paths}
        if before[source] is None:
            raise RuntimeError(f"Goal database does not exist: {source}")
        for path, signature in before.items():
            target = destination_dir / path.name
            if signature is not None:
                shutil.copyfile(path, target)
            elif target.exists():
                target.unlink()
        after = {path: _file_signature(path) for path in source_paths}
        copied = {
            path: _file_signature(destination_dir / path.name) if signature is not None else None
            for path, signature in before.items()
        }
        copied_matches = all(
            before[path] is None
            or (
                copied[path] is not None
                and copied[path][0] == before[path][0]
                and copied[path][2] == before[path][2]
            )
            for path in source_paths
        )
        if before == after and copied_matches:
            return destination
    raise RuntimeError("Goal database changed while a read-only filesystem snapshot was created")


def _read_goal_catalog(goal_db: Path, minimum_seconds: int) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    if not goal_db.is_file():
        raise RuntimeError(f"Goal database does not exist: {goal_db}")
    with tempfile.TemporaryDirectory(prefix="coordy-goal-snapshot-") as temporary:
        snapshot = _snapshot_sqlite_database(goal_db, Path(temporary))
        uri = f"{snapshot.resolve().as_uri()}?mode=ro"
        with closing(sqlite3.connect(uri, uri=True)) as database:
            database.execute("PRAGMA query_only = ON")
            data_version = int(database.execute("PRAGMA data_version").fetchone()[0])
            table = database.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='thread_goals'"
            ).fetchone()
            columns = {
                str(row[1])
                for row in database.execute("PRAGMA table_info(thread_goals)")
            } if table else set()
            if not REQUIRED_GOAL_COLUMNS.issubset(columns):
                raise RuntimeError("unsupported Goal database schema")
            rows = database.execute(
                """SELECT thread_id, status, time_used_seconds
                   FROM thread_goals
                   WHERE time_used_seconds >= ?
                   ORDER BY time_used_seconds DESC, thread_id""",
                (minimum_seconds,),
            ).fetchall()
    catalog: dict[str, dict[str, Any]] = {}
    for thread_id, status, time_used_seconds in rows:
        key = str(thread_id)
        if key in catalog:
            raise RuntimeError("duplicate Goal thread identity in catalog snapshot")
        catalog[key] = {
            "status": str(status),
            "time_used_seconds": int(time_used_seconds),
        }
    schema_signature = _hash("\n".join(sorted(columns)))
    return catalog, {
        "goal_catalog_status": "verified_read_only",
        "goal_minimum_seconds": minimum_seconds,
        "multi_hour_goals_discovered": len(catalog),
        "goal_schema_signature_sha256": schema_signature,
        "goal_catalog_data_version": data_version,
    }


def _read_rollout_identity(path: Path) -> dict[str, Any] | None:
    before = path.stat()
    bytes_read = 0
    identity = None
    with path.open("rb") as handle:
        while bytes_read < MAX_SESSION_META_BYTES:
            remaining = MAX_SESSION_META_BYTES - bytes_read
            raw_line = handle.readline(remaining + 1)
            if not raw_line or len(raw_line) > remaining:
                break
            bytes_read += len(raw_line)
            if not raw_line.strip():
                continue
            try:
                row = json.loads(raw_line)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            if not isinstance(row, dict) or row.get("type") != "session_meta":
                continue
            payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
            session_id = payload.get("id") or payload.get("session_id")
            if not isinstance(session_id, str):
                break
            parent_thread_id = None
            source = payload.get("source")
            if isinstance(source, dict):
                subagent = source.get("subagent")
                if isinstance(subagent, dict):
                    spawn = subagent.get("thread_spawn")
                    if isinstance(spawn, dict) and isinstance(spawn.get("parent_thread_id"), str):
                        parent_thread_id = spawn["parent_thread_id"]
            identity = {
                "session_id": session_id,
                "parent_thread_id": parent_thread_id,
            }
            break
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise RuntimeError("rollout changed while session lineage was read")
    return identity


def _goal_lineage(
    files: list[Path],
    long_goals: dict[str, dict[str, Any]],
) -> tuple[dict[Path, dict[str, Any]], set[str]]:
    identities = {path: _read_rollout_identity(path) for path in files}
    parent_candidates: dict[str, set[str | None]] = {}
    for row in identities.values():
        if row is not None:
            parent_candidates.setdefault(row["session_id"], set()).add(row.get("parent_thread_id"))
    conflicts = [session_id for session_id, parents in parent_candidates.items() if len(parents) > 1]
    if conflicts:
        raise RuntimeError(f"conflicting parent lineage for session {_hash(conflicts[0])}")
    parent_by_session = {
        session_id: next(iter(parents))
        for session_id, parents in parent_candidates.items()
    }
    lineage: dict[Path, dict[str, Any]] = {}
    linked_roots: set[str] = set()
    for path, identity in identities.items():
        if identity is None:
            continue
        cursor = identity["session_id"]
        depth = 0
        seen = set()
        while cursor:
            if cursor in seen:
                raise RuntimeError(f"cycle in rollout lineage at session {_hash(cursor)}")
            seen.add(cursor)
            if cursor in long_goals:
                goal = long_goals[cursor]
                lineage[path] = {
                    "goal_thread_id_hash": _hash(cursor),
                    "goal_time_used_seconds": goal["time_used_seconds"],
                    "goal_lineage_depth": depth,
                }
                linked_roots.add(cursor)
                break
            cursor = parent_by_session.get(cursor)
            depth += 1
    return lineage, linked_roots


def _goal_balanced_file_order(files: list[Path], lineage: dict[Path, dict[str, Any]]) -> list[Path]:
    groups: dict[str, list[Path]] = {}
    for path in files:
        if path in lineage:
            groups.setdefault(str(lineage[path]["goal_thread_id_hash"]), []).append(path)
    for paths in groups.values():
        paths.sort(
            key=lambda path: (
                -int(lineage[path]["goal_lineage_depth"] == 0),
                -path.stat().st_mtime_ns,
                -path.stat().st_size,
            )
        )
    group_order = sorted(
        groups,
        key=lambda root_hash: (
            -int(lineage[groups[root_hash][0]]["goal_time_used_seconds"]),
            root_hash,
        ),
    )
    balanced = []
    while any(groups[root_hash] for root_hash in group_order):
        for root_hash in group_order:
            if groups[root_hash]:
                balanced.append(groups[root_hash].pop(0))
    remaining = [path for path in files if path not in lineage]
    remaining.sort(key=lambda path: (path.stat().st_mtime_ns, path.stat().st_size), reverse=True)
    return balanced + remaining


def _goal_balanced_candidates(rows: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    ranked = sorted(
        rows,
        key=lambda row: (
            -int(row["structural_opportunity"]),
            -int(row["has_observable_outcome"]),
            -len(row["rule_signals"]),
            -int(row.get("post_action_count", 0)),
            str(row.get("cutoff", {}).get("timestamp")),
        ),
    )
    groups: dict[str, list[dict[str, Any]]] = {}
    group_order = []
    for row in ranked:
        group = str(row.get("goal_thread_id_hash") or row.get("session_id_hash"))
        if group not in groups:
            groups[group] = []
            group_order.append(group)
        groups[group].append(row)
    selected = []
    while len(selected) < limit and any(groups[group] for group in group_order):
        for group in group_order:
            if groups[group] and len(selected) < limit:
                selected.append(groups[group].pop(0))
    return selected


def _deterministic_root_balanced_sample(
    rows: list[dict[str, Any]], limit: int, seed: str
) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        group = str(row.get("goal_thread_id_hash") or row.get("session_id_hash"))
        groups.setdefault(group, []).append(row)
    for group, values in groups.items():
        values.sort(key=lambda row: _hash(f"{seed}:{group}:{row['episode_id_hash']}"))
    group_order = sorted(groups, key=lambda group: _hash(f"{seed}:root:{group}"))
    selected: list[dict[str, Any]] = []
    while len(selected) < limit and any(groups[group] for group in group_order):
        for group in group_order:
            if groups[group] and len(selected) < limit:
                selected.append(groups[group].pop(0))
    return selected


def _scan_rollout(
    path: Path,
    *,
    additional_eligibility_reason: str | None = None,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]], list[dict[str, Any]]]:
    stat_before = path.stat()
    if stat_before.st_size > MAX_SCAN_BYTES_PER_SESSION:
        raise RuntimeError(f"rollout exceeds fail-closed scan ceiling: {_hash(str(path))}")
    digest = hashlib.sha256()
    session_id: str | None = None
    cwd_hash: str | None = None
    first_timestamp: str | None = None
    last_timestamp: str | None = None
    event_count = tool_calls = compactions = summaries = 0
    signals: list[dict[str, Any]] = []
    temporal_windows: list[dict[str, Any]] = []
    seen_compaction = False
    last_compaction_marker_offset: int | None = None
    last_compaction_marker_timestamp: str | None = None
    current_compaction_id_hash: str | None = None
    current_compaction_timestamp: str | None = None
    exclusion_reason: str | None = None
    conflicting_session_meta_count = 0
    bytes_read = 0
    parse_errors = 0
    state_categories_seen: set[str] = set()
    expected_failure_budget = 0
    expected_failure_pending = False
    current_window: dict[str, Any] | None = None
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
                if isinstance(raw_id, str) and session_id is None:
                    session_id = raw_id
                    cwd = payload.get("cwd")
                    if isinstance(cwd, str):
                        cwd_hash = _hash(cwd)
                    source = payload.get("source")
                    exclusion_reason = _auxiliary_exclusion_reason(source)
                elif isinstance(raw_id, str) and raw_id != session_id:
                    conflicting_session_meta_count += 1
            if record_type == "response_item" and payload_type in {"function_call", "custom_tool_call"}:
                tool_calls += 1
            explicit = record_type in {"compacted", "context_compacted"} or payload_type == "context_compacted"
            if explicit:
                same_boundary = (
                    last_compaction_marker_offset is not None
                    and offset - last_compaction_marker_offset <= 5
                    and _timestamps_are_close(last_compaction_marker_timestamp, timestamp)
                )
                if not same_boundary:
                    if current_window is not None:
                        temporal_windows.append(current_window)
                    compactions += 1
                    boundary_basis = str(payload.get("id") or row.get("id") or f"{offset}:{timestamp}")
                    current_compaction_id_hash = _hash(boundary_basis)
                    current_compaction_timestamp = timestamp if isinstance(timestamp, str) else None
                    summary_categories = _state_categories(payload)
                    current_window = {
                        "compaction_boundary_id_hash": current_compaction_id_hash,
                        "compaction_timestamp": current_compaction_timestamp,
                        "pre_state_categories": sorted(state_categories_seen),
                        "summary_state_categories": sorted(summary_categories),
                        "missing_state_categories": sorted(state_categories_seen - summary_categories),
                        "summary_available": bool(summary_categories),
                        "post_action_count": 0,
                        "engineering_consequence_count": 0,
                        "first_post_action_id_hash": None,
                        "rule_signals": [],
                        "temporal_structural_candidate": False,
                    }
                last_compaction_marker_offset = offset
                last_compaction_marker_timestamp = timestamp if isinstance(timestamp, str) else None
                summaries += int(record_type == "compacted")
                seen_compaction = True
            matched = _matched_signals(record_type, payload)
            payload_text = "\n".join(_strings(payload))
            assistant_message = (
                (record_type == "response_item" and payload_type == "message" and payload.get("role") == "assistant")
                or (record_type == "event_msg" and payload_type == "agent_message")
            )
            if assistant_message and EXPECTED_TEST_FAILURE.search(payload_text):
                expected_failure_budget = 8
                expected_failure_pending = True
            expected_test_failure = (
                (expected_failure_budget > 0 or expected_failure_pending)
                and "test_failure" in matched
            )
            consequence = _is_engineering_consequence_event(
                record_type,
                payload,
                matched,
                expected_test_failure=expected_test_failure,
            )
            if matched:
                event_basis = str(payload.get("id") or row.get("id") or f"{offset}:{timestamp}")
                signals.append({
                    "event_id_hash": _hash(event_basis),
                    "timestamp": timestamp,
                    "signals": matched,
                    "after_compaction": seen_compaction,
                    "compaction_boundary_id_hash": current_compaction_id_hash,
                    "compaction_timestamp": current_compaction_timestamp,
                    "engineering_consequence_signal": consequence,
                    "expected_test_failure": expected_test_failure,
                    "score": sum(3 if name == "user_correction" else 2 for name in matched) + int(seen_compaction),
                })
                if current_window is not None:
                    current_window["rule_signals"] = sorted(
                        set(current_window["rule_signals"]) | set(matched)
                    )
            state_message = (
                (record_type == "response_item" and payload_type == "message" and payload.get("role") in {"user", "assistant"})
                or (record_type == "event_msg" and payload_type in {"user_message", "agent_message"})
            )
            action = (
                record_type == "response_item"
                and (
                    (payload_type == "message" and payload.get("role") == "assistant")
                    or payload_type in {"function_call", "custom_tool_call"}
                )
            ) or (record_type == "event_msg" and payload_type == "agent_message")
            if state_message:
                state_categories_seen.update(_state_categories(payload))
            if seen_compaction:
                if current_window is not None:
                    if action:
                        current_window["post_action_count"] += 1
                        if current_window["first_post_action_id_hash"] is None:
                            action_basis = str(payload.get("id") or row.get("id") or f"{offset}:{timestamp}")
                            current_window["first_post_action_id_hash"] = _hash(action_basis)
                    if consequence:
                        current_window["engineering_consequence_count"] += 1
                    current_window["temporal_structural_candidate"] = bool(
                        current_window["pre_state_categories"]
                        and current_window["post_action_count"]
                        and current_window["engineering_consequence_count"]
                    )
            if expected_failure_budget > 0 and not (assistant_message and EXPECTED_TEST_FAILURE.search(payload_text)):
                expected_failure_budget -= 1
            if expected_test_failure:
                expected_failure_pending = False
    if current_window is not None:
        temporal_windows.append(current_window)
    stat_after = path.stat()
    if (stat_before.st_size, stat_before.st_mtime_ns) != (stat_after.st_size, stat_after.st_mtime_ns):
        return None, [], []
    if not session_id:
        return None, [], []
    eligible_reasons = []
    if compactions or summaries:
        eligible_reasons.append("compaction_or_summary")
    if event_count >= 100 or tool_calls >= 20 or stat_before.st_size >= 1_000_000:
        eligible_reasons.append("long_or_multistage")
    if additional_eligibility_reason:
        eligible_reasons.append(additional_eligibility_reason)
    if not eligible_reasons:
        return None, [], []
    session = {
        "session_id": session_id,
        "source_path": str(path),
        "source_size": stat_before.st_size,
        "scanned_bytes": bytes_read,
        "scan_truncated": stat_before.st_size != bytes_read,
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
        "conflicting_session_meta_count": conflicting_session_meta_count,
        "eligible_reasons": eligible_reasons,
        "candidate_signal_count": len(signals),
        "engineering_consequence_signal_count": sum(
            1 for signal in signals if signal["engineering_consequence_signal"]
        ),
        "exclusion_reason": exclusion_reason,
    }
    for signal in signals:
        signal.update({
            "session_id": session_id,
            "repository_identity_hash": cwd_hash,
            "source_prefix_sha256": session["scanned_prefix_sha256"],
        })
    for window in temporal_windows:
        window.update({
            "session_id": session_id,
            "repository_identity_hash": cwd_hash,
            "source_prefix_sha256": session["scanned_prefix_sha256"],
        })
    return session, signals, temporal_windows


def run_s0_screening(
    workspace: Path,
    rollout_roots: Iterable[Path],
    *,
    max_sessions: int = 100,
    max_candidates: int = 30,
    exclude_session_ids: Iterable[str] = (),
    goal_db: Path | None = None,
    min_goal_seconds: int = 7200,
) -> dict[str, Any]:
    if not 1 <= max_sessions <= 100:
        raise ValueError("max_sessions must be between 1 and 100")
    if not 1 <= max_candidates <= 30:
        raise ValueError("max_candidates must be between 1 and 30")
    if min_goal_seconds <= 0:
        raise ValueError("min_goal_seconds must be positive")
    excluded = set(exclude_session_ids)
    scan_run_id = _hash(os.urandom(32))
    files = []
    for root in rollout_roots:
        if root.is_dir():
            files.extend(root.rglob("*.jsonl"))
    long_goals: dict[str, dict[str, Any]] = {}
    goal_summary = {
        "goal_catalog_status": "not_configured",
        "goal_minimum_seconds": min_goal_seconds,
        "multi_hour_goals_discovered": 0,
        "goal_schema_signature_sha256": None,
        "goal_catalog_data_version": None,
    }
    goal_lineage: dict[Path, dict[str, Any]] = {}
    linked_goal_roots: set[str] = set()
    if goal_db is not None:
        long_goals, goal_summary = _read_goal_catalog(goal_db, min_goal_seconds)
        goal_lineage, linked_goal_roots = _goal_lineage(files, long_goals)
    files = _goal_balanced_file_order(files, goal_lineage)
    sessions: list[dict[str, Any]] = []
    signals: list[dict[str, Any]] = []
    temporal_opportunities: list[dict[str, Any]] = []
    inspected = 0
    auxiliary_excluded = 0
    duplicate_sessions_excluded = 0
    selected_session_ids: set[str] = set()
    for path in files:
        if len(sessions) >= max_sessions:
            break
        inspected += 1
        lineage = goal_lineage.get(path)
        session, found, found_windows = _scan_rollout(
            path,
            additional_eligibility_reason="multi_hour_goal_lineage" if lineage else None,
        )
        if session and session["session_id"] in excluded:
            continue
        if session and session.get("exclusion_reason"):
            auxiliary_excluded += 1
            continue
        if session and session["session_id"] in selected_session_ids:
            duplicate_sessions_excluded += 1
            continue
        if session:
            if lineage:
                session.update({"goal_backed": True, **lineage})
                for signal in found:
                    signal.update({"goal_backed": True, **lineage})
                for window in found_windows:
                    window.update({"goal_backed": True, **lineage})
            else:
                session["goal_backed"] = False
                for signal in found:
                    signal["goal_backed"] = False
                for window in found_windows:
                    window["goal_backed"] = False
            sessions.append(session)
            signals.extend(found)
            temporal_opportunities.extend(found_windows)
            selected_session_ids.add(session["session_id"])
    opportunities: dict[tuple[str, ...], dict[str, Any]] = {}
    for row in temporal_opportunities:
        root_identity = str(row.get("goal_thread_id_hash") or _hash(str(row["session_id"])))
        boundary = str(row["compaction_boundary_id_hash"])
        key = root_identity, boundary
        opportunity = {
            "episode_id_hash": _hash("\0".join(key)),
            "goal_thread_id_hash": row.get("goal_thread_id_hash"),
            "goal_lineage_depth": row.get("goal_lineage_depth"),
            "goal_time_used_seconds_observed": row.get("goal_time_used_seconds"),
            "session_id_hash": _hash(str(row["session_id"])),
            "repository_identity_hash": row.get("repository_identity_hash"),
            "source_prefix_sha256": row["source_prefix_sha256"],
            "cutoff": {
                "timestamp": row.get("compaction_timestamp"),
                "boundary_id_hash": boundary,
            },
            "event_id_hash": row.get("first_post_action_id_hash") or boundary,
            "has_pre_state": bool(row.get("pre_state_categories")),
            "has_post_action": int(row.get("post_action_count", 0)) > 0,
            "has_observable_outcome": int(row.get("engineering_consequence_count", 0)) > 0,
            "post_action_count": int(row.get("post_action_count", 0)),
            "observable_outcome_count": int(row.get("engineering_consequence_count", 0)),
            "rule_signals": sorted(set(row.get("rule_signals") or [])),
            "summary_available": bool(row.get("summary_available")),
            "missing_state_category_count": len(row.get("missing_state_categories") or []),
            "structural_opportunity": bool(
                row.get("pre_state_categories") and int(row.get("post_action_count", 0)) > 0
            ),
            "cluster_observation_count": 1,
        }
        existing = opportunities.get(key)
        if existing is None:
            opportunities[key] = opportunity
            continue
        existing_rank = (
            int(existing["has_observable_outcome"]),
            len(existing["rule_signals"]),
            existing["post_action_count"],
        )
        opportunity_rank = (
            int(opportunity["has_observable_outcome"]),
            len(opportunity["rule_signals"]),
            opportunity["post_action_count"],
        )
        existing["cluster_observation_count"] += 1
        existing["rule_signals"] = sorted(set(existing["rule_signals"]) | set(opportunity["rule_signals"]))
        existing["has_pre_state"] = existing["has_pre_state"] or opportunity["has_pre_state"]
        existing["has_post_action"] = existing["has_post_action"] or opportunity["has_post_action"]
        existing["has_observable_outcome"] = existing["has_observable_outcome"] or opportunity["has_observable_outcome"]
        existing["post_action_count"] = max(existing["post_action_count"], opportunity["post_action_count"])
        existing["observable_outcome_count"] = max(
            existing["observable_outcome_count"], opportunity["observable_outcome_count"]
        )
        existing["structural_opportunity"] = existing["has_pre_state"] and existing["has_post_action"]
        if opportunity_rank > existing_rank:
            for field in (
                "session_id_hash", "source_prefix_sha256", "event_id_hash",
                "repository_identity_hash", "goal_lineage_depth",
            ):
                existing[field] = opportunity[field]
    opportunity_rows = list(opportunities.values())
    rule_discovered_rows = [row for row in opportunity_rows if row["rule_signals"]]
    high_seed = _goal_balanced_candidates(
        [row for row in opportunity_rows if row["rule_signals"] and row["has_observable_outcome"]],
        min(6, max_candidates),
    )
    recall_seed = _deterministic_root_balanced_sample(
        [row for row in opportunity_rows if row["structural_opportunity"] and not row["rule_signals"]],
        min(3, max_candidates),
        "s0-recall-probe-v1",
    )
    healthy_seed = _deterministic_root_balanced_sample(
        [row for row in opportunity_rows if row["structural_opportunity"] and not row["has_observable_outcome"]],
        min(3, max_candidates),
        "s0-healthy-negative-v1",
    )
    candidates = []
    seen_candidate_ids: set[str] = set()
    for row in high_seed + recall_seed + healthy_seed + _goal_balanced_candidates(opportunity_rows, max_candidates):
        if row["episode_id_hash"] in seen_candidate_ids:
            continue
        candidates.append(row)
        seen_candidate_ids.add(row["episode_id_hash"])
        if len(candidates) >= max_candidates:
            break
    candidate_rows = []
    for index, row in enumerate(candidates, 1):
        candidate_rows.append({
            "candidate_id": f"s0_{index:03d}_{row['episode_id_hash'][:12]}",
            **row,
            "scan_run_id": scan_run_id,
            "classification": "uncertain",
            "note": "A compaction opportunity is reviewable structure, not causal Type A/B/C ground truth.",
        })
    consequence_count = sum(1 for row in candidate_rows if row["has_observable_outcome"])
    session_rows = [{**row, "scan_run_id": scan_run_id} for row in sessions]
    opportunity_rows = [{**row, "scan_run_id": scan_run_id} for row in opportunity_rows]
    rule_discovered_rows = [{**row, "scan_run_id": scan_run_id} for row in rule_discovered_rows]
    sessions_content = "".join(json.dumps(row, sort_keys=True) + "\n" for row in session_rows)
    opportunity_content = "".join(json.dumps(row, sort_keys=True) + "\n" for row in opportunity_rows)
    rule_discovered_content = "".join(
        json.dumps(row, sort_keys=True) + "\n" for row in rule_discovered_rows
    )
    candidates_content = "".join(json.dumps(row, sort_keys=True) + "\n" for row in candidate_rows)
    summary = {
        "screening_version": "1",
        "scanner_version": SCANNER_VERSION,
        "scan_run_id": scan_run_id,
        "created_at": _now(),
        "files_inspected": inspected,
        "excluded_sessions": len(excluded),
        "auxiliary_sessions_excluded": auxiliary_excluded,
        "duplicate_sessions_excluded": duplicate_sessions_excluded,
        "eligible_sessions": len(sessions),
        **goal_summary,
        "goal_lineage_rollouts_discovered": len(goal_lineage),
        "goal_lineage_sessions_selected": sum(1 for row in sessions if row.get("goal_backed")),
        "distinct_goal_roots_selected": len({
            row["goal_thread_id_hash"] for row in sessions if row.get("goal_backed")
        }),
        "root_goal_sessions_selected": sum(
            1 for row in sessions if row.get("goal_backed") and row.get("goal_lineage_depth") == 0
        ),
        "child_goal_sessions_selected": sum(
            1 for row in sessions if row.get("goal_backed") and int(row.get("goal_lineage_depth", 0)) > 0
        ),
        "unlinked_multi_hour_goals": len(long_goals) - len(linked_goal_roots),
        "candidate_decision_points": len(candidate_rows),
        "distinct_candidate_goal_roots": len({
            row["goal_thread_id_hash"] for row in candidate_rows if row.get("goal_thread_id_hash")
        }),
        "raw_candidate_signals": len(signals),
        "opportunity_population_count": len(opportunity_rows),
        "structural_opportunity_count": sum(1 for row in opportunity_rows if row["structural_opportunity"]),
        "rule_discovered_episode_count": len(rule_discovered_rows),
        "candidate_episode_overflow": max(0, len(opportunity_rows) - len(candidate_rows)),
        "truncated_session_count": sum(1 for row in sessions if row["scan_truncated"]),
        "artifact_hashes": {
            "eligible_sessions_jsonl": _hash(sessions_content),
            "opportunity_population_jsonl": _hash(opportunity_content),
            "rule_discovered_episodes_jsonl": _hash(rule_discovered_content),
            "candidate_decision_points_jsonl": _hash(candidates_content),
        },
        "engineering_consequence_candidates": consequence_count,
        "recall_audit_status": "PENDING_STRATIFIED_REVIEW",
        "cross_session_invalidation_mining_status": "NOT_EXECUTED",
        "confirmed_type_abc": 0,
        "user_review_queue_size": 0,
        "status": "PENDING_EVIDENCE_REVIEW",
        "decision": None,
        "decision_reason": "A bound stratified review and recall audit are required before any S0 decision.",
        "s0_stop_rules_evaluated": False,
    }
    output = workspace / "data/screening"
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    _secure_write(output / "eligible_sessions.jsonl", sessions_content)
    _secure_write(output / "opportunity_population.jsonl", opportunity_content)
    _secure_write(output / "rule_discovered_episodes.jsonl", rule_discovered_content)
    _secure_write(output / "candidate_decision_points.jsonl", candidates_content)
    _secure_write(output / "user_review_queue.json", "[]\n")
    _secure_write(output / "screening_summary.json", json.dumps(summary, indent=2, sort_keys=True) + "\n")
    return summary
