from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .review import _hash, _read_jsonl
from .incident_cutoff import (
    IncompleteIncidentHistory,
    build_incident_cutoff_context,
    build_incident_history_index,
)
from .semantic import (
    _claim_api_dispatch,
    _event_basis,
    _message_content,
    _omit_embedded_image_bytes,
    _responses_api_configuration,
    _responses_api_configuration_sha256,
    _run_responses_api_structured,
    _secure_write,
)


REPLAY_CONDITIONS = (
    "native",
    "goal_reinjection",
    "simple_checkpoint",
    "better_compaction",
    "coordy_structured_state",
)

# The incident experiment's frozen comparison is named explicitly after the
# implementation plan.  The legacy S0c runner above remains available for its
# older artifacts; incident packets use these five source-bound conditions.
INCIDENT_REPLAY_CONDITIONS = (
    "A_ADJACENT_STATE_DIFF",
    "B_RECURSIVE_STATE_SUMMARY",
    "C_COMMITMENT_LEDGER",
    "D_COMPLETE_HISTORY_PREFIX",
    "E_LEDGER_ACTION_CHECKPOINT",
)

INCIDENT_REPLAYABLE_CLASSIFICATIONS = {
    "CONFIRMED_COMPACTION_DRIFT",
    "PROBABLE_COMPACTION_DRIFT",
    "DRIFT_NEAR_MISS",
    "ORDINARY_REASONING_ERROR",
    "VALID_PLAN_UPDATE",
    "TOOL_FAILURE",
}
HUMAN_GROUND_TRUTH_STATUSES = {
    "HUMAN_ADJUDICATION_COMPLETE",
    "HUMAN_ADJUDICATION_TRIAGE_COMPLETE",
}

STATE_TYPES = (
    "goal",
    "constraint",
    "decision",
    "rejected_option",
    "plan",
    "dependency",
    "acceptance_criterion",
)

INCREMENTAL_STATE_INSTRUCTIONS = """You maintain task state incrementally. You see only the previous structured state and the next chronological event batch, never future actions or outcomes. Return the complete currently active state after applying explicit updates. Preserve an earlier item unless the new events explicitly supersede or satisfy it. Every item must cite original event evidence IDs. Do not infer state from anticipated failures."""

BETTER_COMPACTION_INSTRUCTIONS = """Create a compact but faithful active-task summary from only the chronological pre-compaction events. Preserve active goals, constraints, decisions, rejected options, plans, dependencies, and acceptance criteria. Every item must cite original event evidence IDs. Do not use future actions or outcomes."""

DETECTION_INSTRUCTIONS = """This is a pre-action task-state probe. Decide whether an important still-active goal, constraint, decision, or plan is missing or distorted in the post-compaction working context. Do not assume an error occurred later.

For coordy_structured_state, explicitly compare replacement_history and safe_post_compaction_events with coordy_incremental_state. If the structured state contains a still-active item that the post-compaction working context omits or contradicts, return MISSING_OR_DISTORTED and warn before action; explain the exact missing item and the safe next step. The fact that Coordy retained the item is evidence that enables detection, not a reason to call the post-compaction context PRESERVED.

A decision or phase gate marked satisfied can remain causally relevant: for example, an approval that authorizes the current implementation phase. Treat it as effective state until later evidence supersedes it. Do not replace a specific missing decision with a generic warning about the broader project goal.

For other conditions, judge the condition's supplied state on its own. Return PRESERVED only when the important state needed for the next action is actually present and consistent; PRESERVED must not warn. If evidence is insufficient, return UNCERTAIN and choose a safe next step. Cite only supplied evidence IDs."""

INCIDENT_ACTION_DETECTION_INSTRUCTIONS = """This is the E condition of an outcome-blinded pre-action replay. Compare the
concrete candidate action A_t with the source-linked active commitment ledger C_t.
Return ALERT only when one cited active authoritative commitment is concretely
violated, no authorized source event supersedes it, and the candidate action is
specific enough to execute. Omission is not conflict. Return NO_ALERT for a
consistent action and ABSTAIN when the source is insufficient. Use only the
cutoff-visible ledger and source events; never use human T0-T5 prose, later
corrections, tests, outcomes, or retrospective labels."""

SCORING_INSTRUCTIONS = """Score pre-action replay outputs against the supplied confirmed drift ground truth. This scoring step occurs after the blinded probes, so the ground truth is visible here. Copy warned_before_action exactly from each probe's would_warn_before_action field; it is an observed boolean, not a judgment you may reinterpret.

Use DETECTED only when the probe warned before the historical wrong action, identified the specific lost or distorted state (not merely a broad project goal), and grounded it in the expected pre-compaction evidence. Use MISSED when those detection requirements are not met. Use UNCERTAIN only when the probe text genuinely cannot be resolved.

Score the action signal separately. CORRECT means the proposed next step would not repeat or enlarge the historical mistake and is consistent with the effective decision; a cautious evidence check may be correct even when exact detection was missed. Do not call preserved state or a correct action a detection unless the explicit detection requirements above are met. Return exactly one score for every supplied condition and cite only supplied evidence IDs."""


def _state_schema(allowed_ids: list[str]) -> dict[str, Any]:
    item = {
        "type": "object",
        "additionalProperties": False,
        "required": ["state_type", "statement", "status", "evidence_ids"],
        "properties": {
            "state_type": {"type": "string", "enum": list(STATE_TYPES)},
            "statement": {"type": "string", "maxLength": 800},
            "status": {"type": "string", "enum": ["active", "satisfied", "superseded", "uncertain"]},
            "evidence_ids": {
                "type": "array",
                "minItems": 1,
                "items": {"type": "string", "enum": sorted(set(allowed_ids))},
            },
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["state_items"],
        "properties": {"state_items": {"type": "array", "items": item}},
    }


def _detector_schema(allowed_ids: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "state_status",
            "would_warn_before_action",
            "specific_state",
            "next_step",
            "evidence_ids",
            "confidence",
        ],
        "properties": {
            "state_status": {
                "type": "string",
                "enum": ["PRESERVED", "MISSING_OR_DISTORTED", "UNCERTAIN"],
            },
            "would_warn_before_action": {"type": "boolean"},
            "specific_state": {"type": "string", "maxLength": 1000},
            "next_step": {"type": "string", "maxLength": 1000},
            "evidence_ids": {
                "type": "array",
                "minItems": 1,
                "items": {"type": "string", "enum": sorted(set(allowed_ids))},
            },
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
    }


def _scoring_schema(
    allowed_ids: list[str], conditions: tuple[str, ...] | list[str] = REPLAY_CONDITIONS
) -> dict[str, Any]:
    score = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "condition",
            "detection_label",
            "exact_state_identified",
            "warned_before_action",
            "action_probe_label",
            "reason",
            "evidence_ids",
        ],
        "properties": {
            "condition": {"type": "string", "enum": list(conditions)},
            "detection_label": {
                "type": "string",
                "enum": ["DETECTED", "MISSED", "UNCERTAIN"],
            },
            "exact_state_identified": {"type": "boolean"},
            "warned_before_action": {"type": "boolean"},
            "action_probe_label": {
                "type": "string",
                "enum": ["CORRECT", "INCORRECT", "UNCERTAIN"],
            },
            "reason": {"type": "string", "maxLength": 1200},
            "evidence_ids": {
                "type": "array",
                "minItems": 1,
                "items": {"type": "string", "enum": sorted(set(allowed_ids))},
            },
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["scores"],
        "properties": {
            "scores": {
                "type": "array",
                "minItems": len(conditions),
                "maxItems": len(conditions),
                "items": score,
            }
        },
    }


class ResponsesAPIReplayModel:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        reasoning_effort: str,
        dispatch_log_dir: Path,
        timeout_seconds: int = 300,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.reasoning_effort = reasoning_effort
        self.dispatch_log_dir = dispatch_log_dir
        self.timeout_seconds = timeout_seconds

    def call(
        self,
        *,
        call_id: str,
        scan_run_id: str,
        instructions: str,
        payload: dict[str, Any],
        schema: dict[str, Any],
        schema_name: str,
    ) -> dict[str, Any]:
        protocol_version = f"s0c-{schema_name}-v1"
        configuration_sha256 = _responses_api_configuration_sha256(
            protocol_version=protocol_version,
            model=self.model,
            base_url=self.base_url,
            reasoning_effort=self.reasoning_effort,
            timeout_seconds=self.timeout_seconds,
            schema=schema,
            instructions=instructions,
        )
        packet = {
            "scan_run_id": scan_run_id,
            "opportunity_id_hash": _hash(call_id),
            "call_id": call_id,
            "payload": payload,
        }
        dispatch_path = _claim_api_dispatch(
            self.dispatch_log_dir,
            judge_id=f"responses-replay:{self.model}:{schema_name}",
            configuration_sha256=configuration_sha256,
            packet=packet,
            allow_http_504_retry=True,
            maximum_http_504_attempts=6,
        )
        result, metadata = _run_responses_api_structured(
            base_url=self.base_url,
            api_key=self.api_key,
            model=self.model,
            reasoning_effort=self.reasoning_effort,
            timeout_seconds=self.timeout_seconds,
            instructions=instructions,
            input_payload=packet,
            schema=schema,
            schema_name=schema_name,
            label=f"responses-replay:{self.model}:{schema_name}",
            dispatch_record_path=dispatch_path,
        )
        return {
            **result,
            **metadata,
            "judge_configuration": _responses_api_configuration(
                protocol_version=protocol_version,
                model=self.model,
                base_url=self.base_url,
                reasoning_effort=self.reasoning_effort,
                timeout_seconds=self.timeout_seconds,
                schema=schema,
                instructions=instructions,
            ),
            "judge_configuration_sha256": configuration_sha256,
        }


def _replacement_history(
    session: dict[str, Any], boundary_id_hash: str
) -> list[dict[str, Any]]:
    path = Path(str(session["source_path"]))
    remaining = int(session["scanned_bytes"])
    digest = hashlib.sha256()
    before = path.stat()
    events: list[dict[str, Any]] | None = None
    with path.open("rb") as handle:
        line_number = 0
        while remaining:
            raw_line = handle.readline()
            if not raw_line or len(raw_line) > remaining:
                raise RuntimeError("frozen replay source ended outside a JSONL record")
            remaining -= len(raw_line)
            digest.update(raw_line)
            line_number += 1
            row = json.loads(raw_line)
            if _hash(_event_basis(row, line_number)) != boundary_id_hash:
                continue
            payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
            history = payload.get("replacement_history")
            if not isinstance(history, list):
                raise RuntimeError("target compaction has no replacement_history")
            events = []
            for index, item in enumerate(history):
                if not isinstance(item, dict):
                    continue
                event = {
                    "evidence_id": _hash(f"{boundary_id_hash}:replacement:{index}"),
                    "role": item.get("role"),
                    "content": _message_content(item.get("content")),
                    "content_complete": True,
                }
                events.append(_omit_embedded_image_bytes(event))
    if events is None:
        raise RuntimeError("target compaction boundary was not found")
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise RuntimeError("source changed while replay context was read")
    if remaining or digest.hexdigest() != session["scanned_prefix_sha256"]:
        raise RuntimeError("replay source no longer matches the frozen scan")
    return events


def prepare_incident_detection_replay(
    workspace: Path,
    *,
    eligible_sessions_path: Path | None = None,
    commitment_findings_path: Path | None = None,
) -> dict[str, Any]:
    """Freeze an outcome-blinded, complete-prefix A--E incident replay.

    The causal answer is used only to select the T2 cutoff and to create a
    separate scoring label.  Detector-visible context is reconstructed from
    the hash-bound trajectory windows, never from human T0/T2 prose.
    """
    output = workspace / "data/screening"
    manifest_path = output / "trajectory_manifest.json"
    input_path = output / "incident_causal_inputs_v1.jsonl"
    ground_truth_path = output / "incident_causal_ground_truth_v1.jsonl"
    windows_path = output / "trajectory_windows.jsonl"
    if not manifest_path.is_file() or not input_path.is_file() or not ground_truth_path.is_file():
        raise RuntimeError("human causal ground truth is required before incident replay preparation")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    input_manifest = manifest.get("incident_causal_inputs_v1") or {}
    gt_manifest = manifest.get("incident_causal_ground_truth_v1") or {}
    input_sha256 = _hash(input_path.read_bytes())
    ground_truth_sha256 = _hash(ground_truth_path.read_bytes())
    ground_truth_status = gt_manifest.get("status")
    ground_truth_scope = str(gt_manifest.get("review_scope") or "").upper()
    ground_truth_queue_kind = str(gt_manifest.get("review_queue_kind") or "").upper()
    ground_truth_scope_valid = (
        ground_truth_status == "HUMAN_ADJUDICATION_COMPLETE"
        and ground_truth_scope == "FULL"
        and ground_truth_queue_kind == "FULL"
    ) or (
        ground_truth_status == "HUMAN_ADJUDICATION_TRIAGE_COMPLETE"
        and ground_truth_scope == "TRIAGED"
        and ground_truth_queue_kind == "TRIAGED"
    )
    if (
        input_manifest.get("status") != "READY_FOR_MACHINE_PRELABEL"
        or input_manifest.get("scan_run_id") != manifest.get("scan_run_id")
        or input_manifest.get("incident_causal_inputs_sha256") != input_sha256
        or ground_truth_status not in HUMAN_GROUND_TRUTH_STATUSES
        or not ground_truth_scope_valid
        or gt_manifest.get("ground_truth_sha256") != ground_truth_sha256
        or gt_manifest.get("review_context_sha256") != input_sha256
    ):
        raise RuntimeError("human causal ground truth is stale or not bound to causal inputs")
    packets = _read_jsonl(input_path)
    packet_by_case: dict[str, dict[str, Any]] = {}
    for packet in packets:
        case_id = str(packet.get("incident_case_id_hash") or "")
        if not case_id or case_id in packet_by_case:
            raise RuntimeError("incident causal inputs contain duplicate case identities")
        packet_by_case[case_id] = packet
    labels = _read_jsonl(ground_truth_path)
    label_keys: set[tuple[str, str]] = set()
    label_item_ids: set[str] = set()
    for label in labels:
        key = (str(label.get("incident_case_id_hash")), str(label.get("episode_key")))
        item_id = str(label.get("review_item_id") or "")
        if key in label_keys:
            raise RuntimeError("human causal ground truth contains duplicate episode identities")
        if item_id and item_id in label_item_ids:
            raise RuntimeError("human causal ground truth contains duplicate review item IDs")
        label_keys.add(key)
        if item_id:
            label_item_ids.add(item_id)
    if not labels:
        raise RuntimeError("human causal ground truth contains no reviewed episodes")

    history_index: dict[str, Any] | None = None
    if windows_path.is_file():
        expected_windows_sha256 = input_manifest.get("source_trajectory_windows_sha256")
        if not isinstance(expected_windows_sha256, str) or expected_windows_sha256 != _hash(windows_path.read_bytes()):
            raise RuntimeError("trajectory windows are stale or not bound to causal inputs")
        history_index = build_incident_history_index(
            windows_path,
            eligible_sessions_path=eligible_sessions_path,
            commitment_findings_path=commitment_findings_path,
        )

    cases: list[dict[str, Any]] = []
    replay_labels: list[dict[str, Any]] = []
    skipped: dict[str, Any] = {}
    excluded_non_replayable: dict[str, int] = {}
    replayable = {
        "CONFIRMED_COMPACTION_DRIFT", "PROBABLE_COMPACTION_DRIFT", "DRIFT_NEAR_MISS",
        "ORDINARY_REASONING_ERROR", "VALID_PLAN_UPDATE", "TOOL_FAILURE",
    }
    for label in labels:
        answer = label.get("human_answer")
        classification = str((answer or {}).get("classification") or "")
        if classification not in replayable:
            excluded_non_replayable[classification or "MISSING_CLASSIFICATION"] = (
                excluded_non_replayable.get(classification or "MISSING_CLASSIFICATION", 0) + 1
            )
            continue
        case_id = str(label.get("incident_case_id_hash") or "")
        packet = packet_by_case.get(case_id)
        if packet is None or not isinstance(answer, dict):
            raise RuntimeError("human causal ground truth references an unknown input case")
        try:
            context = build_incident_cutoff_context(packet, answer, history_index=history_index)
        except IncompleteIncidentHistory as exc:
            skipped["incomplete_history_prefix"] = skipped.get("incomplete_history_prefix", 0) + 1
            skipped.setdefault("incomplete_history_reasons", []).append(str(exc))
            continue
        incident_id = str(label.get("review_item_id") or _hash(f"{case_id}:{label.get('episode_key')}"))
        cases.append({
            "stage": "S0c_PRE_ACTION_DETECTION_REPLAY",
            "source_protocol_version": "incident-causal-ground-truth-v1",
            "conditions": list(INCIDENT_REPLAY_CONDITIONS),
            "scan_run_id": packet["scan_run_id"],
            "incident_id": incident_id,
            "representative_opportunity_id_hash": case_id,
            "duplicate_observation_count": 1,
            "goal_thread_id_hash": packet.get("goal_thread_id_hash"),
            "source_session_id_hash": context["source_session_id_hash"],
            "source_parent_opportunity_id_hashes": context["source_parent_opportunity_id_hashes"],
            "cutoff": {
                "after_compaction_boundary_id_hashes": context["t1_boundary_ids"],
                "before_first_wrong_judgment_evidence_ids": list(
                    (answer.get("T2") or {}).get("evidence_ids") or []
                ),
                "cutoff_sequence": context["cutoff_sequence"],
                "cutoff_order_mode": context["cutoff_order_mode"],
                "cutoff_order": context["cutoff_order"],
            },
            "full_history_prefix": context["full_history_prefix"],
            "adjacent_state_diff": {
                "previous_state_events": context["adjacent_previous_state_events"],
                "current_state_events": context["adjacent_current_state_events"],
            },
            "safe_post_compaction_events": context["safe_post_compaction_events"],
            "commitment_ledger": context["commitment_ledger"],
            "structured_state_incremental_events": context["full_history_prefix"],
            "action_checkpoint": {
                "candidate_action": context["candidate_action"],
                "candidate_action_event_ids": context["t2_source_event_ids"],
                "commitments": context["commitment_ledger"],
                "candidate_action_events": context["t2_source_events"],
                "visible_events": context["full_history_prefix"],
            },
            "future_information_excluded": True,
            "excluded_sections": [
                "T0_T5_human_summaries", "T3", "T4", "T5",
                "retrospective_classification", "ground_truth_verdict",
            ],
        })
        replay_labels.append({
            "incident_id": incident_id,
            "incident_case_id_hash": case_id,
            "episode_key": label.get("episode_key"),
            "classification": classification,
            "human_answer": answer,
            "expected_pre_evidence_ids": list((answer.get("T0") or {}).get("evidence_ids") or []),
            "forbidden_future_event_ids": sorted({
                str(value) for phase_name in ("T3", "T4", "T5")
                for value in (answer.get(phase_name) or {}).get("evidence_ids") or []
            }),
            "ground_truth": True,
        })
    cases.sort(key=lambda row: str(row["incident_id"]))
    replay_labels.sort(key=lambda row: str(row["incident_id"]))
    source_content = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in cases)
    label_content = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in replay_labels)
    source_path = output / "s0c_detection_replay_sources.jsonl"
    labels_path = output / "s0c_incident_replay_labels.jsonl"
    _secure_write(source_path, source_content)
    _secure_write(labels_path, label_content)
    result = {
        "stage": "S0c_PRE_ACTION_DETECTION_REPLAY",
        "status": (
            "INCOMPLETE_CONTEXT_CONSTRUCTION" if skipped
            else "NO_REPLAYABLE_CASES" if not cases
            else "PENDING_CONTEXT_CONSTRUCTION"
        ),
        "source_protocol_version": "incident-causal-ground-truth-v1",
        "scan_run_id": manifest["scan_run_id"],
        "human_ground_truth_sha256": ground_truth_sha256,
        "human_ground_truth_scope": ground_truth_scope,
        "human_ground_truth_label_count": len(labels),
        "eligible_sessions_sha256": history_index.get("eligible_sessions_sha256") if history_index else None,
        "commitment_findings_sha256": history_index.get("commitment_findings_sha256") if history_index else None,
        "replay_case_count": len(cases),
        "replay_sources_sha256": _hash(source_content),
        "replay_labels_sha256": _hash(label_content),
        "replayable_classifications": sorted(replayable),
        "excluded_non_replayable_classifications": excluded_non_replayable,
        "skipped_counts": skipped,
        "skipped_case_count": sum(
            int(value) for value in skipped.values() if isinstance(value, int)
        ),
        "conditions": list(INCIDENT_REPLAY_CONDITIONS),
        "state_diff_is_detector": True,
        "future_information_excluded": True,
        "complete_history_prefix_required": True,
    }
    _secure_write(output / "s0c_detection_replay_manifest.json", json.dumps(result, indent=2, sort_keys=True) + "\n")
    return result


def prepare_detection_replay(workspace: Path, evidence_audit_path: Path) -> dict[str, Any]:
    output = workspace / "data/screening"
    causal_path = output / "s0b_causal_inputs.jsonl"
    sessions_path = output / "eligible_sessions.jsonl"
    if not causal_path.is_file() or not sessions_path.is_file():
        raise RuntimeError("missing frozen causal inputs or eligible sessions")
    packets = _read_jsonl(causal_path)
    packet_by_id = {str(row["opportunity_id_hash"]): row for row in packets}
    labels = json.loads(evidence_audit_path.read_text(encoding="utf-8"))
    if not isinstance(labels, list) or {str(row.get("opportunity_id_hash")) for row in labels} != set(packet_by_id):
        raise RuntimeError("evidence audit must classify every causal opportunity exactly once")
    if any(row.get("evidence_audit_label") not in {"CONFIRMED", "NEGATIVE", "UNCERTAIN"} for row in labels):
        raise RuntimeError("evidence audit contains an invalid classification")
    confirmed = [row for row in labels if row["evidence_audit_label"] == "CONFIRMED"]
    clusters: dict[str, list[dict[str, Any]]] = {}
    for row in confirmed:
        incident = row.get("distinct_incident_id")
        if not isinstance(incident, str) or not incident:
            raise RuntimeError("each confirmed observation requires a distinct incident ID")
        for key in (
            "first_wrong_judgment_evidence_id",
            "first_wrong_action_evidence_id",
            "expected_lost_state",
            "expected_pre_evidence_ids",
        ):
            if not row.get(key):
                raise RuntimeError(f"confirmed observation is missing {key}")
        clusters.setdefault(incident, []).append(row)

    sessions = _read_jsonl(sessions_path)
    session_by_hash = {_hash(str(row["session_id"])): row for row in sessions}
    cases = []
    for incident_id, observations in sorted(clusters.items()):
        representative = max(
            observations,
            key=lambda row: (
                len(packet_by_id[str(row["opportunity_id_hash"])]["pre_compaction_events"]),
                str(row["opportunity_id_hash"]),
            ),
        )
        packet = packet_by_id[str(representative["opportunity_id_hash"])]
        wrong_id = str(representative["first_wrong_judgment_evidence_id"])
        post = packet["post_compaction_plan_events"]
        wrong_index = next(
            (index for index, event in enumerate(post) if event["evidence_id"] == wrong_id),
            None,
        )
        if wrong_index is None:
            raise RuntimeError("first wrong judgment is not in the bound post-compaction window")
        session = session_by_hash.get(str(packet["session_id_hash"]))
        if session is None:
            raise RuntimeError("confirmed replay case has no frozen source session")
        native_context = _replacement_history(
            session, str(packet["cutoff"]["boundary_id_hash"])
        )
        safe_post = packet["post_compaction_plan_events"][:wrong_index]
        pre = packet["pre_compaction_events"]
        user_goals = [row for row in native_context if row.get("role") == "user"]
        case = {
            "stage": "S0c_PRE_ACTION_DETECTION_REPLAY",
            "scan_run_id": packet["scan_run_id"],
            "incident_id": incident_id,
            "representative_opportunity_id_hash": packet["opportunity_id_hash"],
            "duplicate_observation_count": len(observations),
            "goal_thread_id_hash": packet.get("goal_thread_id_hash"),
            "cutoff": {
                "after_compaction_boundary_id_hash": packet["cutoff"]["boundary_id_hash"],
                "before_first_wrong_judgment_evidence_id": wrong_id,
                "before_first_wrong_action_evidence_id": representative["first_wrong_action_evidence_id"],
            },
            "expected_lost_state": representative["expected_lost_state"],
            "expected_pre_evidence_ids": representative["expected_pre_evidence_ids"],
            "native_context": native_context,
            "safe_post_compaction_events": safe_post,
            "goal_reinjection": user_goals[:1],
            "simple_checkpoint": pre[-8:],
            "better_compaction_source_events": pre,
            "structured_state_incremental_events": pre,
            "future_information_excluded": True,
            "excluded_sections": [
                "first_wrong_judgment",
                "action_events",
                "verified_engineering_outcomes",
                "user_followup_events",
            ],
            "conditions": list(REPLAY_CONDITIONS),
        }
        cases.append(case)

    content = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in cases)
    cases_path = output / "s0c_detection_replay_sources.jsonl"
    _secure_write(cases_path, content)
    result = {
        "stage": "S0c_PRE_ACTION_DETECTION_REPLAY",
        "status": "PENDING_CONTEXT_CONSTRUCTION",
        "scan_run_id": packets[0]["scan_run_id"] if packets else None,
        "classified_observation_count": len(labels),
        "confirmed_observation_count": len(confirmed),
        "distinct_confirmed_incident_count": len(cases),
        "replay_case_count": len(cases),
        "evidence_audit_sha256": _hash(evidence_audit_path.read_bytes()),
        "causal_inputs_sha256": _hash(causal_path.read_bytes()),
        "replay_sources_sha256": _hash(content),
        "conditions": list(REPLAY_CONDITIONS),
        "state_diff_is_detector": False,
        "future_information_excluded": True,
    }
    _secure_write(
        output / "s0c_detection_replay_manifest.json",
        json.dumps(result, indent=2, sort_keys=True) + "\n",
    )
    return result


def prepare_healthy_detection_replay(
    source_workspace: Path,
    workspace: Path,
    evidence_audit_path: Path,
    *,
    healthy_count: int = 3,
) -> dict[str, Any]:
    if healthy_count <= 0:
        raise ValueError("healthy replay count must be positive")
    source_output = source_workspace / "data/screening"
    causal_path = source_output / "s0b_causal_inputs.jsonl"
    sessions_path = source_output / "eligible_sessions.jsonl"
    if not causal_path.is_file() or not sessions_path.is_file():
        raise RuntimeError("missing frozen causal inputs or eligible sessions")
    packets = _read_jsonl(causal_path)
    packet_by_id = {str(row["opportunity_id_hash"]): row for row in packets}
    labels = json.loads(evidence_audit_path.read_text(encoding="utf-8"))
    if not isinstance(labels, list) or {
        str(row.get("opportunity_id_hash")) for row in labels
    } != set(packet_by_id):
        raise RuntimeError("evidence audit must classify every causal opportunity exactly once")

    negative_by_root: dict[str, list[dict[str, Any]]] = {}
    for label in labels:
        if label.get("evidence_audit_label") != "NEGATIVE":
            continue
        packet = packet_by_id[str(label["opportunity_id_hash"])]
        root = str(packet.get("goal_thread_id_hash") or "")
        if root:
            negative_by_root.setdefault(root, []).append(packet)
    selected = []
    for root in sorted(negative_by_root):
        candidates = negative_by_root[root]
        selected.append(max(candidates, key=lambda row: (
            len(row.get("pre_compaction_events", [])),
            len(row.get("post_compaction_plan_events", [])),
            str(row["opportunity_id_hash"]),
        )))
        if len(selected) == healthy_count:
            break
    if len(selected) != healthy_count:
        raise RuntimeError("not enough distinct Goal roots for the healthy replay quota")

    sessions = _read_jsonl(sessions_path)
    session_by_hash = {_hash(str(row["session_id"])): row for row in sessions}
    cases = []
    for packet in selected:
        session = session_by_hash.get(str(packet["session_id_hash"]))
        if session is None:
            raise RuntimeError("healthy replay case has no frozen source session")
        native_context = _replacement_history(
            session, str(packet["cutoff"]["boundary_id_hash"])
        )
        pre = packet["pre_compaction_events"]
        post = packet["post_compaction_plan_events"]
        opportunity = str(packet["opportunity_id_hash"])
        cases.append({
            "stage": "S0c_PRE_ACTION_DETECTION_REPLAY",
            "case_kind": "HEALTHY_NEGATIVE",
            "scan_run_id": packet["scan_run_id"],
            "incident_id": f"healthy-{opportunity[:12]}",
            "representative_opportunity_id_hash": opportunity,
            "duplicate_observation_count": 1,
            "goal_thread_id_hash": packet.get("goal_thread_id_hash"),
            "cutoff": {
                "after_compaction_boundary_id_hash": packet["cutoff"]["boundary_id_hash"],
                "before_first_wrong_judgment_evidence_id": None,
                "before_first_wrong_action_evidence_id": None,
            },
            "expected_lost_state": None,
            "expected_pre_evidence_ids": [],
            "native_context": native_context,
            "safe_post_compaction_events": post,
            "goal_reinjection": [
                row for row in native_context if row.get("role") == "user"
            ][:1],
            "simple_checkpoint": pre[-8:],
            "better_compaction_source_events": pre,
            "structured_state_incremental_events": pre,
            "future_information_excluded": True,
            "excluded_sections": [
                "action_events",
                "verified_engineering_outcomes",
                "user_followup_events",
            ],
            "conditions": list(REPLAY_CONDITIONS),
        })

    content = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in cases)
    output = workspace / "data/screening"
    output.mkdir(parents=True, exist_ok=True)
    cases_path = output / "s0c_detection_replay_sources.jsonl"
    _secure_write(cases_path, content)
    result = {
        "stage": "S0c_PRE_ACTION_DETECTION_REPLAY",
        "status": "PENDING_CONTEXT_CONSTRUCTION",
        "case_kind": "HEALTHY_NEGATIVE",
        "scan_run_id": packets[0]["scan_run_id"] if packets else None,
        "replay_case_count": len(cases),
        "healthy_case_count": len(cases),
        "distinct_goal_root_count": len({row["goal_thread_id_hash"] for row in cases}),
        "evidence_audit_sha256": _hash(evidence_audit_path.read_bytes()),
        "causal_inputs_sha256": _hash(causal_path.read_bytes()),
        "replay_sources_sha256": _hash(content),
        "conditions": list(REPLAY_CONDITIONS),
        "state_diff_is_detector": False,
        "future_information_excluded": True,
    }
    _secure_write(
        output / "s0c_detection_replay_manifest.json",
        json.dumps(result, indent=2, sort_keys=True) + "\n",
    )
    return result


def _evidence_ids(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        evidence_id = value.get("evidence_id")
        if isinstance(evidence_id, str):
            found.add(evidence_id)
        for key, item in value.items():
            if key in {"evidence_ids", "source_event_ids", "candidate_action_event_ids"} and isinstance(item, list):
                found.update(str(entry) for entry in item if isinstance(entry, str))
            else:
                found.update(_evidence_ids(item))
    elif isinstance(value, list):
        for item in value:
            found.update(_evidence_ids(item))
    return found


def _validate_unique_bound_evidence(rows: list[dict[str, Any]], allowed: set[str]) -> None:
    for row in rows:
        evidence = row.get("evidence_ids")
        if (
            not isinstance(evidence, list)
            or not evidence
            or len(evidence) != len(set(evidence))
            or not set(evidence).issubset(allowed)
        ):
            raise ValueError("replay output requires unique, bound evidence IDs")


def run_incident_detection_replay(
    workspace: Path,
    model: ResponsesAPIReplayModel,
    *,
    incremental_batch_size: int = 8,
) -> dict[str, Any]:
    """Run the five incident A--E probes using source-only cutoff packets."""
    if incremental_batch_size <= 0:
        raise ValueError("incremental batch size must be positive")
    output = workspace / "data/screening"
    source_path = output / "s0c_detection_replay_sources.jsonl"
    manifest_path = output / "s0c_detection_replay_manifest.json"
    if not source_path.is_file() or not manifest_path.is_file():
        raise RuntimeError("missing prepared incident replay sources")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("source_protocol_version") != "incident-causal-ground-truth-v1":
        raise RuntimeError("incident replay runner requires human-bound incident sources")
    if manifest.get("status") != "PENDING_CONTEXT_CONSTRUCTION":
        raise RuntimeError("incident replay sources are incomplete; skipped cases must be resolved before running")
    cases = _read_jsonl(source_path)
    conditions = tuple(str(value) for value in manifest.get("conditions") or INCIDENT_REPLAY_CONDITIONS)
    if conditions != INCIDENT_REPLAY_CONDITIONS:
        raise RuntimeError("incident replay conditions are not the frozen A-E protocol")
    if (
        manifest.get("replay_sources_sha256") != _hash(source_path.read_bytes())
        or manifest.get("replay_case_count") != len(cases)
        or any(case.get("future_information_excluded") is not True for case in cases)
    ):
        raise RuntimeError("incident replay sources are stale or not outcome-blinded")
    checkpoint_path = output / "s0c_incident_replay_checkpoint.json"
    checkpoint_key = {
        "replay_sources_sha256": manifest["replay_sources_sha256"],
        "model": model.model,
        "reasoning_effort": model.reasoning_effort,
        "incremental_batch_size": incremental_batch_size,
    }
    checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8")) if checkpoint_path.is_file() else {
        **checkpoint_key, "states": {}, "probes": {},
    }
    if any(checkpoint.get(key) != value for key, value in checkpoint_key.items()):
        raise RuntimeError("incident replay checkpoint does not match this run")

    def save() -> None:
        _secure_write(checkpoint_path, json.dumps(checkpoint, ensure_ascii=False, indent=2, sort_keys=True) + "\n")

    def call_cached(kind: str, key: str, payload: dict[str, Any], schema: dict[str, Any], instructions: str) -> dict[str, Any]:
        bucket = checkpoint[kind]
        input_sha256 = _hash(json.dumps({
            "payload": payload,
            "instructions": instructions,
            "schema": schema,
        }, ensure_ascii=False, sort_keys=True))
        saved = bucket.get(key)
        if saved is not None:
            if saved.get("input_sha256") != input_sha256:
                raise RuntimeError("incident replay checkpoint input changed")
            return saved["result"]
        result = model.call(
            call_id=f"incident:{key}",
            scan_run_id=str(payload["scan_run_id"]),
            instructions=instructions,
            payload=payload,
            schema=schema,
            schema_name=f"incident_{kind}",
        )
        bucket[key] = {"input_sha256": input_sha256, "result": result}
        save()
        return result

    constructions: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    for case in cases:
        incident = str(case["incident_id"])
        scan_run_id = str(case["scan_run_id"])
        full_prefix = list(case["full_history_prefix"])
        safe_post = list(case["safe_post_compaction_events"])
        adjacent_state_diff = dict(case["adjacent_state_diff"])
        ledger = list(case["commitment_ledger"])
        action_checkpoint = dict(case["action_checkpoint"])
        # B is the only condition that maintains state incrementally.  The
        # previous state is never recomputed from a complete cutoff snapshot.
        current_state: list[dict[str, Any]] = []
        seen_ids: list[str] = []
        state_steps: list[dict[str, Any]] = []
        for start in range(0, len(full_prefix), incremental_batch_size):
            batch = full_prefix[start:start + incremental_batch_size]
            seen_ids.extend(str(row["evidence_id"]) for row in batch)
            batch_index = start // incremental_batch_size
            payload = {"scan_run_id": scan_run_id, "previous_state": current_state, "new_events": batch}
            state = call_cached(
                "states", f"{incident}:{batch_index}", payload,
                _state_schema(seen_ids), INCREMENTAL_STATE_INSTRUCTIONS,
            )
            current_state = list(state.get("state_items") or [])
            _validate_unique_bound_evidence(current_state, set(seen_ids))
            state_steps.append({"batch_index": batch_index, "state_items": current_state})
        context_by_condition = {
            "A_ADJACENT_STATE_DIFF": {
                "adjacent_state_diff": adjacent_state_diff,
            },
            "B_RECURSIVE_STATE_SUMMARY": {
                "incremental_state": current_state,
                "post_compaction_events_through_cutoff": safe_post,
            },
            "C_COMMITMENT_LEDGER": {
                "commitment_ledger": ledger,
                "post_compaction_events_through_cutoff": safe_post,
            },
            "D_COMPLETE_HISTORY_PREFIX": {
                "complete_history_prefix_through_cutoff": full_prefix,
            },
            "E_LEDGER_ACTION_CHECKPOINT": {
                "commitment_ledger": ledger,
                "action_checkpoint": action_checkpoint,
            },
        }
        for condition in conditions:
            visible = context_by_condition[condition]
            allowed_ids = sorted(_evidence_ids(visible))
            payload = {"scan_run_id": scan_run_id, "condition": condition, "visible_state": visible}
            if condition == "E_LEDGER_ACTION_CHECKPOINT":
                from .action import action_check_schema, validate_action_check

                action_packet = {
                    "case_id": incident,
                    "commitments": list(action_checkpoint.get("commitments") or ledger),
                    "visible_events": [
                        {"event_id": str(row["evidence_id"]), **dict(row)}
                        for row in action_checkpoint.get("visible_events") or []
                    ],
                }
                action_result = call_cached(
                    "probes", f"{incident}:{condition}", payload,
                    action_check_schema(action_packet), INCIDENT_ACTION_DETECTION_INSTRUCTIONS,
                )
                action_items = action_result.get("results")
                if not isinstance(action_items, list) or len(action_items) != 1 or not isinstance(action_items[0], dict):
                    raise ValueError("incident action detector omitted its singleton result")
                action = action_items[0]
                validate_action_check(action_packet, action)
                decision = str(action["decision"])
                detector = {
                    "state_status": (
                        "MISSING_OR_DISTORTED" if decision == "ALERT"
                        else "UNCERTAIN" if decision == "ABSTAIN" else "PRESERVED"
                    ),
                    "would_warn_before_action": decision != "NO_ALERT",
                    "specific_state": str(action.get("action") or action.get("reason") or ""),
                    "next_step": str(action.get("reason") or ""),
                    "evidence_ids": list(action.get("source_event_ids") or []),
                    "confidence": action.get("confidence"),
                    "action_decision": decision,
                    "conflicting_commitment_ids": list(action.get("conflicting_commitment_ids") or []),
                    "action_reason": action.get("reason"),
                }
            else:
                detector_instructions = DETECTION_INSTRUCTIONS
                if condition == "A_ADJACENT_STATE_DIFF":
                    detector_instructions += (
                        "\nFor A, compare only the supplied previous_state_events and current_state_events. "
                        "Treat them as W_(t-1) and W_t; do not substitute the complete history prefix or "
                        "a retrospective T0-T5 summary."
                    )
                detector = call_cached(
                    "probes", f"{incident}:{condition}", payload,
                    _detector_schema(allowed_ids), detector_instructions,
                )
                _validate_unique_bound_evidence([detector], set(allowed_ids))
                if detector["state_status"] == "PRESERVED" and detector["would_warn_before_action"] is not False:
                    raise ValueError("a preserved incident state cannot also warn about drift")
                if detector["state_status"] == "MISSING_OR_DISTORTED" and detector["would_warn_before_action"] is not True:
                    raise ValueError("a missing incident state must warn before action")
            results.append({
                "scan_run_id": scan_run_id,
                "incident_id": incident,
                "condition": condition,
                "cutoff": case["cutoff"],
                "state_status": detector["state_status"],
                "would_warn_before_action": detector["would_warn_before_action"],
                "specific_state": detector["specific_state"],
                "next_step": detector["next_step"],
                "evidence_ids": detector["evidence_ids"],
                "confidence": detector["confidence"],
                "action_decision": detector.get("action_decision"),
                "conflicting_commitment_ids": detector.get("conflicting_commitment_ids"),
                "action_reason": detector.get("action_reason"),
                "api_usage": detector.get("api_usage"),
                "api_request_id": detector.get("api_request_id"),
                "api_response_id": detector.get("api_response_id"),
                "future_information_excluded": True,
            })
        constructions.append({
            "scan_run_id": scan_run_id,
            "incident_id": incident,
            "incremental_state_steps": state_steps,
            "final_incremental_state": current_state,
            "future_information_excluded": True,
        })
    construction_content = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in constructions)
    result_content = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in results)
    _secure_write(output / "s0c_context_constructions.jsonl", construction_content)
    _secure_write(output / "s0c_detection_results.jsonl", result_content)
    final = {
        **manifest,
        "status": "PENDING_DETECTION_SCORING",
        "context_constructions_sha256": _hash(construction_content),
        "detection_results_sha256": _hash(result_content),
        "detection_result_count": len(results),
        "expected_detection_result_count": len(cases) * len(conditions),
        "model": model.model,
        "reasoning_effort": model.reasoning_effort,
    }
    _secure_write(manifest_path, json.dumps(final, indent=2, sort_keys=True) + "\n")
    return final


def run_detection_replay(
    workspace: Path,
    model: ResponsesAPIReplayModel,
    *,
    incremental_batch_size: int = 8,
) -> dict[str, Any]:
    if incremental_batch_size <= 0:
        raise ValueError("incremental batch size must be positive")
    output = workspace / "data/screening"
    source_path = output / "s0c_detection_replay_sources.jsonl"
    manifest_path = output / "s0c_detection_replay_manifest.json"
    if not source_path.is_file() or not manifest_path.is_file():
        raise RuntimeError("missing prepared S0c replay sources")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("source_protocol_version") == "incident-causal-ground-truth-v1":
        return run_incident_detection_replay(
            workspace, model, incremental_batch_size=incremental_batch_size
        )
    cases = _read_jsonl(source_path)
    if (
        manifest.get("replay_sources_sha256") != _hash(source_path.read_bytes())
        or manifest.get(
            "replay_case_count", manifest.get("distinct_confirmed_incident_count")
        ) != len(cases)
        or any(case.get("future_information_excluded") is not True for case in cases)
    ):
        raise RuntimeError("S0c replay sources are stale or not outcome-blinded")

    checkpoint_path = output / "s0c_replay_checkpoint.json"
    checkpoint_key = {
        "replay_sources_sha256": manifest["replay_sources_sha256"],
        "model": model.model,
        "reasoning_effort": model.reasoning_effort,
        "incremental_batch_size": incremental_batch_size,
    }
    instruction_hashes = {
        "incremental_instructions_sha256": _hash(INCREMENTAL_STATE_INSTRUCTIONS),
        "better_compaction_instructions_sha256": _hash(BETTER_COMPACTION_INSTRUCTIONS),
        "detector_instructions_sha256": _hash(DETECTION_INSTRUCTIONS),
    }
    if checkpoint_path.is_file():
        checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
        if any(checkpoint.get(key) != value for key, value in checkpoint_key.items()):
            raise RuntimeError("S0c replay checkpoint does not match this run")
        if (
            checkpoint.get("incremental_instructions_sha256") not in {
                None, instruction_hashes["incremental_instructions_sha256"]
            }
            and checkpoint.get("incremental_steps")
        ):
            raise RuntimeError("S0c incremental-state instructions changed")
        if (
            checkpoint.get("better_compaction_instructions_sha256") not in {
                None, instruction_hashes["better_compaction_instructions_sha256"]
            }
            and checkpoint.get("better_compaction")
        ):
            raise RuntimeError("S0c Better Compaction instructions changed")
        if (
            checkpoint.get("detector_instructions_sha256")
            != instruction_hashes["detector_instructions_sha256"]
        ):
            checkpoint["detectors"] = {}
        checkpoint.update(instruction_hashes)
    else:
        checkpoint = {
            **checkpoint_key,
            **instruction_hashes,
            "incremental_steps": {},
            "better_compaction": {},
            "detectors": {},
        }

    def save_checkpoint() -> None:
        _secure_write(
            checkpoint_path,
            json.dumps(checkpoint, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        )

    constructions = []
    results = []
    for case in cases:
        incident = str(case["incident_id"])
        scan_run_id = str(case["scan_run_id"])
        events = list(case["structured_state_incremental_events"])
        current_state: list[dict[str, Any]] = []
        seen_ids: list[str] = []
        steps = []
        for start in range(0, len(events), incremental_batch_size):
            batch = events[start:start + incremental_batch_size]
            seen_ids.extend(str(row["evidence_id"]) for row in batch)
            batch_index = start // incremental_batch_size
            step_key = f"{incident}:{batch_index}"
            step_payload = {"previous_state": current_state, "new_events": batch}
            input_sha256 = _hash(json.dumps(step_payload, sort_keys=True))
            saved_step = checkpoint["incremental_steps"].get(step_key)
            if saved_step is not None:
                if saved_step.get("input_sha256") != input_sha256:
                    raise RuntimeError("S0c incremental checkpoint input changed")
                state_result = saved_step["result"]
            else:
                state_result = model.call(
                    call_id=f"{incident}:structured-state:{batch_index}",
                    scan_run_id=scan_run_id,
                    instructions=INCREMENTAL_STATE_INSTRUCTIONS,
                    payload=step_payload,
                    schema=_state_schema(seen_ids),
                    schema_name="coordy_incremental_state",
                )
                checkpoint["incremental_steps"][step_key] = {
                    "input_sha256": input_sha256,
                    "result": state_result,
                }
                save_checkpoint()
            current_state = list(state_result["state_items"])
            _validate_unique_bound_evidence(current_state, set(seen_ids))
            steps.append({
                "batch_index": batch_index,
                "event_count": len(batch),
                "state_items": current_state,
                "api_usage": state_result.get("api_usage"),
                "api_request_id": state_result.get("api_request_id"),
                "api_response_id": state_result.get("api_response_id"),
            })

        better_events = list(case["better_compaction_source_events"])
        better_ids = sorted(_evidence_ids(better_events))
        better_payload = {"pre_compaction_events": better_events}
        better_input_sha256 = _hash(json.dumps(better_payload, sort_keys=True))
        saved_better = checkpoint["better_compaction"].get(incident)
        if saved_better is not None:
            if saved_better.get("input_sha256") != better_input_sha256:
                raise RuntimeError("S0c Better Compaction checkpoint input changed")
            better = saved_better["result"]
        else:
            better = model.call(
                call_id=f"{incident}:better-compaction",
                scan_run_id=scan_run_id,
                instructions=BETTER_COMPACTION_INSTRUCTIONS,
                payload=better_payload,
                schema=_state_schema(better_ids),
                schema_name="better_compaction_state",
            )
            checkpoint["better_compaction"][incident] = {
                "input_sha256": better_input_sha256,
                "result": better,
            }
            save_checkpoint()
        _validate_unique_bound_evidence(better["state_items"], set(better_ids))

        native = {
            "replacement_history": case["native_context"],
            "safe_post_compaction_events": case["safe_post_compaction_events"],
        }
        condition_payloads = {
            "native": native,
            "goal_reinjection": {
                **native,
                "re_injected_goal": case["goal_reinjection"],
            },
            "simple_checkpoint": {
                **native,
                "simple_checkpoint": case["simple_checkpoint"],
            },
            "better_compaction": {
                "better_compaction_state": better["state_items"],
                "safe_post_compaction_events": case["safe_post_compaction_events"],
            },
            "coordy_structured_state": {
                "post_compaction_working_context": native,
                "persistent_pre_compaction_state": current_state,
                "comparison_rule": (
                    "Treat any still-active item present in persistent_pre_compaction_state "
                    "but absent or contradicted in post_compaction_working_context as "
                    "MISSING_OR_DISTORTED, even though the persistent state can recover it. "
                    "A satisfied approval or phase decision remains effective until superseded; "
                    "identify that specific decision rather than only broader project constraints."
                ),
            },
        }
        for condition in REPLAY_CONDITIONS:
            payload = condition_payloads[condition]
            allowed_ids = sorted(_evidence_ids(payload))
            detector_payload = {"condition": condition, "visible_state": payload}
            detector_instructions = DETECTION_INSTRUCTIONS
            if condition == "coordy_structured_state":
                detector_instructions += (
                    "\nFor this Coordy condition, the post_compaction_working_context is the "
                    "state the agent would otherwise act from. The persistent_pre_compaction_state "
                    "is an independent memory used to detect omissions. Compare them explicitly; "
                    "do not merge them and call the combined payload preserved."
                )
            detector_input_sha256 = _hash(json.dumps(detector_payload, sort_keys=True))
            detector_key = f"{incident}:{condition}"
            saved_detector = checkpoint["detectors"].get(detector_key)
            if saved_detector is not None:
                if saved_detector.get("input_sha256") != detector_input_sha256:
                    if condition != "coordy_structured_state":
                        raise RuntimeError("S0c detector checkpoint input changed")
                    saved_detector = None
            if saved_detector is None:
                detector = model.call(
                    call_id=f"{incident}:detector:{condition}",
                    scan_run_id=scan_run_id,
                    instructions=detector_instructions,
                    payload=detector_payload,
                    schema=_detector_schema(allowed_ids),
                    schema_name=f"detector_{condition}",
                )
                checkpoint["detectors"][detector_key] = {
                    "input_sha256": detector_input_sha256,
                    "result": detector,
                }
                save_checkpoint()
            else:
                detector = saved_detector["result"]
            _validate_unique_bound_evidence([detector], set(allowed_ids))
            if (
                detector["state_status"] == "PRESERVED"
                and detector["would_warn_before_action"] is not False
            ):
                raise ValueError("a preserved replay state cannot also warn about drift")
            if (
                detector["state_status"] == "MISSING_OR_DISTORTED"
                and detector["would_warn_before_action"] is not True
            ):
                raise ValueError("a missing or distorted replay state must warn before action")
            results.append({
                "scan_run_id": scan_run_id,
                "incident_id": incident,
                "condition": condition,
                "cutoff": case["cutoff"],
                "state_status": detector["state_status"],
                "would_warn_before_action": detector["would_warn_before_action"],
                "specific_state": detector["specific_state"],
                "next_step": detector["next_step"],
                "evidence_ids": detector["evidence_ids"],
                "confidence": detector["confidence"],
                "api_usage": detector.get("api_usage"),
                "api_request_id": detector.get("api_request_id"),
                "api_response_id": detector.get("api_response_id"),
                "future_information_excluded": True,
            })
        constructions.append({
            "scan_run_id": scan_run_id,
            "incident_id": incident,
            "incremental_state_steps": steps,
            "final_incremental_state": current_state,
            "better_compaction_state": better["state_items"],
            "future_information_excluded": True,
        })

    construction_content = "".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in constructions
    )
    result_content = "".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in results
    )
    construction_path = output / "s0c_context_constructions.jsonl"
    result_path = output / "s0c_detection_results.jsonl"
    _secure_write(construction_path, construction_content)
    _secure_write(result_path, result_content)
    final = {
        **manifest,
        "status": "PENDING_DETECTION_SCORING",
        "context_constructions_sha256": _hash(construction_content),
        "detection_results_sha256": _hash(result_content),
        "detection_result_count": len(results),
        "expected_detection_result_count": len(cases) * len(REPLAY_CONDITIONS),
        "model": model.model,
        "reasoning_effort": model.reasoning_effort,
    }
    _secure_write(manifest_path, json.dumps(final, indent=2, sort_keys=True) + "\n")
    return final


def score_detection_replay(
    workspace: Path,
    model: ResponsesAPIReplayModel,
) -> dict[str, Any]:
    output = workspace / "data/screening"
    source_path = output / "s0c_detection_replay_sources.jsonl"
    result_path = output / "s0c_detection_results.jsonl"
    manifest_path = output / "s0c_detection_replay_manifest.json"
    if not source_path.is_file() or not result_path.is_file() or not manifest_path.is_file():
        raise RuntimeError("missing completed S0c detection replay")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (
        manifest.get("status") not in {
            "PENDING_DETECTION_SCORING",
            "PENDING_HEALTHY_FALSE_ALARM_CHECK",
        }
        or manifest.get("replay_sources_sha256") != _hash(source_path.read_bytes())
        or manifest.get("detection_results_sha256") != _hash(result_path.read_bytes())
    ):
        raise RuntimeError("S0c detection replay is stale or not ready for scoring")
    cases = _read_jsonl(source_path)
    conditions = tuple(str(value) for value in manifest.get("conditions") or REPLAY_CONDITIONS)
    results = _read_jsonl(result_path)
    incident_label_path = output / "s0c_incident_replay_labels.jsonl"
    incident_labels: dict[str, dict[str, Any]] = {}
    incident_ground_truth = manifest.get("source_protocol_version") == "incident-causal-ground-truth-v1"
    if incident_ground_truth:
        if not incident_label_path.is_file() or manifest.get("replay_labels_sha256") != _hash(incident_label_path.read_bytes()):
            raise RuntimeError("human incident replay labels are missing or stale")
        incident_labels = {
            str(row["incident_id"]): row
            for row in _read_jsonl(incident_label_path)
        }
        if set(incident_labels) != {str(case["incident_id"]) for case in cases}:
            raise RuntimeError("human incident replay labels do not cover every replay case")
    results_by_incident: dict[str, list[dict[str, Any]]] = {}
    for row in results:
        results_by_incident.setdefault(str(row["incident_id"]), []).append(row)

    scored_rows: list[dict[str, Any]] = []
    for case in cases:
        incident = str(case["incident_id"])
        incident_results = results_by_incident.get(incident, [])
        if {str(row.get("condition")) for row in incident_results} != set(conditions):
            raise RuntimeError("S0c scoring requires exactly one result per replay condition")
        label = incident_labels.get(incident) if incident_ground_truth else None
        label_answer = (label or {}).get("human_answer") or {}
        expected_pre_evidence_ids = (
            list((label or {}).get("expected_pre_evidence_ids") or [])
            if incident_ground_truth
            else list(case.get("expected_pre_evidence_ids") or [])
        )
        expected_lost_state = (
            (label_answer.get("T0") or {}).get("summary")
            if incident_ground_truth
            else case.get("expected_lost_state")
        )
        allowed_ids = sorted(
            set(str(value) for value in expected_pre_evidence_ids)
            | _evidence_ids(incident_results)
        )
        payload = {
            "confirmed_ground_truth": {
                "incident_id": incident,
                "expected_lost_state": expected_lost_state,
                "expected_pre_evidence_ids": expected_pre_evidence_ids,
                "cutoff": case["cutoff"],
            },
            "blinded_probe_results": incident_results,
        }
        if incident_ground_truth:
            payload["human_ground_truth_label"] = incident_labels[incident]
        score_result = model.call(
            call_id=f"{incident}:detection-scoring-v2",
            scan_run_id=str(case["scan_run_id"]),
            instructions=SCORING_INSTRUCTIONS,
            payload=payload,
            schema=_scoring_schema(allowed_ids, conditions),
            schema_name="detection_scoring",
        )
        scores = score_result["scores"]
        if [str(row.get("condition")) for row in scores] != list(conditions):
            raise ValueError("S0c scorer must return every condition in frozen order")
        _validate_unique_bound_evidence(scores, set(allowed_ids))
        result_by_condition = {
            str(row["condition"]): row for row in incident_results
        }
        expected_ids = set(str(value) for value in expected_pre_evidence_ids)
        for row in scores:
            observed = result_by_condition[str(row["condition"])]
            if row["warned_before_action"] is not observed["would_warn_before_action"]:
                raise ValueError("S0c scorer changed the observed warning boolean")
            expected_evidence_cited = bool(expected_ids & set(observed["evidence_ids"]))
            if row["detection_label"] == "DETECTED" and (
                row["exact_state_identified"] is not True
                or row["warned_before_action"] is not True
                or not expected_evidence_cited
            ):
                raise ValueError(
                    "DETECTED requires exact state, observed warning, and expected evidence"
                )
            scored_rows.append({
                "scan_run_id": case["scan_run_id"],
                "incident_id": incident,
                **row,
                "expected_evidence_cited": expected_evidence_cited,
                "scorer_api_request_id": score_result.get("api_request_id"),
                "scorer_api_response_id": score_result.get("api_response_id"),
                "scorer_api_usage": score_result.get("api_usage"),
                "machine_prelabel_only": not incident_ground_truth,
                "human_ground_truth": incident_ground_truth,
            })

    score_content = "".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in scored_rows
    )
    score_path = output / "s0c_detection_scores.jsonl"
    _secure_write(score_path, score_content)
    final = {
        **manifest,
        "status": "PENDING_HEALTHY_FALSE_ALARM_CHECK",
        "detection_scores_sha256": _hash(score_content),
        "detection_score_count": len(scored_rows),
        "scorer_model": model.model,
        "scorer_reasoning_effort": model.reasoning_effort,
        "scoring_is_machine_prelabel": not incident_ground_truth,
        "human_ground_truth": incident_ground_truth,
    }
    _secure_write(manifest_path, json.dumps(final, indent=2, sort_keys=True) + "\n")
    return final


def score_healthy_false_alarms(workspace: Path) -> dict[str, Any]:
    output = workspace / "data/screening"
    source_path = output / "s0c_detection_replay_sources.jsonl"
    result_path = output / "s0c_detection_results.jsonl"
    manifest_path = output / "s0c_detection_replay_manifest.json"
    if not source_path.is_file() or not result_path.is_file() or not manifest_path.is_file():
        raise RuntimeError("missing completed healthy S0c replay")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    cases = _read_jsonl(source_path)
    results = _read_jsonl(result_path)
    if (
        manifest.get("case_kind") != "HEALTHY_NEGATIVE"
        or manifest.get("replay_sources_sha256") != _hash(source_path.read_bytes())
        or manifest.get("detection_results_sha256") != _hash(result_path.read_bytes())
        or len(results) != len(cases) * len(REPLAY_CONDITIONS)
    ):
        raise RuntimeError("healthy S0c replay is stale or incomplete")
    scored = []
    for row in results:
        if row["state_status"] == "UNCERTAIN":
            label = "UNCERTAIN"
        elif row["would_warn_before_action"]:
            label = "FALSE_ALARM"
        else:
            label = "NO_FALSE_ALARM"
        scored.append({
            "scan_run_id": row["scan_run_id"],
            "incident_id": row["incident_id"],
            "condition": row["condition"],
            "false_alarm_label": label,
            "observed_state_status": row["state_status"],
            "observed_warned_before_action": row["would_warn_before_action"],
            "evidence_ids": row["evidence_ids"],
            "ground_truth_label": "NEGATIVE",
            "machine_prelabel_only": True,
            "human_ground_truth": False,
        })
    content = "".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in scored
    )
    _secure_write(output / "s0c_healthy_false_alarm_scores.jsonl", content)
    final = {
        **manifest,
        "status": "PENDING_ACTION_PROBE_DECISION",
        "healthy_false_alarm_scores_sha256": _hash(content),
        "healthy_false_alarm_score_count": len(scored),
        "false_alarm_count": sum(
            1 for row in scored if row["false_alarm_label"] == "FALSE_ALARM"
        ),
        "uncertain_count": sum(
            1 for row in scored if row["false_alarm_label"] == "UNCERTAIN"
        ),
    }
    _secure_write(manifest_path, json.dumps(final, indent=2, sort_keys=True) + "\n")
    return final
