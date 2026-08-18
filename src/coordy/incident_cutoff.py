"""Shared, fail-closed cutoff construction for causal incident experiments.

The causal adjudication answer identifies the retrospective T0--T5 evidence, but
its prose is never used as detector input.  This module resolves those evidence
IDs back to the frozen trajectory windows and constructs the complete
discovery-event prefix that was visible at the cutoff.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .review import _hash


class IncompleteIncidentHistory(RuntimeError):
    """The source is not sufficient to run a source-complete replay safely."""


def _sequence(row: dict[str, Any]) -> int:
    value = row.get("sequence")
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError("incident evidence omitted a numeric sequence")
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("incident evidence omitted a numeric sequence") from exc
    if result < 0:
        raise ValueError("incident evidence sequence cannot be negative")
    return result


_COMMITMENT_AUTHORITIES = {
    "USER", "SPEC", "REPOSITORY_FACT", "AUTHORIZED_DECISION",
}
_COMMITMENT_TYPES = {
    "GOAL", "CONSTRAINT", "DECISION", "REJECTED_OPTION",
    "PLAN_DEPENDENCY", "ASSUMPTION", "ACCEPTANCE_CRITERION",
}
_COMMITMENT_POLARITIES = {"MUST", "MUST_NOT", "PREFER", "INFORMATIONAL"}
_COMMITMENT_STATUSES = {"ACTIVE", "SUPERSEDED", "COMPLETED", "DISPUTED"}

_DURABLE_COMMITMENT_MARKERS = (
    "must", "must not", "mustn't", "required", "constraint", "acceptance",
    "only", "never", "do not", "don't", "avoid", "keep", "prefer", "goal",
    "decision", "local", "current book", "current-book", "instead", "replace",
    "cancel", "supersede", "change", "actually", "use", "禁止", "不得", "不要",
    "不能", "必须", "仅", "只", "当前书", "改为", "改成", "取消", "替换", "采用",
)
_LIFECYCLE_MARKERS = (
    "instead", "replace", "cancel", "supersede", "change", "actually", "改为",
    "改成", "取消", "替换", "不再", "不要",
)


def _text_tokens(value: Any) -> set[str]:
    return {
        token.casefold()
        for token in re.findall(r"[a-z0-9]+|[\u3400-\u9fff]", str(value or ""), flags=re.IGNORECASE)
    }


_NON_SUBSTANTIVE_RELATION_TOKENS = {
    "a", "an", "and", "are", "be", "by", "for", "from", "in", "is", "it",
    "all", "button", "change", "color", "current", "entire", "global", "keep", "local",
    "must", "new", "not", "of", "old", "on", "or", "phase", "the", "this", "to", "use", "with",
    # Broad domain nouns do not identify the object being changed.  A
    # lifecycle update must share a distinctive target (for example SQLite),
    # not merely the topic word ``storage`` or a UI surface noun.
    "app", "backend", "database", "feature", "layout", "network", "policy", "screen",
    "settings", "storage", "system", "topic", "ui",
    "whole",
}


def _substantive_text_tokens(value: Any) -> set[str]:
    return _text_tokens(value) - _NON_SUBSTANTIVE_RELATION_TOKENS


def _is_durable_commitment_text(event: dict[str, Any]) -> bool:
    """Use only source text markers for the deterministic fallback extractor.

    This fallback is used by hand-built fixtures without the independent Luna
    discovery artifact.  It intentionally excludes ordinary user chatter.
    Real trajectory runs pass the source-bound Luna findings instead.
    """
    content = str(event.get("content") or "").casefold()
    for marker in _DURABLE_COMMITMENT_MARKERS:
        marker = marker.casefold()
        if marker.isascii() and marker.replace(" ", "").replace("'", "").isalnum():
            if re.search(r"(?<![a-z0-9])" + re.escape(marker).replace(r"\ ", r"\s+") + r"(?![a-z0-9])", content):
                return True
        elif marker in content:
            return True
    return False


def _infer_polarity(event: dict[str, Any], claim: str, authority: str) -> str:
    explicit = event.get("polarity")
    if isinstance(explicit, str) and explicit.upper() in _COMMITMENT_POLARITIES:
        return explicit.upper()
    text = f"{claim} {event.get('content') or ''}".casefold()
    if any(marker in text for marker in ("must not", "mustn't", "do not", "don't", "never", "禁止", "不得", "不要", "不能")):
        return "MUST_NOT"
    if authority == "REPOSITORY_FACT" and not any(
        marker in text for marker in ("must", "required", "必须", "不得", "禁止")
    ):
        return "INFORMATIONAL"
    return "MUST"


def _infer_type(event: dict[str, Any], claim: str) -> str:
    explicit = event.get("commitment_type")
    if isinstance(explicit, str) and explicit.upper() in _COMMITMENT_TYPES:
        return explicit.upper()
    text = f"{event.get('topic') or ''} {claim}".casefold()
    if any(marker in text for marker in ("goal", "objective", "目标")):
        return "GOAL"
    if any(marker in text for marker in ("acceptance", "验收", "test", "测试")):
        return "ACCEPTANCE_CRITERION"
    if any(marker in text for marker in ("decision", "决定", "architecture", "架构")):
        return "DECISION"
    if any(marker in text for marker in ("plan", "next", "依赖", "计划")):
        return "PLAN_DEPENDENCY"
    return "CONSTRAINT"


def _explicit_authority(event: dict[str, Any]) -> str | None:
    for key in ("authority", "commitment_authority", "source_authority"):
        value = event.get(key)
        if isinstance(value, str) and value.upper() in _COMMITMENT_AUTHORITIES:
            return value.upper()
    actor = str(event.get("actor") or "").upper()
    return "USER" if actor == "USER" else None


def _is_authoritative_event(event: dict[str, Any]) -> bool:
    """Return true only for an explicit authority, never an agent/tool event."""
    return _explicit_authority(event) is not None


def _finding_sources_support_authority(
    authority: str, source_events: list[dict[str, Any]]
) -> bool:
    """Bind a machine finding's authority to observable source provenance.

    A Luna label is only a prelabel.  USER/SPEC/authorized decisions need an
    actual USER source; repository facts need a tool/result or patch/task
    event.  This rejects an assistant-only finding instead of upgrading agent
    prose into an authoritative commitment.
    """
    actors = {str(event.get("actor") or "").casefold() for event in source_events}
    payload_types = {str(event.get("payload_type") or "").casefold() for event in source_events}
    record_types = {str(event.get("record_type") or "").casefold() for event in source_events}
    if authority in {"USER", "SPEC", "AUTHORIZED_DECISION"}:
        # An explicit assistant/agent source can explain a finding, but it
        # cannot contribute authority to a USER commitment.  Requiring every
        # explicitly identified actor to be USER prevents a mixed citation
        # such as ``[user: request, assistant: invented constraint]`` from
        # upgrading the agent's prose into durable state.
        return "user" in actors and not actors.intersection({"assistant", "agent"})
    if authority == "REPOSITORY_FACT":
        return bool(
            "user" in actors
            or payload_types.intersection({"function_call_output", "custom_tool_call_output"})
            or (
                "event_msg" in record_types
                and payload_types.intersection({"patch_apply_end", "tool_error", "task_complete"})
            )
        )
    return False


def build_commitment_ledger(
    events: list[dict[str, Any]],
    *,
    goal_root_id: str,
    topic: str | None,
    id_prefix: str,
    extracted_findings: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Index authoritative source events without treating agent prose as truth.

    The discovery packets do not contain a second LLM state summary.  Therefore
    the ledger is built from source-bound Luna commitment findings when they are
    available.  A small source-text marker extractor remains only for isolated
    hand-built fixtures that have no discovery artifact.  Human T0/T1/T2 labels
    are never inputs to this function.
    """
    rows: list[dict[str, Any]] = []
    by_event_id: dict[str, dict[str, Any]] = {}
    by_commitment_id: dict[str, dict[str, Any]] = {}
    event_by_id: dict[str, dict[str, Any]] = {}
    for raw_event in events:
        if not isinstance(raw_event, dict):
            continue
        evidence_id = str(raw_event.get("evidence_id") or "")
        if evidence_id:
            event_by_id[evidence_id] = dict(raw_event)
        source_id = str(raw_event.get("source_evidence_id") or "")
        if source_id:
            event_by_id[source_id] = dict(raw_event)
    candidate_events: list[dict[str, Any]] = []
    if extracted_findings is not None:
        for finding in extracted_findings:
            if not isinstance(finding, dict) or finding.get("kind") not in {
                "COMMITMENT", "AUTHORIZED_UPDATE",
            }:
                continue
            directions = finding.get("discovery_directions")
            if not isinstance(directions, list) or set(map(str, directions)) != {"forward"}:
                # Backward discovery is retained for audit/anchor analysis but
                # cannot establish cutoff commitment state, even when a
                # finding was coincidentally repeated by both directions.
                continue
            authority = str(finding.get("authority") or "").upper()
            if authority not in _COMMITMENT_AUTHORITIES:
                continue
            source_ids = finding.get("source_event_ids") or finding.get("event_ids")
            if (
                not isinstance(source_ids, list)
                or not source_ids
                or any(not isinstance(value, str) or not value for value in source_ids)
                or not set(source_ids) <= set(event_by_id)
            ):
                # A Luna finding that reaches outside the visible prefix is
                # future-bound and must be ignored, not truncated.
                continue
            source_ids = list(dict.fromkeys(source_ids))
            source_events = [event_by_id[value] for value in source_ids]
            if not _finding_sources_support_authority(authority, source_events):
                raise ValueError(
                    "trajectory commitment finding authority is not supported by its source actors"
                )
            first = min(
                source_events,
                key=lambda row: (_sequence(row), str(row.get("timestamp") or ""), str(row.get("evidence_id"))),
            )
            visible_source_ids = list(dict.fromkeys(
                str(event.get("evidence_id")) for event in source_events
                if str(event.get("evidence_id") or "")
            ))
            candidate = dict(first)
            candidate["evidence_id"] = str(first["evidence_id"])
            candidate["source_event_ids"] = visible_source_ids
            candidate["source_origin_event_ids"] = source_ids
            candidate["claim"] = str(finding.get("statement") or "").strip()
            candidate["topic"] = str(finding.get("topic") or topic or "")
            if finding.get("scope") is not None:
                candidate["scope"] = str(finding.get("scope"))
            candidate["authority"] = authority
            candidate["commitment_id"] = str(
                finding.get("commitment_id")
                or _hash(json.dumps({
                    "goal_root_id": goal_root_id,
                    "topic": candidate["topic"],
                    "claim": candidate["claim"],
                    "source_event_ids": source_ids,
                }, ensure_ascii=False, sort_keys=True))
            )
            candidate["commitment_type"] = finding.get("type") or finding.get("commitment_type")
            candidate["polarity"] = finding.get("polarity")
            for relation_key in ("supersedes_event_ids", "supersedes_commitment_ids"):
                relation = finding.get(relation_key)
                if relation is not None:
                    candidate[relation_key] = list(relation) if isinstance(relation, list) else relation
            candidate["extraction_source"] = "trajectory_union_findings_luna"
            candidate["extraction_kind"] = str(finding.get("kind"))
            candidate_events.append(candidate)
    else:
        for raw in events:
            if not isinstance(raw, dict):
                continue
            event = dict(raw)
            if _explicit_authority(event) is None:
                continue
            explicit_commitment_fields = {
                "commitment_type", "commitment_status", "commitment_id", "polarity",
                "superseded_by", "supersedes", "supersedes_event_ids", "supersedes_commitment_ids",
            }
            if not (bool(explicit_commitment_fields.intersection(event)) or _is_durable_commitment_text(event)):
                continue
            event["extraction_source"] = "source_text_marker_fallback"
            candidate_events.append(event)
    for event in sorted(
        candidate_events,
        key=lambda row: (_sequence(row), str(row.get("timestamp") or ""), str(row.get("evidence_id"))),
    ):
        event_id = str(event.get("evidence_id") or "")
        if not event_id:
            raise ValueError("authoritative commitment event omitted evidence_id")
        authority = _explicit_authority(event)
        assert authority is not None
        commitment_id = str(
            event.get("commitment_id")
            or _hash(f"{id_prefix}:commitment:{event_id}")
        )
        if commitment_id in by_commitment_id:
            existing = by_commitment_id[commitment_id]
            claim = str(event.get("claim") or event.get("content") or "")
            if existing.get("claim") != claim or existing.get("topic") != str(event.get("topic") or topic or ""):
                raise ValueError("commitment ledger repeats an identity with conflicting content")
            existing["source_event_ids"] = list(dict.fromkeys(
                [*(existing.get("source_event_ids") or []), str(event_id)]
            ))
            if event.get("source_origin_event_ids"):
                existing["source_origin_event_ids"] = list(dict.fromkeys(
                    [*(existing.get("source_origin_event_ids") or []), *event["source_origin_event_ids"]]
                ))
            continue
        source_event_ids = event.get("source_event_ids")
        if source_event_ids is None:
            source_ids = [event_id]
        elif isinstance(source_event_ids, list) and all(isinstance(value, str) and value for value in source_event_ids):
            source_ids = list(dict.fromkeys([event_id, *source_event_ids]))
        else:
            raise ValueError("commitment source_event_ids are invalid")
        status = str(event.get("commitment_status") or "ACTIVE").upper()
        if status not in _COMMITMENT_STATUSES:
            raise ValueError("commitment lifecycle status is invalid")
        superseded_by = event.get("superseded_by")
        if superseded_by is not None and not isinstance(superseded_by, str):
            raise ValueError("commitment superseded_by is invalid")
        if superseded_by:
            status = "SUPERSEDED"
        row = {
            "commitment_id": commitment_id,
            "goal_root_id": goal_root_id,
            "topic": str(event.get("topic") or topic or ""),
            "type": _infer_type(event, str(event.get("claim") or event.get("content") or "")),
            "claim": str(event.get("claim") or event.get("content") or ""),
            "polarity": _infer_polarity(
                event,
                str(event.get("claim") or event.get("content") or ""),
                authority,
            ),
            "authority": authority,
            "scope": str(event.get("scope") or topic or ""),
            "valid_from_event_id": event_id,
            "status": status,
            "superseded_by": superseded_by,
            "source_event_ids": source_ids,
        }
        if event.get("extraction_source"):
            row["extraction_source"] = str(event["extraction_source"])
        if event.get("source_origin_event_ids"):
            row["source_origin_event_ids"] = list(event["source_origin_event_ids"])
        if event.get("extraction_kind"):
            row["extraction_kind"] = str(event["extraction_kind"])
        if row["type"] not in _COMMITMENT_TYPES:
            raise ValueError("commitment type is invalid")
        if row["polarity"] not in _COMMITMENT_POLARITIES:
            raise ValueError("commitment polarity is invalid")
        explicit_supersedes = event.get("supersedes_commitment_ids") or event.get("supersedes") or []
        explicit_supersedes_events = event.get("supersedes_event_ids") or []
        if not isinstance(explicit_supersedes, list) or not isinstance(explicit_supersedes_events, list):
            raise ValueError("commitment supersession references are invalid")
        for superseded_event_id in explicit_supersedes_events:
            if superseded_event_id not in by_event_id:
                raise ValueError("commitment supersedes an unknown prior event")
        rows.append(row)
        # Keep both identities addressable.  Trajectory findings cite the
        # original ``source_evidence_id`` while detector packets expose the
        # derived, visible ``evidence_id``.  A supersession relation may use
        # either form, including a non-first source in a multi-event finding.
        relation_event_ids = [*source_ids, *(event.get("source_origin_event_ids") or [])]
        if any(not isinstance(value, str) or not value for value in relation_event_ids):
            raise ValueError("commitment source provenance is invalid")
        for source_event_id in dict.fromkeys(relation_event_ids):
            prior = by_event_id.get(str(source_event_id))
            if prior is not None and prior is not row:
                raise ValueError("commitment source event belongs to conflicting ledger rows")
            by_event_id[str(source_event_id)] = row
        by_commitment_id[commitment_id] = row
        lifecycle_text = f"{event.get('claim') or ''} {event.get('content') or ''}".casefold()
        explicit_update_marker = any(marker in lifecycle_text for marker in _LIFECYCLE_MARKERS)
        # An AUTHORIZED_UPDATE finding supplies authority, but its kind alone
        # is not a supersession relation.  Automatic lifecycle closure needs
        # an explicit change marker plus a distinctive target overlap.  An
        # AUTHORIZED_UPDATE must instead carry explicit supersedes_* IDs; its
        # prose alone is never allowed to close an older commitment.
        if explicit_update_marker and event.get("extraction_kind") != "AUTHORIZED_UPDATE":
            current_tokens = _substantive_text_tokens(row["claim"])
            for old in reversed(rows[:-1]):
                if old["status"] != "ACTIVE" or old["topic"] != row["topic"]:
                    continue
                old_tokens = _substantive_text_tokens(old.get("claim"))
                # AUTHORIZED_UPDATE is an authority-bearing finding, not a
                # license to close every same-topic commitment.  Require a
                # shared distinctive token; explicit supersedes_* references
                # are handled below for AUTHORIZED_UPDATE findings.
                related = bool(current_tokens & old_tokens) if current_tokens and old_tokens else False
                if not related:
                    continue
                old["status"] = "SUPERSEDED"
                old["superseded_by"] = commitment_id
                break
        for old_id in [str(value) for value in explicit_supersedes] + [
            str(by_event_id[value]["commitment_id"])
            for value in explicit_supersedes_events
        ]:
            old = by_commitment_id.get(old_id)
            if old is None:
                raise ValueError("commitment supersedes an unknown prior commitment")
            if old["status"] == "ACTIVE":
                old["status"] = "SUPERSEDED"
                old["superseded_by"] = commitment_id
    for row in rows:
        if row["status"] == "SUPERSEDED" and not row.get("superseded_by"):
            raise ValueError("superseded commitment omitted its replacement")
    return rows


def _load_session_discovery_events(session: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Read one frozen source session without modifying the source artifact."""
    source_path = Path(str(session.get("source_path") or ""))
    if not source_path.is_file():
        raise IncompleteIncidentHistory("bound eligible session source is unavailable")
    expected_bytes = int(session.get("scanned_bytes") or 0)
    expected_digest = str(session.get("scanned_prefix_sha256") or "")
    from .review import _is_compaction
    from .trajectory import _discovery_event, _is_discovery_event

    events: dict[str, dict[str, Any]] = {}
    digest = hashlib.sha256()
    remaining = expected_bytes
    with source_path.open("rb") as handle:
        line_number = 0
        while remaining:
            raw_line = handle.readline()
            if not raw_line or len(raw_line) > remaining:
                raise IncompleteIncidentHistory("bound eligible session source is truncated")
            remaining -= len(raw_line)
            digest.update(raw_line)
            line_number += 1
            try:
                raw = json.loads(raw_line)
            except json.JSONDecodeError as exc:
                raise IncompleteIncidentHistory("bound eligible session source is invalid JSONL") from exc
            if not isinstance(raw, dict) or (not _is_compaction(raw) and not _is_discovery_event(raw)):
                continue
            event = _discovery_event(raw, line_number)
            if _is_compaction(raw):
                event["record_type"] = "compacted"
            event["sequence"] = line_number
            event["source_evidence_id"] = str(event.get("evidence_id") or "")
            event["source_session_id_hash"] = _hash(str(session["session_id"]))
            if event["source_evidence_id"] in events:
                raise IncompleteIncidentHistory("bound eligible session repeats an event identity")
            events[event["source_evidence_id"]] = event
    if remaining or digest.hexdigest() != expected_digest:
        raise IncompleteIncidentHistory("bound eligible session no longer matches its scan hash")
    return events


def _load_commitment_findings(findings_path: Path | None, manifest_path: Path) -> list[dict[str, Any]]:
    if findings_path is None:
        candidate = manifest_path.parent / "trajectory_union_findings.jsonl"
        findings_path = candidate if candidate.is_file() else None
    if findings_path is None or not findings_path.is_file():
        raise IncompleteIncidentHistory("independent Luna commitment findings are unavailable")
    if not manifest_path.is_file():
        raise IncompleteIncidentHistory("trajectory manifest is required to bind commitment findings")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    union = manifest.get("trajectory_union")
    expected = union.get("union_findings_sha256") if isinstance(union, dict) else None
    if not isinstance(expected, str) or not expected:
        raise IncompleteIncidentHistory("trajectory manifest omitted the commitment findings hash")
    if expected != _hash(findings_path.read_bytes()):
        raise IncompleteIncidentHistory("trajectory commitment findings are not bound to the scan")
    rows = [json.loads(line) for line in findings_path.read_text(encoding="utf-8").splitlines() if line]
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("trajectory commitment findings contain an invalid row")
        if row.get("kind") == "COMMITMENT":
            source_ids = row.get("source_event_ids")
            if (
                not isinstance(source_ids, list)
                or not source_ids
                or len(source_ids) != len(set(source_ids))
                or any(not isinstance(value, str) or not value for value in source_ids)
            ):
                raise ValueError("trajectory commitment finding has invalid source evidence")
            if str(row.get("authority") or "").upper() not in _COMMITMENT_AUTHORITIES:
                raise ValueError("trajectory commitment finding has invalid authority")
            for relation_key in ("supersedes_event_ids", "supersedes_commitment_ids"):
                relation = row.get(relation_key)
                if relation is not None and (
                    not isinstance(relation, list)
                    or len(relation) != len(set(relation))
                    or any(not isinstance(value, str) or not value for value in relation)
                ):
                    raise ValueError("trajectory supersession references are invalid")
    return rows


def build_incident_history_index(
    windows_path: Path,
    *,
    eligible_sessions_path: Path | None = None,
    commitment_findings_path: Path | None = None,
) -> dict[str, Any]:
    """Reassemble transport shards and index every Goal-root source session.

    ``trajectory_windows.jsonl`` covers compaction parents only.  A complete
    Goal-root prefix therefore also requires the bound ``eligible_sessions``
    manifest so sessions with no compaction opportunity are not silently lost.
    """
    if not windows_path.is_file():
        raise IncompleteIncidentHistory("frozen trajectory windows are required")
    windows = [json.loads(line) for line in windows_path.read_text(encoding="utf-8").splitlines() if line]
    if not windows:
        raise IncompleteIncidentHistory("frozen trajectory windows are empty")
    from .incidents import _source_events_from_trajectory_windows

    complete, opportunities = _source_events_from_trajectory_windows(windows)
    parent_sessions: dict[str, str] = {}
    parent_goals: dict[str, str] = {}
    synthetic_parents: set[str] = set()
    for window in windows:
        parent = str(window.get("parent_opportunity_id_hash") or window["opportunity_id_hash"])
        session = str(window.get("session_id_hash") or "")
        goal = str(window.get("goal_thread_id_hash") or "")
        if not session or not goal:
            raise IncompleteIncidentHistory("trajectory window omitted session or Goal identity")
        if parent in parent_sessions and parent_sessions[parent] != session:
            raise ValueError("trajectory shards disagree about the source session")
        if parent in parent_goals and parent_goals[parent] != goal:
            raise ValueError("trajectory shards disagree about the source Goal")
        parent_sessions[parent] = session
        parent_goals[parent] = goal
        if window.get("synthetic_no_compaction") is True:
            synthetic_parents.add(parent)
    for parent in opportunities:
        if parent not in parent_sessions:
            raise ValueError("trajectory opportunity has no source session")
    # Synthetic no-compaction units are discovery containers, not causal
    # boundaries.  Keep their source events in ``complete`` while removing
    # the marker from the opportunity map used to append compaction events.
    for parent in synthetic_parents:
        opportunities.pop(parent, None)
    if eligible_sessions_path is None:
        sibling = windows_path.parent / "eligible_sessions.jsonl"
        eligible_sessions_path = sibling if sibling.is_file() else None
    if eligible_sessions_path is None or not eligible_sessions_path.is_file():
        raise IncompleteIncidentHistory(
            "complete Goal-root history requires the bound eligible_sessions.jsonl artifact"
        )
    eligible_sessions = [
        json.loads(line) for line in eligible_sessions_path.read_text(encoding="utf-8").splitlines() if line
    ]
    if not eligible_sessions:
        raise IncompleteIncidentHistory("bound eligible session index is empty")
    manifest_path = windows_path.parent / "trajectory_manifest.json"
    if not manifest_path.is_file():
        raise IncompleteIncidentHistory("trajectory manifest is required to bind eligible sessions")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected_sessions_hash = manifest.get("eligible_sessions_sha256")
    if not isinstance(expected_sessions_hash, str) or not expected_sessions_hash:
        raise IncompleteIncidentHistory("trajectory manifest omitted the eligible session index hash")
    if expected_sessions_hash != _hash(eligible_sessions_path.read_bytes()):
        raise IncompleteIncidentHistory("eligible session index is not bound to trajectory scan")
    session_metadata: dict[str, dict[str, Any]] = {}
    session_goals: dict[str, str] = {}
    goal_sessions: dict[str, list[str]] = {}
    window_scan_runs = {
        str(window.get("scan_run_id") or "") for window in windows if window.get("scan_run_id")
    }
    for session in eligible_sessions:
        if not isinstance(session, dict) or not session.get("session_id") or not session.get("goal_thread_id_hash"):
            raise IncompleteIncidentHistory("eligible session omitted Goal or session identity")
        if window_scan_runs and str(session.get("scan_run_id") or "") not in window_scan_runs:
            raise IncompleteIncidentHistory("eligible session belongs to a different scan run")
        session_id = _hash(str(session["session_id"]))
        if session_id in session_metadata:
            raise ValueError("eligible session index repeats a session identity")
        session_metadata[session_id] = session
        goal = str(session["goal_thread_id_hash"])
        session_goals[session_id] = goal
        goal_sessions.setdefault(goal, []).append(session_id)
    for goal in goal_sessions:
        goal_sessions[goal].sort()
    # Add a synthetic source unit for sessions with no compaction boundary.
    # It has no boundary record; context construction loads its raw events only
    # when the relevant Goal root is actually requested.
    for session_id, goal in session_goals.items():
        if session_id in set(parent_sessions.values()):
            continue
        metadata = session_metadata[session_id]
        if int(metadata.get("compaction_count_scanned") or 0) > 0:
            raise IncompleteIncidentHistory(
                "eligible session has compactions missing from trajectory windows"
            )
        pseudo_parent = f"session:{session_id}"
        if pseudo_parent in parent_sessions:
            raise ValueError("synthetic session source identity collides with an opportunity")
        parent_sessions[pseudo_parent] = session_id
        parent_goals[pseudo_parent] = goal
        opportunities.setdefault(pseudo_parent, None)
    commitment_findings = _load_commitment_findings(commitment_findings_path, manifest_path)
    return {
        "complete": complete,
        "opportunities": opportunities,
        "parent_sessions": parent_sessions,
        "parent_goals": parent_goals,
        "goal_parents": {
            goal: sorted(parent for parent, value in parent_goals.items() if value == goal)
            for goal in set(parent_goals.values())
        },
        "windows_sha256": _hash(windows_path.read_bytes()),
        "eligible_sessions_sha256": _hash(eligible_sessions_path.read_bytes()),
        "session_metadata": session_metadata,
        "session_goals": session_goals,
        "goal_sessions": goal_sessions,
        "commitment_findings": commitment_findings,
        "commitment_findings_sha256": _hash(
            (manifest_path.parent / "trajectory_union_findings.jsonl").read_bytes()
            if commitment_findings_path is None and (manifest_path.parent / "trajectory_union_findings.jsonl").is_file()
            else commitment_findings_path.read_bytes() if commitment_findings_path is not None else b""
        ),
    }


def _packet_parent_ids(packet: dict[str, Any], boundary_by_id: dict[str, dict[str, Any]]) -> list[str]:
    configured = packet.get("source_parent_opportunity_id_hashes")
    if isinstance(configured, list) and configured and all(isinstance(item, str) and item for item in configured):
        parent_ids = [str(item) for item in configured]
    else:
        parent_ids = [str(boundary.get("parent_opportunity_id_hash")) for boundary in boundary_by_id.values()]
    if not parent_ids or len(parent_ids) != len(set(parent_ids)):
        raise IncompleteIncidentHistory("incident packet omitted unique parent opportunities")
    return parent_ids


def _fallback_history(packet: dict[str, Any], cutoff_sequence: int) -> dict[str, Any]:
    if packet.get("complete_history_prefix") is not True:
        raise IncompleteIncidentHistory("incident packet is a sparse cluster, not a complete history prefix")
    rows = packet.get("source_history_prefix")
    if not isinstance(rows, list) or not rows:
        raise IncompleteIncidentHistory("complete history prefix source is missing")
    history: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in rows:
        if not isinstance(raw, dict) or not isinstance(raw.get("evidence_id"), str):
            raise ValueError("complete history prefix contains an invalid event")
        event = dict(raw)
        evidence_id = str(event["evidence_id"])
        if evidence_id in seen:
            raise ValueError("complete history prefix repeats an evidence ID")
        seen.add(evidence_id)
        event["sequence"] = _sequence(event)
        if event["sequence"] <= cutoff_sequence:
            history.append(event)
    history.sort(key=lambda row: (int(row["sequence"]), str(row["evidence_id"])))
    return {
        "full_history_prefix": history,
        "source_session_id_hash": str(packet.get("source_session_id_hash") or ""),
        "parent_opportunity_ids": list(packet.get("source_parent_opportunity_id_hashes") or []),
        "cutoff_order_mode": "sequence",
        "cutoff_order": {"sequence": int(cutoff_sequence)},
    }


def _event_order(event: dict[str, Any], session_id: str, evidence_id: str) -> tuple[str, int, str, str]:
    timestamp = event.get("timestamp")
    if not isinstance(timestamp, str) or not timestamp:
        raise IncompleteIncidentHistory("Goal-root history event omitted a timestamp")
    return (timestamp, _sequence(event), session_id, evidence_id)


def _order_payload(order: tuple[Any, ...]) -> dict[str, Any]:
    if len(order) == 1:
        return {"sequence": int(order[0])}
    if len(order) != 4:
        raise ValueError("incident cutoff order has an invalid shape")
    return {
        "timestamp": str(order[0]),
        "sequence": int(order[1]),
        "session_id_hash": str(order[2]),
        "evidence_id": str(order[3]),
    }


def _sort_events(rows: list[dict[str, Any]]) -> None:
    rows.sort(key=lambda row: (
        str(row.get("timestamp") or ""),
        int(row.get("sequence") or 0),
        str(row.get("source_session_id_hash") or ""),
        str(row.get("evidence_id") or ""),
    ))


def build_incident_cutoff_context(
    packet: dict[str, Any],
    answer: dict[str, Any],
    *,
    history_index: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build all detector-visible context at one human-confirmed T2 cutoff.

    Human summaries and classifications are deliberately absent from the result.
    Only source events and compacted boundary records are returned.
    """
    source_events = packet.get("source_events")
    boundaries = packet.get("compaction_opportunities")
    if not isinstance(source_events, list) or not isinstance(boundaries, list):
        raise IncompleteIncidentHistory("incident packet lacks source events or boundaries")
    source_by_id: dict[str, dict[str, Any]] = {}
    local_by_parent_source: dict[tuple[str, str], dict[str, Any]] = {}
    for raw in source_events:
        if not isinstance(raw, dict) or not isinstance(raw.get("evidence_id"), str):
            raise ValueError("incident packet contains an invalid source event")
        event = dict(raw)
        evidence_id = str(event["evidence_id"])
        if evidence_id in source_by_id:
            raise ValueError("incident packet repeats a source evidence ID")
        event["sequence"] = _sequence(event)
        source_by_id[evidence_id] = event
        parent = str(event.get("parent_opportunity_id_hash") or "")
        source_id = str(event.get("source_evidence_id") or evidence_id)
        if parent:
            local_by_parent_source[(parent, source_id)] = event
    boundary_by_id: dict[str, dict[str, Any]] = {}
    for raw in boundaries:
        if not isinstance(raw, dict) or not isinstance(raw.get("boundary_id_hash"), str):
            raise ValueError("incident packet contains an invalid compaction boundary")
        boundary = dict(raw)
        boundary_id = str(boundary["boundary_id_hash"])
        if boundary_id in boundary_by_id:
            raise ValueError("incident packet repeats a compaction boundary")
        event = boundary.get("compaction_event")
        if not isinstance(event, dict):
            raise ValueError("compaction boundary omitted its event")
        boundary["_sequence"] = _sequence(event)
        boundary_by_id[boundary_id] = boundary

    indexed_parent_sessions: dict[str, str] = {}
    if history_index is not None:
        indexed_parent_sessions = dict(history_index.get("parent_sessions") or {})
    indexed_packet_parents = (
        _packet_parent_ids(packet, boundary_by_id) if history_index is not None else []
    )

    def event_session(event: dict[str, Any], *, boundary: dict[str, Any] | None = None) -> str:
        explicit = str(event.get("source_session_id_hash") or "")
        if explicit:
            return explicit
        parent = str(
            event.get("parent_opportunity_id_hash")
            or (boundary or {}).get("parent_opportunity_id_hash")
            or ""
        )
        if parent and parent in indexed_parent_sessions:
            return indexed_parent_sessions[parent]
        packet_session = str(packet.get("source_session_id_hash") or "")
        if packet_session:
            return packet_session
        if history_index is not None:
            candidate_sessions = {indexed_parent_sessions.get(parent) for parent in indexed_packet_parents}
            candidate_sessions.discard(None)
            if len(candidate_sessions) == 1:
                return str(next(iter(candidate_sessions)))
            raise IncompleteIncidentHistory("cross-session event omitted source session provenance")
        return ""

    timestamp_bound = history_index is not None

    t1_ids = [str(value) for value in (answer.get("T1") or {}).get("evidence_ids") or []]
    boundary_ids = [value for value in t1_ids if value in boundary_by_id]
    if len(boundary_ids) != len(set(boundary_ids)):
        raise ValueError("human T1 repeats a compaction boundary")
    if not boundary_ids:
        raise IncompleteIncidentHistory("human T1 omitted a compaction boundary")
    boundary_sequence = max(int(boundary_by_id[value]["_sequence"]) for value in boundary_ids)
    boundary_orders = [
        _event_order(
            dict(boundary_by_id[value]["compaction_event"]),
            event_session(boundary_by_id[value]["compaction_event"], boundary=boundary_by_id[value]),
            value,
        )
        for value in boundary_ids
    ] if timestamp_bound else []

    t2_ids = [str(value) for value in (answer.get("T2") or {}).get("evidence_ids") or []]
    if len(t2_ids) != len(set(t2_ids)):
        raise ValueError("human T2 repeats evidence")
    unknown_t2 = [value for value in t2_ids if value not in source_by_id and value not in boundary_by_id]
    if unknown_t2:
        raise ValueError("human T2 cites evidence outside the source packet")
    t2_source_ids = [value for value in t2_ids if value in source_by_id]
    if not t2_source_ids:
        raise IncompleteIncidentHistory("human T2 omitted a source event cutoff")
    cutoff_sequence = max(int(source_by_id[value]["sequence"]) for value in t2_source_ids)
    cutoff_orders = [
        _event_order(source_by_id[value], event_session(source_by_id[value]), value)
        for value in t2_source_ids
    ] if timestamp_bound else []
    if timestamp_bound:
        if max(cutoff_orders) <= max(boundary_orders):
            raise IncompleteIncidentHistory("human T2 is not after the last T1 compaction")
    elif cutoff_sequence <= boundary_sequence:
        raise IncompleteIncidentHistory("human T2 is not after the last T1 compaction")

    for phase_name in ("T3", "T4", "T5"):
        for value in (answer.get(phase_name) or {}).get("evidence_ids") or []:
            evidence_id = str(value)
            if evidence_id in source_by_id:
                phase_sequence = int(source_by_id[evidence_id]["sequence"])
                phase_order = (
                    _event_order(source_by_id[evidence_id], event_session(source_by_id[evidence_id]), evidence_id)
                    if timestamp_bound else None
                )
            elif evidence_id in boundary_by_id:
                phase_sequence = int(boundary_by_id[evidence_id]["_sequence"])
                phase_order = (
                    _event_order(
                        boundary_by_id[evidence_id]["compaction_event"],
                        event_session(boundary_by_id[evidence_id]["compaction_event"], boundary=boundary_by_id[evidence_id]),
                        evidence_id,
                    ) if timestamp_bound else None
                )
            else:
                raise ValueError(f"human {phase_name} cites evidence outside the source packet")
            phase_before_cutoff = (
                phase_order <= max(cutoff_orders)
                if timestamp_bound
                else phase_sequence <= cutoff_sequence
            )
            if phase_before_cutoff:
                raise ValueError(f"human {phase_name} evidence is visible before its T2 cutoff")

    if history_index is None:
        history = _fallback_history(packet, cutoff_sequence)
        session_id = history["source_session_id_hash"]
        parent_ids = history["parent_opportunity_ids"]
        cutoff_order_mode = "sequence"
        full_prefix = [dict(row) for row in history["full_history_prefix"]]
        all_parents = list(parent_ids)
        history_session_ids = [session_id] if session_id else []
    else:
        parent_ids = _packet_parent_ids(packet, boundary_by_id)
        boundary_parents = {
            str(boundary_by_id[value].get("parent_opportunity_id_hash") or "")
            for value in boundary_ids
        }
        if "" in boundary_parents or not boundary_parents.issubset(set(parent_ids)):
            raise IncompleteIncidentHistory("human T1 boundary is outside the packet opportunity set")
        parent_sessions = history_index["parent_sessions"]
        parent_goals = history_index["parent_goals"]
        missing = [parent for parent in parent_ids if parent not in parent_sessions]
        if missing:
            raise IncompleteIncidentHistory("incident packet references an unknown trajectory opportunity")
        session_ids = {parent_sessions[parent] for parent in parent_ids}
        goal_ids = {parent_goals[parent] for parent in parent_ids}
        packet_goal = str(packet.get("goal_thread_id_hash") or "")
        packet_session = str(packet.get("source_session_id_hash") or "")
        t2_orders = [
            _event_order(source_by_id[value], event_session(source_by_id[value]), value)
            for value in t2_source_ids
        ]
        if not packet_goal or goal_ids != {packet_goal} or (packet_session and session_ids != {packet_session}):
            raise IncompleteIncidentHistory("incident packet crosses source Goal roots or has invalid session provenance")
        if packet_session and next(iter(session_ids)) != packet_session:
            raise IncompleteIncidentHistory("incident packet source session does not match its boundaries")
        if packet_session:
            session_id = packet_session
        else:
            latest_t2 = max(t2_orders)
            session_id = latest_t2[2]
        all_parents = list((history_index.get("goal_parents") or {}).get(packet_goal) or [])
        if not all_parents:
            raise IncompleteIncidentHistory("complete Goal-root history has no parent opportunities")
        cutoff_order_mode = "goal_timestamp"
        cutoff_order = max(t2_orders)
        history_rows: dict[tuple[str, str], dict[str, Any]] = {}
        canonical_by_source_id: dict[str, list[dict[str, Any]]] = {}
        complete = history_index["complete"]
        opportunities = history_index["opportunities"]
        session_metadata = history_index.get("session_metadata") or {}
        loaded_session_events: dict[str, dict[str, Any]] = {}
        parent_max_orders: dict[str, tuple[str, int, str, str]] = {}
        for parent in all_parents:
            source_session = parent_sessions[parent]
            event_map = complete.get(parent)
            if event_map is None and parent.startswith("session:"):
                if source_session not in loaded_session_events:
                    metadata = session_metadata.get(source_session)
                    if metadata is None:
                        raise IncompleteIncidentHistory("Goal-root session metadata is missing")
                    loaded_session_events[source_session] = _load_session_discovery_events(metadata)
                event_map = loaded_session_events[source_session]
            natural_window_events = [
                dict(raw) for raw in (event_map or {}).values()
                if isinstance(raw, dict) and str(raw.get("record_type")) != "compacted"
            ]
            opportunity = opportunities.get(parent)
            if opportunity is not None and isinstance(opportunity.get("compaction_event"), dict):
                natural_window_events.append(dict(opportunity["compaction_event"]))
            if natural_window_events:
                orders = [
                    _event_order(
                        row,
                        source_session,
                        str(row.get("evidence_id") or row.get("source_evidence_id") or ""),
                    )
                    for row in natural_window_events
                    if row.get("timestamp")
                ]
                if orders:
                    parent_max_orders[parent] = max(orders)
            for source_id, raw in (event_map or {}).items():
                if str(raw.get("record_type")) == "compacted":
                    continue
                event = dict(raw)
                event["sequence"] = _sequence(event)
                event["source_evidence_id"] = str(source_id)
                event["parent_opportunity_id_hash"] = parent
                event["source_session_id_hash"] = source_session
                local = local_by_parent_source.get((parent, str(source_id)))
                if local is not None:
                    event = {**event, **dict(local)}
                    event["sequence"] = _sequence(event)
                    event["source_evidence_id"] = str(source_id)
                    event["parent_opportunity_id_hash"] = parent
                    event["source_session_id_hash"] = source_session
                if _event_order(event, source_session, str(source_id)) > cutoff_order:
                    continue
                event["evidence_id"] = str(event.get("evidence_id") or _hash(
                    f"incident-history:{packet_goal}:{source_session}:{source_id}"
                ))
                comparable_event = {
                    key: value for key, value in event.items()
                    if key not in {
                        "evidence_id", "source_evidence_id", "parent_opportunity_id_hash",
                        "source_session_id_hash", "source_parent_opportunity_id_hashes",
                        "source_session_id_hashes",
                    }
                }
                merged = False
                for prior in canonical_by_source_id.get(str(source_id), []):
                    comparable_prior = {
                        key: value for key, value in prior.items()
                        if key not in {
                            "evidence_id", "source_evidence_id", "parent_opportunity_id_hash",
                            "source_session_id_hash", "source_parent_opportunity_id_hashes",
                            "source_session_id_hashes",
                        }
                    }
                    if comparable_prior == comparable_event:
                        prior.setdefault("source_session_id_hashes", [str(prior.get("source_session_id_hash") or "")])
                        if source_session not in prior["source_session_id_hashes"]:
                            prior["source_session_id_hashes"].append(source_session)
                        prior.setdefault("source_parent_opportunity_id_hashes", [str(prior.get("parent_opportunity_id_hash") or "")])
                        if parent not in prior["source_parent_opportunity_id_hashes"]:
                            prior["source_parent_opportunity_id_hashes"].append(parent)
                        merged = True
                        break
                if merged:
                    continue
                key = (source_session, str(source_id))
                if key in history_rows:
                    raise ValueError("Goal-root history repeats a conflicting source event")
                history_rows[key] = event
                canonical_by_source_id.setdefault(str(source_id), []).append(event)
            if opportunity is None:
                # A no-compaction session contributes ordinary source events
                # but has no compaction boundary to append.
                continue
            boundary_event = dict(opportunity["compaction_event"])
            boundary_id = str(opportunity["boundary_id_hash"])
            boundary_event["evidence_id"] = boundary_id
            boundary_event["record_type"] = "compacted"
            boundary_event["sequence"] = _sequence(boundary_event)
            boundary_event["source_session_id_hash"] = source_session
            boundary_event["parent_opportunity_id_hash"] = parent
            if _event_order(boundary_event, source_session, boundary_id) <= cutoff_order:
                prior = history_rows.get((source_session, boundary_id))
                if prior is not None and prior != boundary_event:
                    raise ValueError("Goal-root history repeats a conflicting compaction boundary")
                history_rows[(source_session, boundary_id)] = boundary_event
        full_prefix = list(history_rows.values())
        _sort_events(full_prefix)
        history_session_ids = sorted({str(row.get("source_session_id_hash") or "") for row in full_prefix if row.get("source_session_id_hash")})
        history = {
            "full_history_prefix": full_prefix,
            "source_session_id_hash": session_id,
            "parent_opportunity_ids": all_parents,
            "cutoff_order_mode": cutoff_order_mode,
            "cutoff_order": cutoff_order,
        }

    if not full_prefix:
        raise IncompleteIncidentHistory("constructed Goal-root history prefix is empty")
    if cutoff_order_mode == "sequence" and max(int(row["sequence"]) for row in full_prefix) > cutoff_sequence:
        raise ValueError("constructed history prefix crosses the T2 cutoff")
    if cutoff_order_mode == "goal_timestamp":
        cutoff_order = history["cutoff_order"]
        for row in full_prefix:
            row_session = str(row.get("source_session_id_hash") or session_id)
            if _event_order(row, row_session, str(row["evidence_id"])) > cutoff_order:
                raise ValueError("constructed Goal-root history prefix crosses the T2 cutoff")
    t1_boundary_rows = []
    for value in boundary_ids:
        boundary_row = dict(
            boundary_by_id[value]["compaction_event"],
            evidence_id=value,
            record_type="compacted",
        )
        boundary_parent = str(boundary_by_id[value].get("parent_opportunity_id_hash") or "")
        if boundary_parent and history_index is not None:
            boundary_row["source_session_id_hash"] = history_index["parent_sessions"].get(boundary_parent, session_id)
            boundary_row["parent_opportunity_id_hash"] = boundary_parent
        t1_boundary_rows.append(boundary_row)
    if cutoff_order_mode == "goal_timestamp":
        t1_boundary_rows.sort(key=lambda row: _event_order(
            row, str(row.get("source_session_id_hash") or session_id), str(row["evidence_id"])
        ))
        first_boundary_order = _event_order(
            t1_boundary_rows[0], str(t1_boundary_rows[0].get("source_session_id_hash") or session_id), str(t1_boundary_rows[0]["evidence_id"])
        )
        last_boundary_order = _event_order(
            t1_boundary_rows[-1], str(t1_boundary_rows[-1].get("source_session_id_hash") or session_id), str(t1_boundary_rows[-1]["evidence_id"])
        )
        previous_boundary_order = (
            _event_order(
                t1_boundary_rows[-2],
                str(t1_boundary_rows[-2].get("source_session_id_hash") or session_id),
                str(t1_boundary_rows[-2]["evidence_id"]),
            )
            if len(t1_boundary_rows) > 1
            else None
        )
    else:
        t1_boundary_rows.sort(key=lambda row: (int(row.get("sequence") or 0), str(row["evidence_id"])))
        first_boundary_order = (int(t1_boundary_rows[0].get("sequence") or 0),)
        last_boundary_order = (int(t1_boundary_rows[-1].get("sequence") or 0),)
        previous_boundary_order = (
            (int(t1_boundary_rows[-2].get("sequence") or 0),)
            if len(t1_boundary_rows) > 1
            else None
        )
    first_boundary_sequence = min(int(row.get("sequence") or 0) for row in t1_boundary_rows)
    if cutoff_order_mode == "goal_timestamp":
        safe_post = [
            dict(row) for row in full_prefix
            if _event_order(
                row, str(row.get("source_session_id_hash") or session_id), str(row["evidence_id"])
            ) > last_boundary_order
        ]
    else:
        safe_post = [
            dict(row) for row in full_prefix
            if int(row["sequence"]) > last_boundary_order[0]
        ]
    for row in t1_boundary_rows:
        if not any(str(existing.get("evidence_id")) == str(row["evidence_id"]) for existing in safe_post):
            safe_post.append(row)
    _sort_events(safe_post)
    if cutoff_order_mode == "goal_timestamp":
        pre = [
            dict(row) for row in full_prefix
            if _event_order(
                row, str(row.get("source_session_id_hash") or session_id), str(row["evidence_id"])
            ) < first_boundary_order
            and str(row.get("record_type")) != "compacted"
        ]
    else:
        pre = [
            dict(row) for row in full_prefix
            if int(row["sequence"]) < first_boundary_sequence
            and str(row.get("record_type")) != "compacted"
        ]
    t2_events = [source_by_id[value] for value in t2_source_ids]
    _sort_events(t2_events)
    candidate_action = "\n".join(str(row.get("content") or "") for row in t2_events).strip()
    if not candidate_action:
        raise IncompleteIncidentHistory("T2 source events contain no action text")
    cutoff_visible_sources = [
        dict(row) for row in full_prefix
        if str(row.get("record_type")) != "compacted"
        and str(row.get("evidence_id")) not in set(t2_source_ids)
        and (
            int(row.get("sequence") or 0) < cutoff_sequence
            if cutoff_order_mode == "sequence"
            else _event_order(
                row, str(row.get("source_session_id_hash") or session_id), str(row["evidence_id"])
            ) < history["cutoff_order"]
        )
    ]
    outcome_blind_findings: list[dict[str, Any]] = []
    if history_index is not None:
        # Cited IDs alone do not prove outcome blindness: forward Luna sees
        # events_until_next_compaction while generating a finding.  Admit a
        # finding only when the complete natural discovery unit that produced
        # it ended at or before this T2 cutoff.
        for finding in history_index.get("commitment_findings") or []:
            goal = str(finding.get("goal_thread_id_hash") or "")
            if goal and goal != str(packet.get("goal_thread_id_hash") or ""):
                continue
            parent = str(finding.get("parent_opportunity_id_hash") or "")
            parent_max = parent_max_orders.get(parent)
            if parent_max is None or parent_max > history["cutoff_order"]:
                continue
            directions = finding.get("discovery_directions")
            if not isinstance(directions, list) or set(map(str, directions)) != {"forward"}:
                # Backward discovery remains audit data, never detector state.
                continue
            outcome_blind_findings.append(finding)
    ledger = build_commitment_ledger(
        cutoff_visible_sources,
        goal_root_id=str(packet.get("goal_thread_id_hash") or ""),
        topic=str(packet.get("topic") or ""),
        id_prefix=str(packet.get("incident_case_id_hash") or "incident"),
        extracted_findings=outcome_blind_findings if history_index is not None else None,
    )
    ledger_event_ids = {
        event_id for row in ledger for event_id in row.get("source_event_ids") or []
    }
    ledger_source_events = [
        dict(row) for row in cutoff_visible_sources
        if str(row.get("evidence_id")) in ledger_event_ids
    ]
    _sort_events(ledger_source_events)
    return {
        "source_session_id_hash": history["source_session_id_hash"],
        "source_parent_opportunity_id_hashes": list(parent_ids),
        "history_parent_opportunity_id_hashes": list(all_parents),
        "history_session_id_hashes": history_session_ids,
        "cutoff_order_mode": cutoff_order_mode,
        "cutoff_order": (
            dict(history["cutoff_order"])
            if isinstance(history.get("cutoff_order"), dict)
            else _order_payload(history.get("cutoff_order", (cutoff_sequence,)))
        ),
        "full_history_prefix": full_prefix,
        "pre_compaction_events": pre,
        "safe_post_compaction_events": safe_post,
        "adjacent_previous_state_events": [
            dict(row) for row in full_prefix
            if (
                (
                    int(row.get("sequence") or 0) <= last_boundary_order[0]
                    and (previous_boundary_order is None or int(row.get("sequence") or 0) > previous_boundary_order[0])
                )
                if cutoff_order_mode == "sequence"
                else _event_order(
                    row, str(row.get("source_session_id_hash") or session_id), str(row["evidence_id"])
                ) <= last_boundary_order
                and (
                    previous_boundary_order is None
                    or _event_order(
                        row, str(row.get("source_session_id_hash") or session_id), str(row["evidence_id"])
                    ) > previous_boundary_order
                )
            )
        ],
        "adjacent_current_state_events": [
            dict(row) for row in full_prefix
            if (
                int(row.get("sequence") or 0) > last_boundary_order[0]
                if cutoff_order_mode == "sequence"
                else _event_order(
                    row, str(row.get("source_session_id_hash") or session_id), str(row["evidence_id"])
                ) > last_boundary_order
            )
        ],
        "t1_boundary_ids": boundary_ids,
        "first_boundary_id": t1_boundary_rows[0]["evidence_id"],
        "last_boundary_id": t1_boundary_rows[-1]["evidence_id"],
        "adjacent_previous_boundary_id": (
            t1_boundary_rows[-2]["evidence_id"] if len(t1_boundary_rows) > 1 else None
        ),
        "first_boundary_sequence": first_boundary_sequence,
        "last_boundary_sequence": boundary_sequence,
        "cutoff_sequence": cutoff_sequence,
        "t2_source_event_ids": t2_source_ids,
        "t2_source_events": t2_events,
        "candidate_action": candidate_action,
        "commitment_ledger": ledger,
        "commitment_ledger_source_events": ledger_source_events,
        "commitment_extraction_source": (
            "trajectory_union_findings_luna" if history_index is not None else "source_text_marker_fallback"
        ),
        "commitment_findings_sha256": (
            history_index.get("commitment_findings_sha256") if history_index is not None else None
        ),
        "future_information_excluded": True,
    }
