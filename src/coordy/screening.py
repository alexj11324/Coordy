from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .redaction import redact_text

SCANNER_VERSION = "s0-v5"
MAX_SCAN_BYTES_PER_SESSION = 8 * 1024 * 1024
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
        yield GOAL_CONTEXT.sub("[goal context withheld]", value)[:4096]
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
        with sqlite3.connect(uri, uri=True) as database:
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
            -int(row["engineering_consequence_signal"]),
            -row["score"],
            -row["supporting_signal_count"],
            str(row.get("timestamp")),
        ),
    )
    groups: dict[str, list[dict[str, Any]]] = {}
    group_order = []
    for row in ranked:
        group = str(row.get("goal_thread_id_hash") or "not_goal_backed")
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


def _scan_rollout(
    path: Path,
    *,
    additional_eligibility_reason: str | None = None,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    stat_before = path.stat()
    digest = hashlib.sha256()
    session_id: str | None = None
    cwd_hash: str | None = None
    first_timestamp: str | None = None
    last_timestamp: str | None = None
    event_count = tool_calls = compactions = summaries = 0
    signals: list[dict[str, Any]] = []
    seen_compaction = False
    last_compaction_marker_offset: int | None = None
    last_compaction_marker_timestamp: str | None = None
    current_compaction_id_hash: str | None = None
    current_compaction_timestamp: str | None = None
    exclusion_reason: str | None = None
    conflicting_session_meta_count = 0
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
                if isinstance(raw_id, str) and session_id is None:
                    session_id = raw_id
                    cwd = payload.get("cwd")
                    if isinstance(cwd, str):
                        cwd_hash = _hash(cwd)
                    source = payload.get("source")
                    if isinstance(source, dict):
                        subagent = source.get("subagent")
                        if isinstance(subagent, dict) and subagent.get("other") == "guardian":
                            exclusion_reason = "approval_reviewer_session"
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
                    compactions += 1
                    boundary_basis = str(payload.get("id") or row.get("id") or f"{offset}:{timestamp}")
                    current_compaction_id_hash = _hash(boundary_basis)
                    current_compaction_timestamp = timestamp if isinstance(timestamp, str) else None
                last_compaction_marker_offset = offset
                last_compaction_marker_timestamp = timestamp if isinstance(timestamp, str) else None
                summaries += int(record_type == "compacted")
                seen_compaction = True
            matched = _matched_signals(record_type, payload)
            if matched:
                event_basis = str(payload.get("id") or row.get("id") or f"{offset}:{timestamp}")
                signals.append({
                    "event_id_hash": _hash(event_basis),
                    "timestamp": timestamp,
                    "signals": matched,
                    "after_compaction": seen_compaction,
                    "compaction_boundary_id_hash": current_compaction_id_hash,
                    "compaction_timestamp": current_compaction_timestamp,
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
    if additional_eligibility_reason:
        eligible_reasons.append(additional_eligibility_reason)
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
        "conflicting_session_meta_count": conflicting_session_meta_count,
        "eligible_reasons": eligible_reasons,
        "candidate_signal_count": len(signals),
        "exclusion_reason": exclusion_reason,
    }
    for signal in signals:
        signal.update({
            "session_id": session_id,
            "repository_identity_hash": cwd_hash,
            "source_prefix_sha256": session["scanned_prefix_sha256"],
        })
    return session, signals


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
    inspected = 0
    auxiliary_excluded = 0
    duplicate_sessions_excluded = 0
    selected_session_ids: set[str] = set()
    for path in files:
        if len(sessions) >= max_sessions:
            break
        inspected += 1
        lineage = goal_lineage.get(path)
        session, found = _scan_rollout(
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
            else:
                session["goal_backed"] = False
                for signal in found:
                    signal["goal_backed"] = False
            sessions.append(session)
            signals.extend(found)
            selected_session_ids.add(session["session_id"])
    episodes: dict[tuple[str, ...], dict[str, Any]] = {}
    for row in signals:
        boundary = row.get("compaction_boundary_id_hash") if row.get("after_compaction") else row["event_id_hash"]
        if row.get("goal_thread_id_hash"):
            key = "goal_lineage", str(row["goal_thread_id_hash"]), str(boundary)
        else:
            key = "session", str(row["session_id"]), str(row["source_prefix_sha256"]), str(boundary)
        existing = episodes.get(key)
        if existing is None:
            episodes[key] = {**row, "supporting_signal_count": 1}
            continue
        existing_rank = (
            int("user_correction" in existing["signals"]),
            int(existing["engineering_consequence_signal"]),
            existing["score"],
        )
        row_rank = (
            int("user_correction" in row["signals"]),
            int(row["engineering_consequence_signal"]),
            row["score"],
        )
        existing["signals"] = sorted(set(existing["signals"]) | set(row["signals"]))
        existing["engineering_consequence_signal"] = bool(
            existing["engineering_consequence_signal"] or row["engineering_consequence_signal"]
        )
        existing["supporting_signal_count"] += 1
        if row_rank > existing_rank:
            for field in ("event_id_hash", "timestamp", "score"):
                existing[field] = row[field]
    episode_rows = list(episodes.values())
    candidates = _goal_balanced_candidates(episode_rows, max_candidates)
    candidate_rows = []
    for index, row in enumerate(candidates, 1):
        candidate_rows.append({
            "candidate_id": f"s0_{index:03d}_{row['event_id_hash'][:12]}",
            **row,
            "scan_run_id": scan_run_id,
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
    session_rows = [{**row, "scan_run_id": scan_run_id} for row in sessions]
    sessions_content = "".join(json.dumps(row, sort_keys=True) + "\n" for row in session_rows)
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
        "unique_candidate_episodes_total": len(episode_rows),
        "candidate_episode_overflow": max(0, len(episode_rows) - len(candidate_rows)),
        "artifact_hashes": {
            "eligible_sessions_jsonl": _hash(sessions_content),
            "candidate_decision_points_jsonl": _hash(candidates_content),
        },
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
    _secure_write(output / "eligible_sessions.jsonl", sessions_content)
    _secure_write(output / "candidate_decision_points.jsonl", candidates_content)
    _secure_write(output / "user_review_queue.json", json.dumps(review_queue, indent=2, sort_keys=True) + "\n")
    _secure_write(output / "screening_summary.json", json.dumps(summary, indent=2, sort_keys=True) + "\n")
    return summary
