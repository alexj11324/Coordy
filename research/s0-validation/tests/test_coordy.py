from __future__ import annotations

import fcntl
import hashlib
import json
import os
import sqlite3
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

import coordy.incidents as incidents_module
from coordy.cli import _judge_api_settings
from coordy.action import (
    action_check_schema,
    action_probe_schema,
    _action_repeats_candidate,
    _normalize_action_probe_warning,
    _packet_digest,
    prepare_incident_action_packets,
    run_action_check,
    validate_action_probe,
    validate_action_probe_warning,
    validate_action_check,
)
from coordy.ingest import ingest
from coordy.incidents import (
    _deduplicate_incident_fragment_ids,
    _assignments_to_incident_link_result,
    _source_events_from_trajectory_windows,
    incident_fragment_schema,
    incident_causal_prelabel_schema,
    incident_link_schema,
    prepare_cross_shard_incident_link_inputs,
    prepare_goal_global_incident_link_inputs,
    prepare_incident_fragment_inputs,
    prepare_incident_causal_inputs,
    prepare_incident_causal_review,
    run_incident_causal_prelabels,
    adjudicate_incident_causal_review,
    prepare_incident_link_inputs,
    validate_incident_fragment_result,
    validate_incident_causal_prelabel,
    validate_incident_causal_review_answer,
    validate_incident_link_result,
)
from coordy.incident_cutoff import (
    IncompleteIncidentHistory,
    build_commitment_ledger,
    build_incident_cutoff_context,
    build_incident_history_index,
)
from coordy.discovery import discover_codex_environment
from coordy.models import CanonicalEvent, Check, Commitment
from coordy.commitments import (
    active_commitments,
    classify_topic_checks,
    events_through_cutoff,
    should_continue_topic_tracking,
    supersede_commitment,
    validate_check_at_cutoff,
)
from coordy.pipeline import run
from coordy.protocol import initialize
from coordy.redaction import redact_value
from coordy.replay import _replacement_history, prepare_incident_detection_replay
from coordy.review import adjudicate_s0, prepare_s0_review
from coordy.semantic import (
    STATE_JUDGE_INSTRUCTIONS,
    STATE_TYPES,
    NonRetryableJudgeError,
    ResponsesAPIStateJudge,
    _claim_api_dispatch,
    _causal_packets_for_session,
    _evaluate_state_smoke,
    _event_basis,
    _hash,
    _run_judge_batches,
    _responses_multimodal_input,
    _deduplicate_result_evidence_ids,
    _select_secondary_state_packets,
    _secure_write,
    _state_diff_batch_schema,
    _human_causal_chain,
    _semantic_event,
    _normalize_state_diff_top_level,
    _packets_for_session,
    _select_state_smoke_packets,
    adjudicate_s0b_causal_review,
    adjudicate_s0b_state_calibration,
    prepare_s0b_causal_inputs,
    prepare_s0b_state_inputs,
    prepare_s0b_state_smoke,
    run_s0b_causal_judges,
    run_s0b_state_diff,
    run_s0b_state_smoke,
    validate_causal_result,
    validate_state_diff_result,
)
from coordy.sources import JsonExportSource
from coordy.screening import run_s0_screening
from coordy.state import update_state
from coordy.trajectory import (
    _normalize_trajectory_result,
    aggregate_trajectory_discovery,
    build_natural_compaction_windows,
    build_no_compaction_session_window,
    prepare_trajectory_windows,
    shard_natural_window,
    trajectory_schema,
    validate_trajectory_result,
)


class CoordyTests(unittest.TestCase):
    def write_action_manifest(self, workspace: Path, packet: dict) -> None:
        output = workspace / "data/screening"
        output.mkdir(parents=True, exist_ok=True)
        packet_content = (json.dumps(packet, ensure_ascii=False, sort_keys=True) + "\n").encode()
        labels_content = (json.dumps({"case_id": packet["case_id"]}, sort_keys=True) + "\n").encode()
        (output / "incident_action_packets_v1.jsonl").write_bytes(packet_content)
        (output / "incident_action_labels_v1.jsonl").write_bytes(labels_content)
        (output / "incident_action_manifest_v1.json").write_text(json.dumps({
            "status": "READY_FOR_ACTION_CHECK",
            "scan_run_id": packet.get("scan_run_id"),
            "action_packet_count": 1,
            "action_packets_sha256": _hash(packet_content),
            "action_labels_sha256": _hash(labels_content),
        }))

    def commitment(self, **overrides):
        values = {
            "commitment_id": "c-current-book",
            "goal_root_id": "goal-readey",
            "topic": "ebook-search-scope",
            "type": "CONSTRAINT",
            "claim": "Search only the currently open book",
            "polarity": "MUST",
            "authority": "USER",
            "scope": "product-search",
            "valid_from_event_id": "event-user-scope",
            "source_event_ids": ["event-user-scope"],
        }
        values.update(overrides)
        return Commitment(**values)

    def test_commitment_requires_real_source_reference(self):
        with self.assertRaisesRegex(ValueError, "valid-from source event"):
            self.commitment(source_event_ids=[])

    def test_agent_plan_cannot_supersede_user_commitment(self):
        original = self.commitment()
        proposed = self.commitment(
            commitment_id="c-whole-library",
            claim="Search the whole library",
            authority="AGENT",
            valid_from_event_id="event-agent-plan",
            source_event_ids=["event-agent-plan"],
        )
        with self.assertRaisesRegex(ValueError, "cannot supersede"):
            supersede_commitment([original], old_id=original.commitment_id, replacement=proposed)
        self.assertEqual(original.status, "ACTIVE")

    def test_authoritative_commitment_can_be_superseded(self):
        original = self.commitment()
        replacement = self.commitment(
            commitment_id="c-new-user-scope",
            claim="Search the whole library",
            valid_from_event_id="event-user-changed-scope",
            source_event_ids=["event-user-changed-scope"],
        )
        ledger = supersede_commitment(
            [original], old_id=original.commitment_id, replacement=replacement
        )
        self.assertEqual(original.status, "SUPERSEDED")
        self.assertEqual(original.superseded_by, replacement.commitment_id)
        self.assertEqual(active_commitments(ledger), [replacement])

    def test_cutoff_excludes_future_events_without_truncating_visible_history(self):
        events = [
            CanonicalEvent(
                event_id=f"event-{index}", session_id="session", timestamp="2026-08-17T00:00:00Z",
                sequence_number=index, actor="user", event_type="message", content=str(index),
            )
            for index in range(80)
        ]
        visible = events_through_cutoff(events, session_id="session", cutoff_sequence=70)
        self.assertEqual(len(visible), 71)
        self.assertEqual(visible[0].event_id, "event-0")
        self.assertEqual(visible[-1].event_id, "event-70")
        self.assertNotIn("event-71", {row.event_id for row in visible})

    def test_local_no_change_does_not_stop_anchored_or_action_tracking(self):
        local = Check(
            check_id="check-local", goal_root_id="goal-readey", topic="ebook-search-scope",
            kind="LOCAL", verdict="CONSISTENT", observed_event_ids=["summary-1", "summary-2"],
        )
        self.assertTrue(should_continue_topic_tracking([local]))

    def test_e_books_agent_scope_expansion_is_candidate_not_valid_update(self):
        # Frozen from the corrected Reathm timeline. Current-book-only is the
        # authoritative scope; the later whole-library expansion is an agent
        # plan, and the user correction reaffirms rather than replaces that scope.
        # T0-T5 outcome review must still decide near miss versus confirmed drift.
        initial_event = "msg_019fd415-de3b-7701-9d32-1698baa51343"
        agent_whole_library_decision = "msg_067e29c622e5045f016a746c662e1881979d85ac219235394c"
        correction_event = "msg_019fd6ca-45b2-7af3-a365-0e151f51edf4"
        restored_current_book_action = "msg_067e29c622e5045f016a746d2a7c60819799caf7ee8831b3a9"
        original = self.commitment(
            commitment_id="c-current-book",
            claim="Search only the currently open book; whole-library search is out of scope",
            valid_from_event_id=initial_event,
            source_event_ids=[initial_event],
        )
        checks = [
            Check(
                check_id="check-agent-whole-library-decision", goal_root_id="goal-readey",
                topic="ebook-search-scope", kind="ACTION", verdict="CONTRADICTED",
                observed_event_ids=[agent_whole_library_decision],
                commitment_ids=[original.commitment_id],
                action_event_ids=[agent_whole_library_decision],
            ),
            Check(
                check_id="check-user-reaffirms-current-book", goal_root_id="goal-readey",
                topic="ebook-search-scope", kind="ANCHORED", verdict="CONSISTENT",
                observed_event_ids=[correction_event],
                commitment_ids=[original.commitment_id],
            ),
            Check(
                check_id="check-current-book-action", goal_root_id="goal-readey",
                topic="ebook-search-scope", kind="ACTION", verdict="CONSISTENT",
                observed_event_ids=[restored_current_book_action],
                commitment_ids=[original.commitment_id],
                action_event_ids=[restored_current_book_action],
            ),
        ]
        self.assertEqual(active_commitments([original]), [original])
        self.assertEqual(classify_topic_checks(checks), "DRIFT_CANDIDATE")

    def test_check_rejects_future_evidence_at_cutoff(self):
        commitment = self.commitment()
        visible = [CanonicalEvent(
            event_id="event-user-scope", session_id="session", timestamp="2026-08-17T00:00:00Z",
            sequence_number=0, actor="user", event_type="message", content="current book only",
        )]
        check = Check(
            check_id="future-action", goal_root_id="goal-readey", topic="ebook-search-scope",
            kind="ACTION", verdict="CONTRADICTED", observed_event_ids=["future-plan"],
            commitment_ids=[commitment.commitment_id], action_event_ids=["future-plan"],
        )
        with self.assertRaisesRegex(ValueError, "outside the cutoff"):
            validate_check_at_cutoff(check, commitments=[commitment], visible_events=visible)

    def test_state_packet_has_no_48_pre_3_post_or_first_tool_truncation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rollout.jsonl"
            rows = [
                {"timestamp": "2026-08-17T00:00:00Z", "type": "session_meta", "payload": {"id": "session"}},
                *[
                    {"timestamp": "2026-08-17T00:00:01Z", "type": "response_item", "payload": {
                        "id": f"pre-{index}", "type": "message", "role": "user", "content": f"Constraint {index}",
                    }}
                    for index in range(80)
                ],
                {"timestamp": "2026-08-17T00:01:00Z", "type": "compacted", "payload": {"id": "boundary", "content": "summary"}},
                {"timestamp": "2026-08-17T00:01:01Z", "type": "response_item", "payload": {
                    "id": "tool", "type": "function_call", "name": "exec_command", "arguments": "{}",
                }},
                *[
                    {"timestamp": "2026-08-17T00:01:02Z", "type": "response_item", "payload": {
                        "id": f"post-{index}", "type": "message", "role": "assistant", "content": f"Plan {index}",
                    }}
                    for index in range(5)
                ],
            ]
            content = "".join(json.dumps(row) + "\n" for row in rows).encode()
            path.write_bytes(content)
            opportunity = {
                "scan_run_id": "scan", "episode_id_hash": "opportunity",
                "session_id_hash": _hash("session"), "source_prefix_sha256": hashlib.sha256(content).hexdigest(),
                "cutoff": {"boundary_id_hash": _hash(_event_basis(rows[81], 82))},
            }
            packets = _packets_for_session({
                "source_path": str(path), "scanned_bytes": len(content),
                "scanned_prefix_sha256": hashlib.sha256(content).hexdigest(),
            }, [opportunity])
            self.assertEqual(len(packets[0]["pre_compaction_events"]), 80)
            self.assertEqual(len(packets[0]["post_compaction_plan_events"]), 5)

    def test_action_check_is_cutoff_and_commitment_bound(self):
        packet = {
            "case_id": "authorized-update-fixture",
            "commitments": [{"commitment_id": "approved-scope"}],
            "visible_events": [{"event_id": "user-scope"}, {"event_id": "agent-plan"}],
        }
        schema = action_check_schema(packet)
        item = schema["properties"]["results"]["items"]
        self.assertEqual(
            item["properties"]["source_event_ids"]["items"]["enum"],
            ["agent-plan", "user-scope"],
        )
        valid = {
            "case_id": "authorized-update-fixture", "decision": "NO_ALERT",
            "action": "authorized scoped search",
            "conflicting_commitment_ids": [], "reason": "authorized update",
            "source_event_ids": ["user-scope", "agent-plan"], "confidence": 0.99,
        }
        validate_action_check(packet, valid)
        future = {**valid, "source_event_ids": ["future-correction"]}
        with self.assertRaisesRegex(ValueError, "outside the cutoff"):
            validate_action_check(packet, future)

    def test_action_check_cache_is_bound_and_does_not_recall_judge(self):
        class Judge:
            configuration_sha256 = "config"
            calls = 0

            def grade(self, packet):
                self.calls += 1
                return {
                    "case_id": packet["case_id"], "decision": "NO_ALERT", "action": "safe",
                    "conflicting_commitment_ids": [], "reason": "consistent",
                    "source_event_ids": ["event"], "confidence": 1.0,
                }

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet = root / "packet.json"
            packet_data = {
                "case_id": "case", "scan_run_id": "legacy-fixture",
                "commitments": [{"commitment_id": "c"}],
                "visible_events": [{"event_id": "event", "sequence": 1}],
            }
            packet.write_text(json.dumps(packet_data))
            self.write_action_manifest(root / "out", packet_data)
            judge = Judge()
            first = run_action_check(packet_path=packet, workspace=root / "out", judge=judge)
            second = run_action_check(packet_path=packet, workspace=root / "out", judge=judge)
            self.assertEqual(first, second)
            self.assertEqual(judge.calls, 1)

    def test_action_probe_is_source_bound_and_requires_concrete_next_step(self):
        packet = {
            "case_id": "probe-case",
            "visible_events": [{"event_id": "e1", "sequence": 1}],
        }
        schema = action_probe_schema(packet)
        self.assertEqual(
            schema["properties"]["result"]["properties"]["source_event_ids"]["items"]["enum"],
            ["e1"],
        )
        valid = {
            "case_id": "probe-case", "next_action": "re-read the commitment event",
            "reread_required": True, "replan_required": True, "avoid_actions": ["apply the old plan"],
            "reason": "the cutoff evidence is insufficient", "source_event_ids": ["e1"],
            "confidence": 0.8,
        }
        validate_action_probe(packet, valid)
        invalid = {**valid, "source_event_ids": ["future"]}
        with self.assertRaisesRegex(ValueError, "outside the cutoff"):
            validate_action_probe(packet, invalid)

    def test_action_packet_embedded_digest_is_checked_before_cached_execution(self):
        class Judge:
            configuration_sha256 = "config"
            def grade(self, packet):
                return {
                    "case_id": packet["case_id"], "decision": "NO_ALERT", "action": "safe",
                    "conflicting_commitment_ids": [], "reason": "consistent",
                    "source_event_ids": ["event"], "confidence": 1.0,
                }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet = root / "packet.json"
            unsigned = {
                "case_id": "case", "scan_run_id": "legacy-fixture",
                "commitments": [{"commitment_id": "c"}],
                "visible_events": [{"event_id": "event"}],
            }
            packet_data = {**unsigned, "packet_sha256": _hash(json.dumps(unsigned, sort_keys=True).encode())}
            packet.write_text(json.dumps(packet_data))
            self.write_action_manifest(root / "out", packet_data)
            run_action_check(packet_path=packet, workspace=root / "out", judge=Judge())
            packet.write_text(json.dumps({**unsigned, "packet_sha256": "tampered"}))
            with self.assertRaisesRegex(ValueError, "digest"):
                run_action_check(packet_path=packet, workspace=root / "out", judge=Judge())

    def test_generated_action_packet_cannot_bypass_ready_gate_by_removing_protocol(self):
        class Judge:
            configuration_sha256 = "config"

            def grade(self, packet):
                raise AssertionError("READY gate must run before the judge")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet = root / "packet.json"
            generated = {
                "case_id": "case", "protocol_version": "incident-action-packet-v1-cutoff-bound",
                "scan_run_id": "run", "future_information_excluded": True,
                "cutoff": {"cutoff_order_mode": "sequence", "cutoff_sequence": 1},
                "visible_events": [{"event_id": "event", "sequence": 1}],
            }
            tampered = dict(generated)
            tampered.pop("protocol_version")
            tampered.pop("scan_run_id")
            tampered.pop("future_information_excluded")
            tampered["packet_sha256"] = _packet_digest(tampered)
            packet.write_text(json.dumps(tampered))
            with self.assertRaisesRegex(RuntimeError, "complete action packet manifest"):
                run_action_check(packet_path=packet, workspace=root / "workspace", judge=Judge())

    def test_incident_detection_replay_excludes_t3_and_future_outcomes(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            packet = {
                "incident_case_id_hash": "case",
                "goal_thread_id_hash": "root",
                "scan_run_id": "run",
                "topic": "scope",
                "complete_history_prefix": True,
                "source_session_id_hash": "session",
                "source_parent_opportunity_id_hashes": ["parent"],
                "source_events": [
                    {"evidence_id": "e0", "sequence": 1, "actor": "user", "content": "must stay local"},
                    {"evidence_id": "e1", "sequence": 2, "actor": "assistant", "content": "plan"},
                    {"evidence_id": "e2", "sequence": 4, "actor": "assistant", "content": "wrong plan"},
                    {"evidence_id": "e3", "sequence": 5, "actor": "tool", "content": "patch"},
                    {"evidence_id": "e4", "sequence": 6, "actor": "user", "content": "correction"},
                ],
                "compaction_opportunities": [{
                    "boundary_id_hash": "b1",
                    "compaction_event": {"evidence_id": "b1", "sequence": 3, "content": ""},
                }],
            }
            packet["source_history_prefix"] = list(packet["source_events"]) + [
                {"evidence_id": "b1", "sequence": 3, "record_type": "compacted", "content": ""}
            ]
            input_path = output / "incident_causal_inputs_v1.jsonl"
            input_path.write_text(json.dumps(packet) + "\n")
            answer = {
                "incident_case_id_hash": "case", "episode_key": "episode",
                "classification": "CONFIRMED_COMPACTION_DRIFT",
                "T0": {"status": "PRESENT", "summary": "must stay local", "evidence_ids": ["e0"]},
                "T1": {"status": "PRESENT", "summary": "compaction", "evidence_ids": ["b1"]},
                "T2": {"status": "PRESENT", "summary": "wrong plan", "evidence_ids": ["e2"]},
                "T3": {"status": "PRESENT", "summary": "patch", "evidence_ids": ["e3"]},
                "T4": {"status": "PRESENT", "summary": "correction", "evidence_ids": ["e4"]},
                "T5": {"status": "ABSENT", "summary": "not supplied", "evidence_ids": []},
                "compaction_caused": "YES", "wrong_action": "YES",
                "engineering_consequence": "YES",
                "ordinary_reasoning_better_explanation": "NO",
                "confidence": 1.0, "rationale": "bound fixture",
            }
            gt = {
                "review_item_id": "item", "incident_case_id_hash": "case",
                "episode_key": "episode", "human_answer": answer, "ground_truth": True,
            }
            gt_path = output / "incident_causal_ground_truth_v1.jsonl"
            gt_path.write_text(json.dumps(gt) + "\n")
            manifest = {
                "scan_run_id": "run",
                "incident_causal_inputs_v1": {
                    "status": "READY_FOR_MACHINE_PRELABEL",
                    "scan_run_id": "run",
                    "incident_causal_inputs_sha256": _hash(input_path.read_bytes()),
                },
                "incident_causal_ground_truth_v1": {
                    "status": "HUMAN_ADJUDICATION_COMPLETE",
                    "review_scope": "FULL", "review_queue_kind": "FULL",
                    "ground_truth_sha256": _hash(gt_path.read_bytes()),
                    "review_context_sha256": _hash(input_path.read_bytes()),
                },
            }
            (output / "trajectory_manifest.json").write_text(json.dumps(manifest))
            result = prepare_incident_detection_replay(workspace)
            self.assertEqual(result["replay_case_count"], 1)
            source = json.loads((output / "s0c_detection_replay_sources.jsonl").read_text())
            visible = source["full_history_prefix"]
            self.assertTrue(all(int(row.get("sequence") or 0) <= 4 for row in visible))
            self.assertNotIn("e3", {row["evidence_id"] for row in visible})
            self.assertNotIn("e4", {row["evidence_id"] for row in visible})
            self.assertTrue(source["future_information_excluded"])
            manifest["incident_causal_ground_truth_v1"].update({
                "status": "HUMAN_ADJUDICATION_TRIAGE_COMPLETE",
                "review_scope": "TRIAGED", "review_queue_kind": "TRIAGED",
            })
            (output / "trajectory_manifest.json").write_text(json.dumps(manifest))
            triaged_result = prepare_incident_detection_replay(workspace)
            self.assertEqual(triaged_result["human_ground_truth_scope"], "TRIAGED")
            self.assertEqual(triaged_result["human_ground_truth_label_count"], 1)
            manifest["incident_causal_ground_truth_v1"].update({
                "status": "HUMAN_ADJUDICATION_COMPLETE",
                "review_scope": "TRIAGED", "review_queue_kind": "TRIAGED",
            })
            (output / "trajectory_manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(RuntimeError, "stale or not bound"):
                prepare_incident_detection_replay(workspace)

    def test_replay_status_separates_excluded_classification_from_missing_context(self):
        def write_case(root: Path, classification: str, *, complete: bool) -> None:
            output = root / "data/screening"
            output.mkdir(parents=True)
            packet = {
                "incident_case_id_hash": "case", "goal_thread_id_hash": "root", "scan_run_id": "run",
                "source_events": [
                    {"evidence_id": "e0", "sequence": 1, "actor": "user", "content": "must local"},
                    {"evidence_id": "e2", "sequence": 4, "actor": "assistant", "content": "action"},
                ],
                "compaction_opportunities": [{
                    "boundary_id_hash": "b1", "compaction_event": {"evidence_id": "b1", "sequence": 3},
                }],
            }
            if complete:
                packet.update({
                    "complete_history_prefix": True, "source_session_id_hash": "session",
                    "source_parent_opportunity_id_hashes": ["parent"],
                    "source_history_prefix": [*packet["source_events"], {"evidence_id": "b1", "sequence": 3}],
                })
            input_path = output / "incident_causal_inputs_v1.jsonl"
            input_path.write_text(json.dumps(packet) + "\n")
            answer = {
                "classification": classification,
                "T0": {"evidence_ids": ["e0"]}, "T1": {"evidence_ids": ["b1"]},
                "T2": {"evidence_ids": ["e2"]}, "T3": {"evidence_ids": []},
                "T4": {"evidence_ids": []}, "T5": {"evidence_ids": []},
            }
            gt_path = output / "incident_causal_ground_truth_v1.jsonl"
            gt_path.write_text(json.dumps({
                "review_item_id": "item", "incident_case_id_hash": "case",
                "episode_key": "episode", "human_answer": answer,
            }) + "\n")
            (output / "trajectory_manifest.json").write_text(json.dumps({
                "scan_run_id": "run",
                "incident_causal_inputs_v1": {
                    "status": "READY_FOR_MACHINE_PRELABEL", "scan_run_id": "run",
                    "incident_causal_inputs_sha256": _hash(input_path.read_bytes()),
                },
                "incident_causal_ground_truth_v1": {
                    "status": "HUMAN_ADJUDICATION_COMPLETE",
                    "review_scope": "FULL", "review_queue_kind": "FULL",
                    "ground_truth_sha256": _hash(gt_path.read_bytes()),
                    "review_context_sha256": _hash(input_path.read_bytes()),
                },
            }))

        with tempfile.TemporaryDirectory() as tmp:
            excluded = Path(tmp) / "excluded"
            write_case(excluded, "UNRESOLVED", complete=False)
            result = prepare_incident_detection_replay(excluded)
            self.assertEqual(result["status"], "NO_REPLAYABLE_CASES")
            self.assertEqual(result["skipped_case_count"], 0)
            self.assertEqual(result["excluded_non_replayable_classifications"], {"UNRESOLVED": 1})

            missing = Path(tmp) / "missing"
            write_case(missing, "VALID_PLAN_UPDATE", complete=False)
            result = prepare_incident_detection_replay(missing)
            self.assertEqual(result["status"], "INCOMPLETE_CONTEXT_CONSTRUCTION")
            self.assertEqual(result["skipped_case_count"], 1)

    def test_incident_action_packets_are_cutoff_bound_and_require_human_labels(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            packet = {
                "incident_case_id_hash": "case", "goal_thread_id_hash": "root", "scan_run_id": "run",
                "topic": "scope",
                "complete_history_prefix": True,
                "source_session_id_hash": "session",
                "source_parent_opportunity_id_hashes": ["parent"],
                "source_events": [
                    {"evidence_id": "e0", "sequence": 1, "actor": "user", "content": "local"},
                    {"evidence_id": "e2", "sequence": 4, "actor": "assistant", "content": "global"},
                    {"evidence_id": "e3", "sequence": 5, "actor": "tool", "content": "patch"},
                ],
                "compaction_opportunities": [{
                    "boundary_id_hash": "b1", "compaction_event": {"sequence": 3},
                }],
            }
            packet["source_history_prefix"] = list(packet["source_events"]) + [
                {"evidence_id": "b1", "sequence": 3, "record_type": "compacted", "content": ""}
            ]
            input_path = output / "incident_causal_inputs_v1.jsonl"
            input_path.write_text(json.dumps(packet) + "\n")
            answer = {
                "classification": "CONFIRMED_COMPACTION_DRIFT",
                "T0": {"status": "PRESENT", "summary": "local", "evidence_ids": ["e0"]},
                "T1": {"status": "PRESENT", "summary": "compact", "evidence_ids": ["b1"]},
                "T2": {"status": "PRESENT", "summary": "global", "evidence_ids": ["e2"]},
                "T3": {"status": "PRESENT", "summary": "patch", "evidence_ids": ["e3"]},
                "T4": {"status": "ABSENT", "summary": "none", "evidence_ids": []},
                "T5": {"status": "ABSENT", "summary": "none", "evidence_ids": []},
                "compaction_caused": "YES", "wrong_action": "YES",
                "engineering_consequence": "YES", "ordinary_reasoning_better_explanation": "NO",
                "confidence": 1.0, "rationale": "fixture",
            }
            gt = {"review_item_id": "item", "incident_case_id_hash": "case", "episode_key": "episode", "human_answer": answer}
            gt_path = output / "incident_causal_ground_truth_v1.jsonl"
            gt_path.write_text(json.dumps(gt) + "\n")
            manifest = {
                "scan_run_id": "run",
                "incident_causal_inputs_v1": {
                    "status": "READY_FOR_MACHINE_PRELABEL", "scan_run_id": "run",
                    "incident_causal_inputs_sha256": _hash(input_path.read_bytes()),
                },
                "incident_causal_ground_truth_v1": {
                    "status": "HUMAN_ADJUDICATION_COMPLETE",
                    "review_scope": "FULL", "review_queue_kind": "FULL",
                    "ground_truth_sha256": _hash(gt_path.read_bytes()),
                    "review_context_sha256": _hash(input_path.read_bytes()),
                },
            }
            (output / "trajectory_manifest.json").write_text(json.dumps(manifest))
            result = prepare_incident_action_packets(workspace)
            self.assertEqual(result["status"], "READY_FOR_ACTION_CHECK")
            action_packet = json.loads((output / "incident_action_packets_v1.jsonl").read_text())
            self.assertTrue(action_packet["future_information_excluded"])
            self.assertNotIn("e3", {row["event_id"] for row in action_packet["visible_events"]})
            self.assertEqual(action_packet["candidate_action"], "global")
            manifest["incident_causal_ground_truth_v1"].update({
                "status": "HUMAN_ADJUDICATION_TRIAGE_COMPLETE",
                "review_scope": "TRIAGED", "review_queue_kind": "TRIAGED",
            })
            (output / "trajectory_manifest.json").write_text(json.dumps(manifest))
            triaged_result = prepare_incident_action_packets(workspace)
            self.assertEqual(triaged_result["human_ground_truth_scope"], "TRIAGED")
            self.assertEqual(triaged_result["human_ground_truth_label_count"], 1)
            manifest["incident_causal_ground_truth_v1"].update({
                "status": "HUMAN_ADJUDICATION_COMPLETE",
                "review_scope": "TRIAGED", "review_queue_kind": "TRIAGED",
            })
            (output / "trajectory_manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(RuntimeError, "stale or not bound"):
                prepare_incident_action_packets(workspace)

    def test_commitment_ledger_is_source_derived_and_tracks_explicit_lifecycle(self):
        events = [
            {"evidence_id": "e1", "sequence": 1, "actor": "user", "topic": "scope", "content": "Must keep X"},
            {"evidence_id": "chat", "sequence": 2, "actor": "user", "topic": "scope", "content": "How are you?"},
            {"evidence_id": "e2", "sequence": 3, "actor": "user", "topic": "scope", "content": "Cancel X; use Y instead"},
        ]
        rows = build_commitment_ledger(
            events, goal_root_id="root", topic="scope", id_prefix="case",
        )
        self.assertEqual({row["valid_from_event_id"] for row in rows}, {"e1", "e2"})
        self.assertEqual(next(row for row in rows if row["valid_from_event_id"] == "e1")["status"], "SUPERSEDED")
        self.assertEqual(next(row for row in rows if row["valid_from_event_id"] == "e2")["status"], "ACTIVE")
        self.assertTrue(all(row.get("extraction_source") == "source_text_marker_fallback" for row in rows))

    def test_machine_commitment_authority_requires_matching_source_actor(self):
        events = [{
            "evidence_id": "assistant-event", "sequence": 1, "actor": "assistant",
            "payload_type": "message", "content": "keep the old plan",
        }]
        finding = {
            "kind": "COMMITMENT", "authority": "USER", "topic": "scope",
            "statement": "keep the old plan", "source_event_ids": ["assistant-event"],
            "discovery_directions": ["forward"],
        }
        with self.assertRaisesRegex(ValueError, "source actors"):
            build_commitment_ledger(
                events, goal_root_id="root", topic="scope", id_prefix="case",
                extracted_findings=[finding],
            )
        mixed_events = [
            {"evidence_id": "user-event", "sequence": 1, "actor": "user", "content": "ok"},
            {"evidence_id": "assistant-event", "sequence": 2, "actor": "assistant", "content": "build global"},
        ]
        with self.assertRaisesRegex(ValueError, "source actors"):
            build_commitment_ledger(
                mixed_events, goal_root_id="root", topic="scope", id_prefix="case",
                extracted_findings=[{
                    "kind": "COMMITMENT", "authority": "USER", "topic": "scope",
                    "statement": "build global", "source_event_ids": ["user-event", "assistant-event"],
                    "discovery_directions": ["forward"],
                }],
            )

    def test_authorized_update_enters_commitment_lifecycle(self):
        events = [
            {"evidence_id": "e1", "sequence": 1, "actor": "user", "topic": "storage", "content": "Must use SQLite"},
            {"evidence_id": "e2", "sequence": 2, "actor": "user", "topic": "storage", "content": "Replace SQLite with Postgres for this phase"},
        ]
        rows = build_commitment_ledger(
            events, goal_root_id="root", topic="storage", id_prefix="case",
            extracted_findings=[
                {"kind": "COMMITMENT", "authority": "USER", "topic": "storage",
                 "statement": "Must use SQLite", "source_event_ids": ["e1"],
                 "discovery_directions": ["forward"]},
                {"kind": "AUTHORIZED_UPDATE", "authority": "USER", "topic": "storage",
                 "statement": "Replace SQLite with Postgres for this phase", "source_event_ids": ["e2"],
                 "discovery_directions": ["forward"], "supersedes_event_ids": ["e1"]},
            ],
        )
        self.assertEqual([row["status"] for row in rows], ["SUPERSEDED", "ACTIVE"])
        unrelated = build_commitment_ledger(
            [
                {"evidence_id": "u1", "sequence": 1, "actor": "user", "topic": "ui", "content": "Must not use network"},
                {"evidence_id": "u2", "sequence": 2, "actor": "user", "topic": "ui", "content": "Change the button color to blue"},
            ],
            goal_root_id="root", topic="ui", id_prefix="case",
            extracted_findings=[
                {"kind": "COMMITMENT", "authority": "USER", "topic": "ui",
                 "statement": "Must not use network", "source_event_ids": ["u1"],
                 "discovery_directions": ["forward"]},
                {"kind": "AUTHORIZED_UPDATE", "authority": "USER", "topic": "ui",
                 "statement": "Change the button color to blue", "source_event_ids": ["u2"],
                 "discovery_directions": ["forward"]},
            ],
        )
        self.assertEqual([row["status"] for row in unrelated], ["ACTIVE", "ACTIVE"])
        qualifier_only = build_commitment_ledger(
            [
                {"evidence_id": "q1", "sequence": 1, "actor": "user", "topic": "ui", "content": "Must keep storage local"},
                {"evidence_id": "q2", "sequence": 2, "actor": "user", "topic": "ui", "content": "Change local button color to blue"},
            ],
            goal_root_id="root", topic="ui", id_prefix="case",
            extracted_findings=[
                {"kind": "COMMITMENT", "authority": "USER", "topic": "ui",
                 "statement": "Must keep storage local", "source_event_ids": ["q1"],
                 "discovery_directions": ["forward"]},
                {"kind": "AUTHORIZED_UPDATE", "authority": "USER", "topic": "ui",
                 "statement": "Change local button color to blue", "source_event_ids": ["q2"],
                 "discovery_directions": ["forward"]},
            ],
        )
        self.assertEqual([row["status"] for row in qualifier_only], ["ACTIVE", "ACTIVE"])
        domain_only = build_commitment_ledger(
            [
                {"evidence_id": "d1", "sequence": 1, "actor": "user", "topic": "storage", "content": "Must encrypt storage at rest"},
                {"evidence_id": "d2", "sequence": 2, "actor": "user", "topic": "storage", "content": "Change storage backup frequency to daily"},
            ],
            goal_root_id="root", topic="storage", id_prefix="case",
            extracted_findings=[
                {"kind": "COMMITMENT", "authority": "USER", "topic": "storage",
                 "statement": "Must encrypt storage at rest", "source_event_ids": ["d1"],
                 "discovery_directions": ["forward"]},
                {"kind": "AUTHORIZED_UPDATE", "authority": "USER", "topic": "storage",
                 "statement": "Change storage backup frequency to daily", "source_event_ids": ["d2"],
                 "discovery_directions": ["forward"]},
            ],
        )
        self.assertEqual([row["status"] for row in domain_only], ["ACTIVE", "ACTIVE"])
        strong_replacement = build_commitment_ledger(
            [
                {"evidence_id": "s1", "sequence": 1, "actor": "user", "topic": "storage", "content": "Must use SQLite"},
                {"evidence_id": "s2", "sequence": 2, "actor": "user", "topic": "storage", "content": "Actually use Postgres instead"},
            ],
            goal_root_id="root", topic="storage", id_prefix="case",
            extracted_findings=[
                {"kind": "COMMITMENT", "authority": "USER", "topic": "storage",
                 "statement": "Must use SQLite", "source_event_ids": ["s1"],
                 "discovery_directions": ["forward"]},
                {"kind": "AUTHORIZED_UPDATE", "authority": "USER", "topic": "storage",
                 "statement": "Actually use Postgres instead", "source_event_ids": ["s2"],
                 "discovery_directions": ["forward"], "supersedes_event_ids": ["s1"]},
            ],
        )
        self.assertEqual([row["status"] for row in strong_replacement], ["SUPERSEDED", "ACTIVE"])
        multi_source = build_commitment_ledger(
            [
                {"evidence_id": "m1", "sequence": 1, "actor": "user", "topic": "storage", "content": "Must use SQLite"},
                {"evidence_id": "m2", "sequence": 2, "actor": "user", "topic": "storage", "content": "Keep SQLite for this phase"},
                {"evidence_id": "m3", "sequence": 3, "actor": "user", "topic": "storage", "content": "Replace SQLite with Postgres"},
            ],
            goal_root_id="root", topic="storage", id_prefix="case",
            extracted_findings=[
                {"kind": "COMMITMENT", "authority": "USER", "topic": "storage",
                 "statement": "Must use SQLite", "source_event_ids": ["m1", "m2"],
                 "discovery_directions": ["forward"]},
                {"kind": "AUTHORIZED_UPDATE", "authority": "USER", "topic": "storage",
                 "statement": "Replace SQLite with Postgres", "source_event_ids": ["m3"],
                 "discovery_directions": ["forward"], "supersedes_event_ids": ["m2"]},
            ],
        )
        self.assertEqual([row["status"] for row in multi_source], ["SUPERSEDED", "ACTIVE"])
        multi_source_origin_ids = build_commitment_ledger(
            [
                {"evidence_id": "v1", "source_evidence_id": "s1", "sequence": 1,
                 "actor": "user", "topic": "storage", "content": "Must use SQLite"},
                {"evidence_id": "v2", "source_evidence_id": "s2", "sequence": 2,
                 "actor": "user", "topic": "storage", "content": "Keep SQLite for this phase"},
                {"evidence_id": "v3", "source_evidence_id": "s3", "sequence": 3,
                 "actor": "user", "topic": "storage", "content": "Replace SQLite with Postgres"},
            ],
            goal_root_id="root", topic="storage", id_prefix="case",
            extracted_findings=[
                {"kind": "COMMITMENT", "authority": "USER", "topic": "storage",
                 "statement": "Must use SQLite", "source_event_ids": ["s1", "s2"],
                 "discovery_directions": ["forward"]},
                {"kind": "AUTHORIZED_UPDATE", "authority": "USER", "topic": "storage",
                 "statement": "Replace SQLite with Postgres", "source_event_ids": ["s3"],
                 "discovery_directions": ["forward"], "supersedes_event_ids": ["s2"]},
            ],
        )
        self.assertEqual([row["status"] for row in multi_source_origin_ids], ["SUPERSEDED", "ACTIVE"])
        unrelated_search = build_commitment_ledger(
            [
                {"evidence_id": "r1", "sequence": 1, "actor": "user", "topic": "ebook-search", "content": "Must scope search to current book"},
                {"evidence_id": "r2", "sequence": 2, "actor": "user", "topic": "ebook-search", "content": "Change search result sort order to title"},
            ],
            goal_root_id="root", topic="ebook-search", id_prefix="case",
            extracted_findings=[
                {"kind": "COMMITMENT", "authority": "USER", "topic": "ebook-search",
                 "statement": "Must scope search to current book", "source_event_ids": ["r1"],
                 "discovery_directions": ["forward"]},
                {"kind": "AUTHORIZED_UPDATE", "authority": "USER", "topic": "ebook-search",
                 "statement": "Change search result sort order to title", "source_event_ids": ["r2"],
                 "discovery_directions": ["forward"]},
            ],
        )
        self.assertEqual([row["status"] for row in unrelated_search], ["ACTIVE", "ACTIVE"])

    def test_action_repeat_signature_distinguishes_targets_and_normalizes_migrations(self):
        self.assertFalse(_action_repeats_candidate("delete all tests", "delete all generated files"))
        self.assertTrue(_action_repeats_candidate(
            "switch persistence to SQLite", "migrate storage backend to SQLite"
        ))
        self.assertFalse(_action_repeats_candidate(
            "delete database migration tests", "delete database migration files"
        ))
        self.assertFalse(_action_repeats_candidate(
            "delete generated test files", "delete database files"
        ))
        self.assertFalse(_action_repeats_candidate(
            "delete all tests", "do not delete all tests"
        ))

    def test_legacy_action_wrapper_cannot_be_rebound_to_a_new_packet(self):
        with self.assertRaisesRegex(ValueError, "legacy action-check wrapper"):
            _normalize_action_probe_warning(
                {"case_id": "case"},
                {"packet_sha256": "whole-file-hash", "result": {"decision": "NO_ALERT"}},
            )

    def test_goal_timestamp_action_cutoff_accepts_reset_sequence_across_sessions(self):
        packet = {
            "incident_case_id_hash": "case", "goal_thread_id_hash": "root", "topic": "scope",
            "source_parent_opportunity_id_hashes": ["p1", "p2"],
            "source_events": [
                {"evidence_id": "e0", "source_evidence_id": "e0", "parent_opportunity_id_hash": "p1",
                 "source_session_id_hash": "s1", "timestamp": "2026-01-01T00:00:00Z", "sequence": 100,
                 "actor": "user", "content": "must keep local"},
                {"evidence_id": "e2", "source_evidence_id": "e2", "parent_opportunity_id_hash": "p2",
                 "source_session_id_hash": "s2", "timestamp": "2026-01-01T00:00:04Z", "sequence": 5,
                 "actor": "assistant", "content": "build global index"},
            ],
            "compaction_opportunities": [{
                "boundary_id_hash": "b2", "parent_opportunity_id_hash": "p2",
                "compaction_event": {
                    "evidence_id": "b2", "timestamp": "2026-01-01T00:00:03Z", "sequence": 4,
                },
            }],
        }
        history = {
            "complete": {"p1": {"e0": packet["source_events"][0]}, "p2": {"e2": packet["source_events"][1]}},
            "opportunities": {"p2": packet["compaction_opportunities"][0]},
            "parent_sessions": {"p1": "s1", "p2": "s2"},
            "parent_goals": {"p1": "root", "p2": "root"},
            "goal_parents": {"root": ["p1", "p2"]},
            "parent_max_orders": {
                "p1": ("2026-01-01T00:00:00Z", 100, "s1", "e0"),
                "p2": ("2026-01-01T00:00:04Z", 5, "s2", "e2"),
            },
            "commitment_findings": [{
                "kind": "COMMITMENT", "authority": "USER", "topic": "scope",
                "statement": "must keep local", "source_event_ids": ["e0"],
                "parent_opportunity_id_hash": "p1",
                "discovery_directions": ["forward"],
            }],
            "commitment_findings_sha256": "fixture",
        }
        answer = {
            "T0": {"evidence_ids": ["e0"]}, "T1": {"evidence_ids": ["b2"]},
            "T2": {"evidence_ids": ["e2"]}, "T3": {"evidence_ids": []},
            "T4": {"evidence_ids": []}, "T5": {"evidence_ids": []},
        }
        context = build_incident_cutoff_context(packet, answer, history_index=history)
        future_history = json.loads(json.dumps(history))
        future_history["complete"]["p1"]["future"] = {
            "evidence_id": "future", "source_evidence_id": "future",
            "source_session_id_hash": "s1", "timestamp": "2026-01-01T00:00:05Z",
            "sequence": 101, "actor": "assistant", "content": "test outcome",
        }
        future_context = build_incident_cutoff_context(packet, answer, history_index=future_history)
        self.assertEqual(future_context["commitment_ledger"], [])
        visible = [dict(row, event_id=row["evidence_id"]) for row in context["full_history_prefix"]]
        action_packet = {
            "case_id": "case", "cutoff_order_mode": context["cutoff_order_mode"],
            "cutoff_order": context["cutoff_order"],
            "scan_run_id": "fixture-run",
            "cutoff": {
                "boundary_id_hashes": context["t1_boundary_ids"],
                "cutoff_sequence": context["cutoff_sequence"],
                "cutoff_order_mode": context["cutoff_order_mode"],
                "cutoff_order": context["cutoff_order"],
            },
            "commitments": context["commitment_ledger"], "visible_events": visible,
        }
        action_packet["packet_sha256"] = _packet_digest(action_packet)
        commitment = action_packet["commitments"][0]
        warning = {
            "protocol_version": "action-check-v1-source-grounded", "case_id": "case",
            "packet_sha256": action_packet["packet_sha256"], "cutoff": action_packet["cutoff"],
            "future_information_excluded": True, "decision": "ALERT", "action": "build global index",
            "conflicting_commitment_ids": [commitment["commitment_id"]], "reason": "scope conflict",
            "source_event_ids": ["e0"], "confidence": 0.9,
        }
        validate_action_probe_warning(action_packet, warning)

        class Judge:
            configuration_sha256 = "fixture-config"

            def grade(self, value):
                return {
                    "case_id": value["case_id"], "decision": "NO_ALERT", "action": "re-read",
                    "conflicting_commitment_ids": [], "reason": "fixture",
                    "source_event_ids": ["e0", "e2"], "confidence": 0.8,
                }

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "packet.json"
            path.write_text(json.dumps(action_packet))
            action_workspace = Path(tmp) / "workspace"
            action_output = action_workspace / "data/screening"
            action_output.mkdir(parents=True)
            packet_content = path.read_bytes()
            labels_content = json.dumps({"case_id": "case"}) + "\n"
            (action_output / "incident_action_packets_v1.jsonl").write_bytes(packet_content + b"\n")
            (action_output / "incident_action_labels_v1.jsonl").write_text(labels_content)
            (action_output / "incident_action_manifest_v1.json").write_text(json.dumps({
                "status": "READY_FOR_ACTION_CHECK", "scan_run_id": "fixture-run",
                "action_packet_count": 1,
                "action_packets_sha256": _hash(packet_content + b"\n"),
                "action_labels_sha256": _hash(labels_content.encode()),
            }))
            record = run_action_check(packet_path=path, workspace=action_workspace, judge=Judge())
            validate_action_probe_warning(action_packet, record["warning"])

    def test_history_index_requires_manifest_bindings_for_sessions_and_findings(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            windows_path = root / "trajectory_windows.jsonl"
            sessions_path = root / "eligible_sessions.jsonl"
            findings_path = root / "trajectory_union_findings.jsonl"
            window = {
                "opportunity_id_hash": "parent", "goal_thread_id_hash": "root",
                "session_id_hash": _hash("session"), "boundary_id_hash": "boundary",
                "scan_run_id": "run", "compaction_event": {
                    "evidence_id": "boundary", "timestamp": "2026-01-01T00:00:01Z", "sequence": 2,
                }, "events_since_previous_compaction": [], "events_until_next_compaction": [],
            }
            windows_content = json.dumps(window) + "\n"
            windows_path.write_text(windows_content)
            sessions_content = json.dumps({
                "session_id": "session", "goal_thread_id_hash": "root", "scan_run_id": "run",
                "compaction_count_scanned": 1,
            }) + "\n"
            sessions_path.write_text(sessions_content)
            findings_path.write_text("")
            manifest = {
                "trajectory_windows_sha256": _hash(windows_content.encode()),
                "trajectory_union": {"union_findings_sha256": _hash(b"")},
            }
            (root / "trajectory_manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(IncompleteIncidentHistory, "eligible session index hash"):
                build_incident_history_index(windows_path, eligible_sessions_path=sessions_path)

    def test_adjacent_state_diff_uses_last_t1_boundary(self):
        packet = {
            "incident_case_id_hash": "case", "goal_thread_id_hash": "root", "topic": "scope",
            "source_parent_opportunity_id_hashes": ["p"],
            "source_events": [
                {"evidence_id": "e0", "parent_opportunity_id_hash": "p", "source_session_id_hash": "s",
                 "timestamp": "2026-01-01T00:00:00Z", "sequence": 1, "actor": "user", "content": "must local"},
                {"evidence_id": "e2", "parent_opportunity_id_hash": "p", "source_session_id_hash": "s",
                 "timestamp": "2026-01-01T00:00:04Z", "sequence": 5, "actor": "assistant", "content": "candidate"},
            ],
            "compaction_opportunities": [
                {"boundary_id_hash": "b1", "parent_opportunity_id_hash": "p",
                 "compaction_event": {"evidence_id": "b1", "timestamp": "2026-01-01T00:00:01Z", "sequence": 2}},
                {"boundary_id_hash": "b2", "parent_opportunity_id_hash": "p",
                 "compaction_event": {"evidence_id": "b2", "timestamp": "2026-01-01T00:00:03Z", "sequence": 4}},
            ],
        }
        history = {
            "complete": {"p": {"e0": packet["source_events"][0], "e2": packet["source_events"][1]}},
            "opportunities": {"p": {"boundary_id_hash": "b2", "compaction_event": packet["compaction_opportunities"][1]["compaction_event"]}},
            "parent_sessions": {"p": "s"}, "parent_goals": {"p": "root"},
            "goal_parents": {"root": ["p"]}, "commitment_findings": [],
            "commitment_findings_sha256": "fixture",
        }
        # The packet's second boundary is the last T1 boundary; both are in the
        # source packet so the adjacency code must choose b2, not b1.
        packet["compaction_opportunities"][1]["parent_opportunity_id_hash"] = "p"
        answer = {"T0": {"evidence_ids": ["e0"]}, "T1": {"evidence_ids": ["b1", "b2"]},
                  "T2": {"evidence_ids": ["e2"]}, "T3": {"evidence_ids": []},
                  "T4": {"evidence_ids": []}, "T5": {"evidence_ids": []}}
        # Add b1 to the indexed opportunity's packet reconstruction through a
        # second parent-shaped entry; this keeps the fixture cross-boundary.
        history["opportunities"]["p"] = {
            "boundary_id_hash": "b2", "compaction_event": packet["compaction_opportunities"][1]["compaction_event"],
        }
        # Use the sparse fallback for a compact assertion of the last-boundary
        # behavior; the indexed path is covered by the cross-session test above.
        packet["complete_history_prefix"] = True
        packet["source_session_id_hash"] = "s"
        packet["source_history_prefix"] = [
            {"evidence_id": "e0", "sequence": 1, "timestamp": "2026-01-01T00:00:00Z", "content": "must local"},
            {"evidence_id": "b1", "sequence": 2, "timestamp": "2026-01-01T00:00:01Z", "record_type": "compacted"},
            {"evidence_id": "b2", "sequence": 4, "timestamp": "2026-01-01T00:00:03Z", "record_type": "compacted"},
            {"evidence_id": "e2", "sequence": 5, "timestamp": "2026-01-01T00:00:04Z", "content": "candidate"},
        ]
        context = build_incident_cutoff_context(packet, answer, history_index=None)
        self.assertEqual(context["last_boundary_id"], "b2")
        self.assertEqual([row["evidence_id"] for row in context["adjacent_previous_state_events"]], ["b2"])
        self.assertEqual([row["evidence_id"] for row in context["adjacent_current_state_events"]], ["e2"])

    def test_natural_compaction_window_covers_all_events_without_fixed_caps(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rollout.jsonl"
            rows = [
                {"timestamp": "2026-08-17T00:00:00Z", "type": "session_meta", "payload": {"id": "session"}},
                *[
                    {"timestamp": "2026-08-17T00:00:01Z", "type": "response_item", "payload": {
                        "id": f"pre-{index}", "type": "message", "role": "user", "content": f"Requirement {index}",
                    }} for index in range(80)
                ],
                {"timestamp": "2026-08-17T00:01:00Z", "type": "compacted", "payload": {"id": "boundary", "content": "summary"}},
                {"timestamp": "2026-08-17T00:01:01Z", "type": "response_item", "payload": {
                    "id": "tool", "type": "function_call", "name": "exec_command", "arguments": {"cmd": "test"},
                }},
                *[
                    {"timestamp": "2026-08-17T00:01:02Z", "type": "response_item", "payload": {
                        "id": f"post-{index}", "type": "message", "role": "assistant", "content": f"Plan {index}",
                    }} for index in range(5)
                ],
            ]
            content = "".join(json.dumps(row) + "\n" for row in rows).encode()
            path.write_bytes(content)
            opportunity = {
                "scan_run_id": "scan", "episode_id_hash": "opportunity",
                "session_id_hash": _hash("session"),
                "cutoff": {"boundary_id_hash": _hash(_event_basis(rows[81], 82))},
            }
            windows = build_natural_compaction_windows({
                "source_path": str(path), "scanned_bytes": len(content),
                "scanned_prefix_sha256": hashlib.sha256(content).hexdigest(),
            }, [opportunity])
            self.assertEqual(len(windows[0]["events_since_previous_compaction"]), 80)
            self.assertEqual(len(windows[0]["events_until_next_compaction"]), 6)
            self.assertIn('"cmd": "test"', windows[0]["events_until_next_compaction"][0]["content"])

    def test_no_compaction_session_gets_a_luna_discovery_unit(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rollout.jsonl"
            rows = [
                {"timestamp": "2026-08-17T00:00:00Z", "type": "session_meta", "payload": {"id": "session"}},
                {"timestamp": "2026-08-17T00:00:01Z", "type": "response_item", "payload": {
                    "id": "user-1", "type": "message", "role": "user", "content": "Must keep the current book",
                }},
            ]
            content = "".join(json.dumps(row) + "\n" for row in rows).encode()
            path.write_bytes(content)
            window = build_no_compaction_session_window({
                "session_id": "session", "goal_thread_id_hash": "root", "scan_run_id": "run",
                "source_path": str(path), "scanned_bytes": len(content),
                "scanned_prefix_sha256": hashlib.sha256(content).hexdigest(),
                "compaction_count_scanned": 0,
            })
            self.assertTrue(window["synthetic_no_compaction"])
            self.assertEqual(window["parent_opportunity_id_hash"], "session:" + _hash("session"))
            self.assertEqual(window["events_since_previous_compaction"][0]["actor"], "user")

    def test_trajectory_findings_are_event_bound_and_agent_cannot_author_commitment(self):
        window = {
            "opportunity_id_hash": "op", "events_since_previous_compaction": [
                {"evidence_id": "user", "content": "current book only"},
            ], "compaction_event": {"evidence_id": "compact"},
            "events_until_next_compaction": [{"evidence_id": "plan", "content": "build index"}],
        }
        schema = trajectory_schema(window)
        variants = schema["properties"]["results"]["items"]["properties"]["findings"]["items"]["anyOf"]
        self.assertTrue(all(
            item["properties"]["event_ids"]["items"]["enum"] == ["compact", "plan", "user"]
            for item in variants
        ))
        self.assertNotIn("AGENT", variants[0]["properties"]["authority"]["enum"])
        valid = {"opportunity_id_hash": "op", "confidence": 0.9, "findings": [{
            "kind": "CANDIDATE_ACTION", "topic": "search", "statement": "build global index",
            "authority": "AGENT", "event_ids": ["plan"], "action_specificity": "CONCRETE",
        }]}
        validate_trajectory_result(window, valid)
        invalid = json.loads(json.dumps(valid))
        invalid["findings"][0].update({"kind": "COMMITMENT", "authority": "AGENT"})
        with self.assertRaisesRegex(ValueError, "cannot become"):
            validate_trajectory_result(window, invalid)
        repeated = json.loads(json.dumps(valid))
        repeated["findings"][0]["event_ids"] = ["plan", "plan"]
        normalized = _normalize_trajectory_result(repeated)
        self.assertEqual(normalized["findings"][0]["event_ids"], ["plan"])
        self.assertEqual(normalized["duplicate_evidence_ids_removed"], 1)

    def test_transport_shards_preserve_all_content_without_event_caps(self):
        window = {
            "opportunity_id_hash": "parent", "compaction_event": {"evidence_id": "compact"},
            "events_since_previous_compaction": [{"evidence_id": "large", "content": "甲" * 25}],
            "events_until_next_compaction": [{"evidence_id": "post", "content": "乙" * 15}],
        }
        shards = shard_natural_window(window, max_window_chars=20, max_event_chars=10)
        parts = [
            event for shard in shards
            for phase in ("events_since_previous_compaction", "events_until_next_compaction")
            for event in shard[phase]
        ]
        reconstructed = "".join(event["content"].split("\n", 1)[-1] for event in parts)
        self.assertEqual(reconstructed, ("甲" * 25) + ("乙" * 15))
        self.assertTrue(all(shard["parent_opportunity_id_hash"] == "parent" for shard in shards))

    def test_trajectory_aggregate_requires_both_bound_directions_and_restores_source_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            windows = [{
                "opportunity_id_hash": "shard", "parent_opportunity_id_hash": "parent",
                "goal_thread_id_hash": "goal", "events_since_previous_compaction": [{
                    "evidence_id": "part", "source_evidence_id": "source", "content": "part",
                }], "compaction_event": {"evidence_id": "compact"},
                "events_until_next_compaction": [],
            }]
            window_content = "".join(json.dumps(row) + "\n" for row in windows)
            (output / "trajectory_windows.jsonl").write_text(window_content)
            manifest = {
                "trajectory_window_count": 1, "trajectory_discovery_unit_count": 1,
                "trajectory_windows_sha256": hashlib.sha256(window_content.encode()).hexdigest(),
            }
            finding = {
                "opportunity_id_hash": "shard", "confidence": 1.0, "findings": [{
                    "kind": "COMMITMENT", "topic": "scope", "statement": "current book",
                    "authority": "USER", "event_ids": ["part"],
                    "action_specificity": "NOT_APPLICABLE",
                }],
            }
            for direction in ("forward", "backward"):
                content = json.dumps(finding) + "\n"
                (output / f"trajectory_{direction}_results.jsonl").write_text(content)
                manifest[f"{direction}_discovery"] = {
                    "status": "COMPLETE", "completed_result_count": 1,
                    "result_sha256": hashlib.sha256(content.encode()).hexdigest(),
                }
            (output / "trajectory_manifest.json").write_text(json.dumps(manifest))
            result = aggregate_trajectory_discovery(workspace)
            self.assertEqual(result["union_finding_count"], 2)
            rows = [
                json.loads(line)
                for line in (output / "trajectory_union_findings.jsonl").read_text().splitlines()
                if line
            ]
            self.assertEqual({tuple(row["source_event_ids"]) for row in rows}, {("source",)})
            self.assertEqual({tuple(row["discovery_directions"]) for row in rows}, {("forward",), ("backward",)})

    def test_trajectory_aggregate_canonicalizes_split_supersession_refs(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            windows = [{
                "opportunity_id_hash": "shard", "parent_opportunity_id_hash": "parent",
                "goal_thread_id_hash": "goal", "events_since_previous_compaction": [
                    {"evidence_id": "part-1", "source_evidence_id": "source", "content": "part"},
                ], "compaction_event": {"evidence_id": "compact"},
                "events_until_next_compaction": [],
            }]
            window_content = json.dumps(windows[0]) + "\n"
            (output / "trajectory_windows.jsonl").write_text(window_content)
            manifest = {
                "trajectory_window_count": 1, "trajectory_discovery_unit_count": 1,
                "trajectory_windows_sha256": hashlib.sha256(window_content.encode()).hexdigest(),
            }
            finding = {
                "opportunity_id_hash": "shard", "confidence": 1.0, "findings": [{
                    "kind": "AUTHORIZED_UPDATE", "topic": "scope", "statement": "replace scope",
                    "authority": "USER", "event_ids": ["part-1"],
                    "supersedes_event_ids": ["part-1"],
                    "action_specificity": "NOT_APPLICABLE",
                }],
            }
            for direction in ("forward", "backward"):
                content = json.dumps(finding) + "\n"
                (output / f"trajectory_{direction}_results.jsonl").write_text(content)
                manifest[f"{direction}_discovery"] = {
                    "status": "COMPLETE", "completed_result_count": 1,
                    "result_sha256": hashlib.sha256(content.encode()).hexdigest(),
                }
            (output / "trajectory_manifest.json").write_text(json.dumps(manifest))
            aggregate_trajectory_discovery(workspace)
            rows = [
                json.loads(line)
                for line in (output / "trajectory_union_findings.jsonl").read_text().splitlines()
                if line
            ]
            self.assertEqual({tuple(row["supersedes_event_ids"]) for row in rows}, {("source",)})

    def test_incident_fragment_inputs_ignore_synthetic_no_compaction_units(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            windows_content = json.dumps({
                "opportunity_id_hash": "session:s1",
                "parent_opportunity_id_hash": "session:s1",
                "goal_thread_id_hash": "root",
                "boundary_id_hash": "synthetic-boundary",
                "scan_run_id": "run",
                "synthetic_no_compaction": True,
                "compaction_event": {"timestamp": "2026-01-01T00:00:00Z", "sequence": 0},
            }) + "\n"
            findings_content = ""
            windows_path = output / "trajectory_windows.jsonl"
            findings_path = output / "trajectory_union_findings.jsonl"
            windows_path.write_text(windows_content)
            findings_path.write_text(findings_content)
            (output / "trajectory_manifest.json").write_text(json.dumps({
                "scan_run_id": "run", "trajectory_window_count": 0,
                "trajectory_windows_sha256": _hash(windows_content.encode()),
                "trajectory_union": {
                    "status": "COMPLETE",
                    "union_findings_sha256": _hash(findings_content.encode()),
                },
            }))
            result = prepare_incident_fragment_inputs(workspace)
            self.assertEqual(result["incident_fragment_input_count"], 0)

    def test_incident_causal_source_index_reassembles_transport_parts(self):
        source_id = "source-event"
        base = {
            "parent_opportunity_id_hash": "parent",
            "goal_thread_id_hash": "root",
            "boundary_id_hash": "boundary",
            "scan_run_id": "run",
            "compaction_event": {"evidence_id": "compaction", "sequence": 3},
            "events_until_next_compaction": [],
        }
        windows = [
            {
                **base,
                "opportunity_id_hash": "shard-1",
                "events_since_previous_compaction": [{
                    "evidence_id": "part-1", "source_evidence_id": source_id,
                    "sequence": 2, "content": "[source event part 1/2]\nhello ",
                }],
            },
            {
                **base,
                "opportunity_id_hash": "shard-2",
                "events_since_previous_compaction": [{
                    "evidence_id": "part-2", "source_evidence_id": source_id,
                    "sequence": 2, "content": "[source event part 2/2]\nworld",
                }],
            },
        ]
        events, opportunities = _source_events_from_trajectory_windows(windows)
        self.assertEqual(events["parent"][source_id]["content"], "hello world")
        self.assertEqual(events["parent"][source_id]["evidence_id"], source_id)
        self.assertNotIn("source_evidence_id", events["parent"][source_id])
        self.assertEqual(set(opportunities), {"parent"})

    def test_confirmed_incident_causal_prelabel_requires_complete_bound_t0_t4(self):
        packet = {
            "incident_case_id_hash": "case", "allowed_source_event_ids": ["t0", "t2", "t3", "t4"],
            "allowed_boundary_ids": ["t1"],
        }
        phase = lambda evidence_id: {
            "status": "PRESENT", "summary": "bound", "evidence_ids": [evidence_id],
        }
        result = {
            "incident_case_id_hash": "case", "bundle_assessment": "candidate",
            "episodes": [{
                "episode_key": "scope", "classification": "CONFIRMED_COMPACTION_DRIFT",
                "T0": phase("t0"), "T1": phase("t1"), "T2": phase("t2"),
                "T3": phase("t3"), "T4": phase("t4"),
                "T5": {"status": "ABSENT", "summary": "none", "evidence_ids": []},
                "compaction_caused": "YES", "wrong_action": "YES",
                "engineering_consequence": "YES",
                "ordinary_reasoning_better_explanation": "NO",
                "confidence": 0.9, "rationale": "complete causal chain",
            }],
        }
        validate_incident_causal_prelabel(packet, result)
        result["episodes"][0]["T4"] = {
            "status": "ABSENT", "summary": "none", "evidence_ids": [],
        }
        with self.assertRaisesRegex(ValueError, "requires present T0 through T4"):
            validate_incident_causal_prelabel(packet, result)
        schema = incident_causal_prelabel_schema(packet)
        self.assertEqual(
            schema["properties"]["incident_case_id_hash"]["enum"], ["case"],
        )

    def test_incident_causal_checkpoint_row_is_bound_to_packet_and_dispatch_provenance(self):
        packet = {
            "opportunity_id_hash": "case",
            "incident_case_id_hash": "case",
            "scan_run_id": "run",
            "allowed_source_event_ids": [],
            "allowed_boundary_ids": [],
        }
        row = {
            "incident_case_id_hash": "case",
            "bundle_assessment": "no distinct episode",
            "episodes": [],
            "api_request_id": "request",
            "api_response_id": "response",
            "api_status": "completed",
            "api_usage": {
                "input_tokens": 1,
                "output_tokens": 1,
                "total_tokens": 2,
                "input_tokens_details": {"cached_tokens": 0},
                "output_tokens_details": {"reasoning_tokens": 0},
            },
            "judge_attempt": 1,
        }
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            dispatch = _claim_api_dispatch(
                directory,
                judge_id="causal",
                configuration_sha256="config",
                packet=packet,
            )
            record = json.loads(dispatch.read_text())
            record.update({
                "status": "RESPONSE_VALIDATED_PENDING_CHECKPOINT",
                "api_request_id": "request",
                "api_response_id": "response",
                "api_status": "completed",
                "api_usage": row["api_usage"],
                "accepted_result": row,
                "accepted_result_sha256": _hash(
                    json.dumps(row, ensure_ascii=False, sort_keys=True)
                ),
            })
            _secure_write(dispatch, json.dumps(record))

            incidents_module._validate_incident_causal_checkpoint_row(
                packet,
                row,
                judge_id="causal",
                configuration_sha256="config",
                dispatch_log_dir=directory,
            )
            missing_metadata = dict(row)
            for key in ("api_request_id", "api_response_id", "api_status", "api_usage", "judge_attempt"):
                missing_metadata.pop(key, None)
            incomplete_record = dict(record)
            for key in ("api_request_id", "api_response_id", "api_status", "api_usage", "judge_attempt"):
                incomplete_record.pop(key, None)
            incomplete_record["accepted_result"] = missing_metadata
            incomplete_record["accepted_result_sha256"] = _hash(
                json.dumps(missing_metadata, ensure_ascii=False, sort_keys=True)
            )
            _secure_write(dispatch, json.dumps(incomplete_record))
            with self.assertRaisesRegex(ValueError, "api_request_id"):
                incidents_module._validate_incident_causal_checkpoint_row(
                    packet,
                    missing_metadata,
                    judge_id="causal",
                    configuration_sha256="config",
                    dispatch_log_dir=directory,
                )
            tampered = {**row, "api_response_id": "other-response"}
            with self.assertRaisesRegex(RuntimeError, "dispatch provenance"):
                incidents_module._validate_incident_causal_checkpoint_row(
                    packet,
                    tampered,
                    judge_id="causal",
                    configuration_sha256="config",
                    dispatch_log_dir=directory,
                )

    def test_incident_causal_validated_result_recovery_is_digest_and_input_bound(self):
        packet = {
            "opportunity_id_hash": "case",
            "incident_case_id_hash": "case",
            "scan_run_id": "run",
            "allowed_source_event_ids": [],
            "allowed_boundary_ids": [],
        }
        accepted = {
            "incident_case_id_hash": "case", "bundle_assessment": "none", "episodes": [],
            "api_request_id": "request", "api_response_id": "response",
            "api_status": "completed", "api_usage": {
                "input_tokens": 1, "output_tokens": 1, "total_tokens": 2,
                "cached_input_tokens": 0, "reasoning_output_tokens": 0,
            }, "judge_attempt": 1,
        }
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            dispatch = _claim_api_dispatch(
                directory,
                judge_id="causal", configuration_sha256="config", packet=packet,
            )
            record = json.loads(dispatch.read_text())
            record.update({
                "status": "RESPONSE_VALIDATED_PENDING_CHECKPOINT",
                "api_request_id": "request", "api_response_id": "response",
                "api_status": "completed", "api_usage": accepted["api_usage"],
                "accepted_result": accepted,
                "accepted_result_sha256": _hash(json.dumps(accepted, ensure_ascii=False, sort_keys=True)),
                "accepted_input_packet_sha256": _hash(json.dumps(packet, sort_keys=True)),
                "accepted_judge_id": "causal",
                "accepted_judge_configuration_sha256": "config",
            })
            _secure_write(dispatch, json.dumps(record))
            recovered = incidents_module._recover_validated_incident_causal_result(
                packet, dispatch, judge_id="causal", configuration_sha256="config",
            )
            self.assertEqual(recovered, accepted)
            parsed_record = dict(record)
            parsed_record.pop("accepted_result", None)
            parsed_record.pop("accepted_result_sha256", None)
            parsed_record.pop("accepted_input_packet_sha256", None)
            parsed_record.pop("accepted_judge_id", None)
            parsed_record.pop("accepted_judge_configuration_sha256", None)
            parsed_record["parsed_result"] = {
                key: value for key, value in accepted.items()
                if key not in {"api_request_id", "api_response_id", "api_status", "api_usage", "judge_attempt"}
            }
            parsed_record["parsed_result_sha256"] = _hash(
                json.dumps(parsed_record["parsed_result"], ensure_ascii=False, sort_keys=True)
            )
            _secure_write(dispatch, json.dumps(parsed_record))
            recovered_from_parsed = incidents_module._recover_validated_incident_causal_result(
                packet, dispatch, judge_id="causal", configuration_sha256="config",
            )
            self.assertEqual(recovered_from_parsed, accepted)
            tampered_parsed = json.loads(dispatch.read_text())
            tampered_parsed.pop("accepted_result", None)
            tampered_parsed.pop("accepted_result_sha256", None)
            tampered_parsed.pop("accepted_input_packet_sha256", None)
            tampered_parsed.pop("accepted_judge_id", None)
            tampered_parsed.pop("accepted_judge_configuration_sha256", None)
            parsed = dict(tampered_parsed["parsed_result"])
            parsed["ground_truth"] = True
            tampered_parsed["parsed_result"] = parsed
            tampered_parsed["parsed_result_sha256"] = _hash(
                json.dumps(parsed, ensure_ascii=False, sort_keys=True)
            )
            _secure_write(dispatch, json.dumps(tampered_parsed))
            with self.assertRaisesRegex(ValueError, "unsupported"):
                incidents_module._recover_validated_incident_causal_result(
                    packet, dispatch, judge_id="causal", configuration_sha256="config",
                )
            record["accepted_result"]["bundle_assessment"] = "tampered"
            _secure_write(dispatch, json.dumps(record))
            with self.assertRaisesRegex(RuntimeError, "digest"):
                incidents_module._recover_validated_incident_causal_result(
                    packet, dispatch, judge_id="causal", configuration_sha256="config",
                )

    def test_legacy_causal_checkpoint_is_explicitly_unassessable(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            packet = {
                "protocol_version": "incident-causal-inputs-v1-source-bound",
                "opportunity_id_hash": "case",
                "incident_case_id_hash": "case",
                "goal_thread_id_hash": "root",
                "scan_run_id": "run",
                "topic": "search_scope",
                "allowed_source_event_ids": ["event-1"],
                "allowed_boundary_ids": ["boundary-1"],
                "source_events": [],
                "compaction_opportunities": [],
            }
            input_path = output / "incident_causal_inputs_v1.jsonl"
            input_path.write_text(json.dumps(packet) + "\n")
            phase = lambda status: {
                "status": status, "summary": status, "evidence_ids": [],
            }
            legacy_row = {
                "incident_case_id_hash": "case",
                "bundle_assessment": "legacy",
                "episodes": [{
                    "episode_key": "legacy",
                    "classification": "UNRESOLVED",
                    "T0": phase("UNASSESSABLE"), "T1": phase("UNASSESSABLE"),
                    "T2": phase("UNASSESSABLE"), "T3": phase("UNASSESSABLE"),
                    "T4": phase("UNASSESSABLE"), "T5": phase("UNASSESSABLE"),
                    "compaction_caused": "UNCERTAIN", "wrong_action": "UNCERTAIN",
                    "engineering_consequence": "UNCERTAIN",
                    "ordinary_reasoning_better_explanation": "UNCERTAIN",
                    "confidence": 0.2, "rationale": "legacy",
                }],
                "api_request_id": "request", "api_response_id": "response",
                "api_status": "completed", "api_usage": {
                    "input_tokens": 1, "output_tokens": 1, "total_tokens": 2,
                }, "judge_attempt": 1,
            }
            checkpoint = output / "incident_causal_prelabels_v1.jsonl"
            checkpoint.write_text(json.dumps(legacy_row) + "\n")
            legacy_checkpoint_content = checkpoint.read_text()
            dispatch_dir = output / "api_dispatch_incident_causal_v1"
            dispatch_dir.mkdir()
            judge_id, config = "causal", "config"
            dispatch = {
                "status": "RESPONSE_VALIDATED_PENDING_CHECKPOINT",
                "scan_run_id": "run", "opportunity_id_hash": "case",
                "judge_id": judge_id, "judge_configuration_sha256": config,
                "input_packet_sha256": _hash(json.dumps(packet, sort_keys=True)),
                "api_request_id": "request", "api_response_id": "response",
                "api_status": "completed", "api_usage": legacy_row["api_usage"],
                "judge_attempt": 1,
            }
            (dispatch_dir / f"{_hash(f'{judge_id}:{config}:case')}.json").write_text(
                json.dumps(dispatch)
            )
            (output / "trajectory_manifest.json").write_text(json.dumps({
                "scan_run_id": "run",
                "incident_causal_inputs_v1": {
                    "status": "READY_FOR_MACHINE_PRELABEL", "scan_run_id": "run",
                    "incident_causal_inputs_sha256": _hash(input_path.read_bytes()),
                },
            }))

            class NoCallJudge:
                judge_id = "causal"
                configuration_sha256 = "config"

                def __init__(self, dispatch_log_dir):
                    self.dispatch_log_dir = dispatch_log_dir

                def grade(self, packet):
                    raise AssertionError("legacy unassessable recovery must not call the API")

            with self.assertRaisesRegex(RuntimeError, "accepted-result provenance"):
                run_incident_causal_prelabels(workspace, NoCallJudge(dispatch_dir), workers=1)
            result = run_incident_causal_prelabels(
                workspace, NoCallJudge(dispatch_dir), workers=1, allow_legacy_unassessable=True,
            )
            self.assertEqual(result["classification_counts"], {"UNASSESSABLE": 1})
            reconciled = json.loads(checkpoint.read_text())
            self.assertEqual(reconciled["machine_result_status"], "UNASSESSABLE_OUTPUT_FAILURE")
            self.assertTrue((output / "incident_causal_prelabels_v1.jsonl.legacy").is_file())
            dispatch_after = json.loads(next(dispatch_dir.glob("*.json")).read_text())
            self.assertEqual(dispatch_after["status"], "UNASSESSABLE_OUTPUT_FAILURE")
            self.assertEqual(
                (output / "incident_causal_prelabels_v1.jsonl.legacy").read_text(),
                legacy_checkpoint_content,
            )
            self.assertEqual(prepare_incident_causal_review(workspace)["review_item_count"], 1)

            # Simulate a crash after dispatch binding but before checkpoint
            # replacement. The next run must recover the exact bound placeholder
            # rather than trusting the stale legacy row or resending the request.
            bound_placeholder = json.loads(checkpoint.read_text())
            checkpoint.write_text(legacy_checkpoint_content)
            recovered = run_incident_causal_prelabels(
                workspace, NoCallJudge(dispatch_dir), workers=1, allow_legacy_unassessable=True,
            )
            self.assertEqual(recovered["classification_counts"], {"UNASSESSABLE": 1})
            self.assertEqual(json.loads(checkpoint.read_text()), bound_placeholder)

            # Also cover the missing-checkpoint window: only the already-bound
            # dispatch exists, so recovery must reconstruct the checkpoint
            # without invoking the judge.
            checkpoint.unlink()
            recovered_missing = run_incident_causal_prelabels(
                workspace, NoCallJudge(dispatch_dir), workers=1, allow_legacy_unassessable=True,
            )
            self.assertEqual(recovered_missing["classification_counts"], {"UNASSESSABLE": 1})
            self.assertEqual(json.loads(checkpoint.read_text()), bound_placeholder)

    def test_incident_causal_review_queue_requires_complete_bound_prelabels(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            input_path = output / "incident_causal_inputs_v1.jsonl"
            checkpoint_path = output / "incident_causal_prelabels_v1.jsonl"
            packet = {
                "protocol_version": "incident-causal-inputs-v1-source-bound",
                "opportunity_id_hash": "case",
                "incident_case_id_hash": "case",
                "goal_thread_id_hash": "root",
                "scan_run_id": "run",
                "topic": "search_scope",
                "source_events": [{"evidence_id": "event-1", "sequence": 1, "content": "state"}],
                "compaction_opportunities": [{"boundary_id_hash": "boundary-1", "compaction_event": {"sequence": 2}}],
                "allowed_source_event_ids": ["event-1"],
                "allowed_boundary_ids": ["boundary-1"],
            }
            input_path.write_text(json.dumps(packet) + "\n")
            phase = lambda status, ids=(): {"status": status, "summary": status, "evidence_ids": list(ids)}
            row = {
                "incident_case_id_hash": "case",
                "bundle_assessment": "one episode",
                "episodes": [{
                    "episode_key": "episode",
                    "classification": "UNRESOLVED",
                    "T0": phase("UNASSESSABLE"), "T1": phase("UNASSESSABLE"),
                    "T2": phase("UNASSESSABLE"), "T3": phase("UNASSESSABLE"),
                    "T4": phase("UNASSESSABLE"), "T5": phase("UNASSESSABLE"),
                    "compaction_caused": "UNCERTAIN", "wrong_action": "UNCERTAIN",
                    "engineering_consequence": "UNCERTAIN",
                    "ordinary_reasoning_better_explanation": "UNCERTAIN",
                    "confidence": 0.2, "rationale": "uncertain",
                }],
                "api_request_id": "request", "api_response_id": "response",
                "api_status": "completed", "api_usage": {
                    "input_tokens": 1, "output_tokens": 1, "total_tokens": 2,
                    "input_tokens_details": {"cached_tokens": 0},
                    "output_tokens_details": {"reasoning_tokens": 0},
                }, "judge_attempt": 1,
            }
            checkpoint_path.write_text(json.dumps(row) + "\n")
            config = "config"
            judge_id = "causal"
            record_id = _hash(f"{judge_id}:{config}:case")
            dispatch_dir = output / "api_dispatch_incident_causal_v1"
            dispatch_dir.mkdir()
            dispatch = {
                "status": "RESPONSE_VALIDATED_PENDING_CHECKPOINT",
                "scan_run_id": "run", "opportunity_id_hash": "case",
                "judge_id": judge_id, "judge_configuration_sha256": config,
                "input_packet_sha256": _hash(json.dumps(packet, sort_keys=True)),
                "api_request_id": "request", "api_response_id": "response",
                "api_status": "completed", "api_usage": row["api_usage"],
                "judge_attempt": 1,
                "accepted_result": row,
                "accepted_result_sha256": _hash(
                    json.dumps(row, ensure_ascii=False, sort_keys=True)
                ),
            }
            (dispatch_dir / f"{record_id}.json").write_text(json.dumps(dispatch))
            manifest = {
                "scan_run_id": "run",
                "incident_causal_inputs_v1": {
                    "status": "READY_FOR_MACHINE_PRELABEL",
                    "scan_run_id": "run",
                    "incident_causal_inputs_sha256": _hash(input_path.read_bytes()),
                },
                "incident_causal_prelabels_v1": {
                    "status": "MACHINE_PRELABEL_COMPLETE_PENDING_FULL_CONTEXT_REVIEW",
                    "review_bundle_count": 1,
                    "incident_causal_prelabels_sha256": _hash(checkpoint_path.read_bytes()),
                    "judge_id": judge_id,
                    "judge_configuration_sha256": config,
                    "dispatch_log_dir": str(dispatch_dir),
                },
            }
            (output / "trajectory_manifest.json").write_text(json.dumps(manifest))
            result = prepare_incident_causal_review(workspace)
            self.assertEqual(result["status"], "PENDING_HUMAN_REVIEW")
            self.assertEqual(result["review_item_count"], 1)
            self.assertFalse(result["ground_truth"])
            self.assertTrue((output / "incident_causal_review_queue_v1.jsonl").is_file())

    def test_incident_causal_review_adjudication_requires_human_bound_answers(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            queue_path = output / "incident_causal_review_queue_v1.jsonl"
            queue = {
                "review_item_id": "item", "incident_case_id_hash": "case",
                "episode_key": "episode", "goal_thread_id_hash": "root",
                "allowed_source_event_ids": ["event-1"],
                "allowed_boundary_ids": ["boundary-1"],
                "machine_classification": "DRIFT_NEAR_MISS",
                "machine_confidence": 0.8,
            }
            input_packet = {
                "incident_case_id_hash": "case", "allowed_source_event_ids": ["event-1"],
                "allowed_boundary_ids": ["boundary-1"],
            }
            input_content = json.dumps(input_packet, sort_keys=True) + "\n"
            input_path = output / "incident_causal_inputs_v1.jsonl"
            input_path.write_text(input_content)
            input_sha = _hash(input_path.read_bytes())
            queue["context_packet_sha256"] = _hash(
                json.dumps(input_packet, ensure_ascii=False, sort_keys=True)
            )
            queue_path.write_text(json.dumps(queue) + "\n")
            queue_manifest = {
                "status": "PENDING_HUMAN_REVIEW", "scan_run_id": "run",
                "review_queue_sha256": _hash(queue_path.read_bytes()),
                "review_context_sha256": input_sha,
                "review_item_count": 1,
            }
            (output / "incident_causal_review_manifest_v1.json").write_text(json.dumps(queue_manifest))
            (output / "trajectory_manifest.json").write_text(json.dumps({
                "scan_run_id": "run",
                "incident_causal_inputs_v1": {
                    "status": "READY_FOR_MACHINE_PRELABEL", "scan_run_id": "run",
                    "incident_causal_inputs_sha256": input_sha,
                },
            }))
            phase = lambda status, ids=(): {"status": status, "summary": status, "evidence_ids": list(ids)}
            answer = {
                "incident_case_id_hash": "case", "episode_key": "episode",
                "classification": "DRIFT_NEAR_MISS",
                "T0": phase("PRESENT", ["event-1"]), "T1": phase("PRESENT", ["boundary-1"]),
                "T2": phase("PRESENT", ["event-1"]), "T3": phase("ABSENT"),
                "T4": phase("ABSENT"), "T5": phase("ABSENT"),
                "compaction_caused": "YES", "wrong_action": "YES",
                "engineering_consequence": "NO",
                "ordinary_reasoning_better_explanation": "NO",
                "confidence": 0.9, "rationale": "corrected before consequence",
            }
            answers_path = workspace / "answers.json"
            answers_path.write_text(json.dumps({
                "scan_run_id": "run",
                "review_queue_sha256": _hash(queue_path.read_bytes()),
                "review_context_sha256": input_sha,
                "reviewer_type": "HUMAN_CONFIRMED",
                "answers": [answer],
            }))
            result = adjudicate_incident_causal_review(workspace, answers_path)
            self.assertEqual(result["status"], "HUMAN_ADJUDICATION_COMPLETE")
            self.assertTrue(result["human_ground_truth"])
            self.assertEqual(result["classification_counts"]["DRIFT_NEAR_MISS"], 1)
            answers_path.write_text(json.dumps({
                "scan_run_id": "run",
                "review_queue_sha256": _hash(queue_path.read_bytes()),
                "review_context_sha256": input_sha,
                "reviewer_type": "HUMAN_CONFIRMED",
                "answers": [{**answer, "ground_truth": True}],
            }))
            with self.assertRaisesRegex(ValueError, "unsupported or missing fields"):
                adjudicate_incident_causal_review(workspace, answers_path)

            queue_path.write_text(json.dumps(queue) + "\n" + json.dumps(queue) + "\n")
            (output / "incident_causal_review_manifest_v1.json").write_text(json.dumps({
                **queue_manifest,
                "review_queue_sha256": _hash(queue_path.read_bytes()),
                "review_item_count": 2,
            }))
            answers_path.write_text(json.dumps({
                "scan_run_id": "run",
                "review_queue_sha256": _hash(queue_path.read_bytes()),
                "review_context_sha256": input_sha,
                "reviewer_type": "HUMAN_CONFIRMED",
                "answers": [answer],
            }))
            with self.assertRaisesRegex(RuntimeError, "duplicate episode identities"):
                adjudicate_incident_causal_review(workspace, answers_path)

            answers_path.write_text(json.dumps({
                "scan_run_id": "run",
                "review_queue_sha256": _hash(queue_path.read_bytes()),
                "review_context_sha256": input_sha,
                "reviewer_type": "MACHINE_PRELABEL",
                "answers": [answer],
            }))
            with self.assertRaisesRegex(ValueError, "HUMAN_CONFIRMED"):
                adjudicate_incident_causal_review(workspace, answers_path)

    def test_incident_causal_triaged_adjudication_allows_auxiliary_machine_items(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            selected = {
                "review_item_id": "selected-item", "incident_case_id_hash": "selected-case",
                "episode_key": "selected-episode", "goal_thread_id_hash": "root",
                "allowed_source_event_ids": ["event-1"], "allowed_boundary_ids": ["boundary-1"],
                "machine_classification": "DRIFT_NEAR_MISS", "machine_confidence": 0.8,
            }
            auxiliary = {
                "review_item_id": "auxiliary-item", "incident_case_id_hash": "auxiliary-case",
                "episode_key": "auxiliary-episode", "goal_thread_id_hash": "root",
                "allowed_source_event_ids": ["event-2"], "allowed_boundary_ids": ["boundary-2"],
                "machine_classification": "VALID_PLAN_UPDATE", "machine_confidence": 0.9,
            }
            input_packets = [
                {"incident_case_id_hash": "selected-case", "allowed_source_event_ids": ["event-1"],
                 "allowed_boundary_ids": ["boundary-1"]},
                {"incident_case_id_hash": "auxiliary-case", "allowed_source_event_ids": ["event-2"],
                 "allowed_boundary_ids": ["boundary-2"]},
            ]
            input_content = "".join(json.dumps(row, sort_keys=True) + "\n" for row in input_packets)
            input_path = output / "incident_causal_inputs_v1.jsonl"
            input_path.write_text(input_content)
            input_sha = _hash(input_path.read_bytes())
            selected["context_packet_sha256"] = _hash(
                json.dumps(input_packets[0], ensure_ascii=False, sort_keys=True)
            )
            auxiliary["context_packet_sha256"] = _hash(
                json.dumps(input_packets[1], ensure_ascii=False, sort_keys=True)
            )
            full_queue_path = output / "incident_causal_review_queue_v1.jsonl"
            full_queue_content = "".join(json.dumps(row, sort_keys=True) + "\n" for row in (selected, auxiliary))
            full_queue_path.write_text(full_queue_content)
            full_queue_sha = _hash(full_queue_path.read_bytes())
            (output / "incident_causal_review_manifest_v1.json").write_text(json.dumps({
                "status": "PENDING_HUMAN_REVIEW", "scan_run_id": "run",
                "review_queue_sha256": full_queue_sha, "review_context_sha256": input_sha,
                "source_prelabels_sha256": "prelabels",
                "review_item_count": 2,
            }))
            (output / "trajectory_manifest.json").write_text(json.dumps({
                "scan_run_id": "run",
                "incident_causal_inputs_v1": {
                    "status": "READY_FOR_MACHINE_PRELABEL", "scan_run_id": "run",
                    "incident_causal_inputs_sha256": input_sha,
                },
            }))
            triage = {**selected, "human_review_required": True, "triage_bucket": "DRIFT_NEAR_MISS"}
            triage_path = output / "incident_causal_human_triage_queue_v1.jsonl"
            triage_path.write_text(json.dumps(triage, sort_keys=True) + "\n")
            triage_sha = _hash(triage_path.read_bytes())
            (output / "incident_causal_human_triage_manifest_v1.json").write_text(json.dumps({
                "status": "PENDING_HUMAN_REVIEW_TRIAGED", "scan_run_id": "run",
                "source_full_review_queue_sha256": full_queue_sha,
                "source_prelabels_sha256": "prelabels",
                "human_review_item_count": 1,
                "triage_queue_sha256": triage_sha,
            }))
            phase = lambda status, ids=(): {"status": status, "summary": status, "evidence_ids": list(ids)}
            answer = {
                "incident_case_id_hash": "selected-case", "episode_key": "selected-episode",
                "classification": "DRIFT_NEAR_MISS",
                "T0": phase("PRESENT", ["event-1"]), "T1": phase("PRESENT", ["boundary-1"]),
                "T2": phase("PRESENT", ["event-1"]), "T3": phase("ABSENT"),
                "T4": phase("ABSENT"), "T5": phase("ABSENT"),
                "compaction_caused": "YES", "wrong_action": "YES",
                "engineering_consequence": "NO", "ordinary_reasoning_better_explanation": "NO",
                "confidence": 0.9, "rationale": "corrected before consequence",
            }
            answers_path = workspace / "triaged-answers.json"
            answers_path.write_text(json.dumps({
                "scan_run_id": "run", "review_queue_kind": "TRIAGED",
                "review_queue_sha256": triage_sha, "review_context_sha256": input_sha,
                "reviewer_type": "HUMAN_CONFIRMED", "answers": [answer],
            }))
            result = adjudicate_incident_causal_review(workspace, answers_path)
            self.assertEqual(result["status"], "HUMAN_ADJUDICATION_TRIAGE_COMPLETE")
            self.assertEqual(result["review_scope"], "TRIAGED")
            self.assertEqual(result["review_item_count"], 1)
            self.assertEqual(result["classification_counts"], {"DRIFT_NEAR_MISS": 1})
            ground_truth = [json.loads(line) for line in (output / "incident_causal_ground_truth_v1.jsonl").read_text().splitlines()]
            self.assertEqual(len(ground_truth), 1)
            self.assertEqual(ground_truth[0]["review_queue_kind"], "TRIAGED")
            review_manifest_path = output / "incident_causal_review_manifest_v1.json"
            review_manifest = json.loads(review_manifest_path.read_text())
            review_manifest["review_context_sha256"] = "stale-context"
            review_manifest_path.write_text(json.dumps(review_manifest))
            with self.assertRaisesRegex(RuntimeError, "review context"):
                adjudicate_incident_causal_review(workspace, answers_path)

    def test_incident_fragment_inputs_cover_real_compactions_not_transport_shards(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            windows = [
                {
                    "opportunity_id_hash": "shard-1", "parent_opportunity_id_hash": "parent-a",
                    "goal_thread_id_hash": "goal", "boundary_id_hash": "boundary-a",
                    "scan_run_id": "run", "compaction_event": {"timestamp": "2026-01-01T00:00:00Z", "sequence": 10},
                },
                {
                    "opportunity_id_hash": "shard-2", "parent_opportunity_id_hash": "parent-a",
                    "goal_thread_id_hash": "goal", "boundary_id_hash": "boundary-a",
                    "scan_run_id": "run", "compaction_event": {"timestamp": "2026-01-01T00:00:00Z", "sequence": 10},
                },
                {
                    "opportunity_id_hash": "parent-b", "parent_opportunity_id_hash": "parent-b",
                    "goal_thread_id_hash": "goal", "boundary_id_hash": "boundary-b",
                    "scan_run_id": "run", "compaction_event": {"timestamp": "2026-01-01T00:01:00Z", "sequence": 20},
                },
            ]
            window_content = "".join(json.dumps(row) + "\n" for row in windows)
            (output / "trajectory_windows.jsonl").write_text(window_content)
            findings = [
                {
                    "parent_opportunity_id_hash": "parent-a", "goal_thread_id_hash": "goal",
                    "kind": "COMMITMENT", "source_event_ids": ["t0"], "topic": "scope",
                    "statement": "keep scope", "authority": "USER",
                    "action_specificity": "NOT_APPLICABLE", "discovery_directions": ["forward"],
                },
                {
                    "parent_opportunity_id_hash": "parent-a", "goal_thread_id_hash": "goal",
                    "kind": "CORRECTION_ANCHOR", "source_event_ids": ["t4"], "topic": "scope",
                    "statement": "that was wrong", "authority": "USER",
                    "action_specificity": "NOT_APPLICABLE", "discovery_directions": ["backward"],
                },
            ]
            finding_content = "".join(json.dumps(row) + "\n" for row in findings)
            (output / "trajectory_union_findings.jsonl").write_text(finding_content)
            manifest = {
                "scan_run_id": "run", "trajectory_window_count": 2,
                "trajectory_windows_sha256": hashlib.sha256(window_content.encode()).hexdigest(),
                "trajectory_union": {
                    "status": "COMPLETE",
                    "union_findings_sha256": hashlib.sha256(finding_content.encode()).hexdigest(),
                },
            }
            (output / "trajectory_manifest.json").write_text(json.dumps(manifest))
            result = prepare_incident_fragment_inputs(workspace)
            self.assertEqual(result["incident_fragment_input_count"], 2)
            packets = [json.loads(line) for line in (output / "incident_fragment_inputs.jsonl").read_text().splitlines()]
            first = next(row for row in packets if row["parent_opportunity_id_hash"] == "parent-a")
            self.assertEqual(first["opportunity_id_hash"], "parent-a")
            self.assertEqual(first["allowed_source_event_ids"], ["t0", "t4"])
            self.assertEqual(first["allowed_anchor_event_ids"], ["t4"])

    def test_incident_fragment_schema_and_validator_bind_source_and_anchor_evidence(self):
        packet = {
            "parent_opportunity_id_hash": "parent", "allowed_source_event_ids": ["t0", "t3", "t4"],
            "allowed_anchor_event_ids": ["t4"],
        }
        schema = incident_fragment_schema(packet)
        self.assertNotIn("uniqueItems", json.dumps(schema, sort_keys=True))
        fragment_schema = schema["properties"]["fragments"]["items"]
        self.assertEqual(fragment_schema["properties"]["source_event_ids"]["items"]["enum"], ["t0", "t3", "t4"])
        self.assertEqual(fragment_schema["properties"]["anchor_event_ids"]["items"]["enum"], ["t4"])
        valid = {
            "parent_opportunity_id_hash": "parent", "confidence": 0.8,
            "fragments": [{
                "topic": "scope", "summary": "possible mismatch", "source_event_ids": ["t0", "t3", "t4"],
                "anchor_event_ids": ["t4"], "signal_kinds": ["COMMITMENT", "CANDIDATE_ACTION", "CORRECTION_ANCHOR"],
                "needs_earlier_link": True, "needs_later_link": False,
            }],
        }
        validate_incident_fragment_result(packet, valid)
        invalid = json.loads(json.dumps(valid))
        invalid["fragments"][0]["anchor_event_ids"] = ["t3"]
        with self.assertRaisesRegex(ValueError, "non-anchor"):
            validate_incident_fragment_result(packet, invalid)
        repeated_kind = json.loads(json.dumps(valid))
        repeated_kind["fragments"][0]["signal_kinds"] = ["COMMITMENT", "COMMITMENT"]
        with self.assertRaisesRegex(ValueError, "signal kinds"):
            validate_incident_fragment_result(packet, repeated_kind)
        normalized = _deduplicate_incident_fragment_ids(repeated_kind)
        validate_incident_fragment_result(packet, normalized)
        self.assertEqual(normalized["fragments"][0]["signal_kinds"], ["COMMITMENT"])

    def test_incident_link_inputs_merge_shared_evidence_and_preserve_complete_partition(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "data/screening"
            output.mkdir(parents=True)
            inputs = [
                {"parent_opportunity_id_hash": "p1", "goal_thread_id_hash": "root",
                 "boundary_sequence": 10, "boundary_timestamp": "2026-08-18T00:00:00Z"},
                {"parent_opportunity_id_hash": "p2", "goal_thread_id_hash": "root",
                 "boundary_sequence": 20, "boundary_timestamp": "2026-08-18T00:01:00Z"},
            ]
            results = [
                {"parent_opportunity_id_hash": "p1", "fragments": [
                    {"topic": "scope", "summary": "original constraint", "source_event_ids": ["e1"],
                     "anchor_event_ids": [], "signal_kinds": ["COMMITMENT"],
                     "needs_earlier_link": False, "needs_later_link": True},
                ]},
                {"parent_opportunity_id_hash": "p2", "fragments": [
                    {"topic": "scope", "summary": "later action", "source_event_ids": ["e1", "e2"],
                     "anchor_event_ids": ["e2"], "signal_kinds": ["CANDIDATE_ACTION", "CORRECTION_ANCHOR"],
                     "needs_earlier_link": True, "needs_later_link": False},
                    {"topic": "other", "summary": "unrelated", "source_event_ids": ["e3"],
                     "anchor_event_ids": [], "signal_kinds": ["TOPIC_ACTIVATION"],
                     "needs_earlier_link": False, "needs_later_link": False},
                ]},
            ]
            input_content = "".join(json.dumps(row, sort_keys=True) + "\n" for row in inputs)
            result_content = "".join(json.dumps(row, sort_keys=True) + "\n" for row in results)
            (output / "incident_fragment_inputs.jsonl").write_text(input_content)
            (output / "incident_fragment_results.jsonl").write_text(result_content)
            (output / "trajectory_manifest.json").write_text(json.dumps({
                "scan_run_id": "scan",
                "incident_fragment_inputs": {
                    "incident_fragment_inputs_sha256": hashlib.sha256(input_content.encode()).hexdigest(),
                },
                "incident_fragment_grading": {
                    "status": "COMPLETE",
                    "incident_fragment_results_sha256": hashlib.sha256(result_content.encode()).hexdigest(),
                },
            }))
            prepared = prepare_incident_link_inputs(Path(tmp))
            self.assertEqual(prepared["incident_component_count"], 2)
            packets = [json.loads(line) for line in (output / "incident_link_inputs_v3.jsonl").read_text().splitlines()]
            self.assertEqual(len(packets), 1)
            self.assertEqual(sum(len(row["components"]) for row in packets), 2)
            merged = next(row for row in packets[0]["components"] if row["fragment_count"] == 2)
            self.assertEqual(merged["first_boundary_sequence"], 10)
            self.assertEqual(merged["last_boundary_sequence"], 20)
            self.assertEqual(set(merged["signal_kinds"]), {"COMMITMENT", "CANDIDATE_ACTION", "CORRECTION_ANCHOR"})

    def test_incident_link_result_must_partition_every_component_once(self):
        packet = {
            "link_packet_id_hash": "packet", "allowed_component_ids": ["a", "b", "c"],
        }
        schema = incident_link_schema(packet)
        self.assertNotIn("uniqueItems", json.dumps(schema, sort_keys=True))
        self.assertEqual(
            schema["properties"]["assignments"]["required"],
            ["a", "b", "c"],
        )
        self.assertEqual(
            set(schema["properties"]["assignments"]["properties"]), {"a", "b", "c"},
        )
        valid = {
            "link_packet_id_hash": "packet",
            "clusters": [
                {"topic": "one", "summary": "same episode", "component_ids": ["a", "b"],
                 "needs_cross_shard_link": False, "confidence": 0.9},
                {"topic": "two", "summary": "separate episode", "component_ids": ["c"],
                 "needs_cross_shard_link": True, "confidence": 0.7},
            ],
        }
        validate_incident_link_result(packet, valid)
        duplicate = json.loads(json.dumps(valid))
        duplicate["clusters"][1]["component_ids"] = ["b", "c"]
        with self.assertRaisesRegex(ValueError, "partition"):
            validate_incident_link_result(packet, duplicate)
        missing = json.loads(json.dumps(valid))
        missing["clusters"] = missing["clusters"][:1]
        with self.assertRaisesRegex(ValueError, "partition"):
            validate_incident_link_result(packet, missing)
        converted = _assignments_to_incident_link_result(packet, {
            "link_packet_id_hash": "packet",
            "assignments": {
                "a": {"event_key": "scope-change", "topic": "scope", "summary": "same event",
                      "needs_cross_shard_link": False, "confidence": 0.9},
                "b": {"event_key": "scope-change", "topic": "scope", "summary": "same event later",
                      "needs_cross_shard_link": True, "confidence": 0.8},
                "c": {"event_key": "test-failure", "topic": "tests", "summary": "different event",
                      "needs_cross_shard_link": False, "confidence": 0.95},
            },
        }, {})
        validate_incident_link_result(packet, converted)
        self.assertEqual(sorted(len(row["component_ids"]) for row in converted["clusters"]), [1, 2])

    def test_cross_and_goal_global_link_inputs_preserve_every_cluster_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "data/screening"
            output.mkdir(parents=True)
            first_inputs = [{
                "link_packet_id_hash": "p1", "goal_thread_id_hash": "root",
                "allowed_component_ids": ["a", "b"],
            }]
            first_results = [{
                "link_packet_id_hash": "p1", "clusters": [
                    {"event_key": "one", "topic": "scope", "summary": "first",
                     "component_ids": ["a"], "needs_cross_shard_link": True, "confidence": 0.9},
                    {"event_key": "two", "topic": "scope", "summary": "second",
                     "component_ids": ["b"], "needs_cross_shard_link": True, "confidence": 0.8},
                ],
            }]
            first_input_content = "".join(json.dumps(row) + "\n" for row in first_inputs)
            first_result_content = "".join(json.dumps(row) + "\n" for row in first_results)
            (output / "incident_link_inputs_v3.jsonl").write_text(first_input_content)
            (output / "incident_link_results_v3.jsonl").write_text(first_result_content)
            manifest = {
                "scan_run_id": "scan",
                "incident_link_inputs_v3": {"status": "READY", "incident_link_inputs_sha256": hashlib.sha256(first_input_content.encode()).hexdigest()},
                "incident_link_grading_v3": {"status": "COMPLETE", "incident_link_results_sha256": hashlib.sha256(first_result_content.encode()).hexdigest()},
            }
            (output / "trajectory_manifest.json").write_text(json.dumps(manifest))
            cross = prepare_cross_shard_incident_link_inputs(Path(tmp))
            self.assertEqual(cross["incident_component_count"], 2)
            cross_packets = [json.loads(line) for line in (output / "incident_cross_shard_inputs_v1.jsonl").read_text().splitlines()]
            self.assertEqual(sum(len(row["allowed_component_ids"]) for row in cross_packets), 2)

            cross_result = [{
                "link_packet_id_hash": cross_packets[0]["link_packet_id_hash"],
                "clusters": [
                    {"event_key": "same", "topic": "scope", "summary": "combined",
                     "component_ids": cross_packets[0]["allowed_component_ids"],
                     "needs_cross_shard_link": False, "confidence": 0.9},
                ],
            }]
            cross_result_content = "".join(json.dumps(row) + "\n" for row in cross_result)
            (output / "incident_cross_shard_results_v1.jsonl").write_text(cross_result_content)
            manifest = json.loads((output / "trajectory_manifest.json").read_text())
            manifest["incident_cross_shard_grading_v1"] = {
                "status": "COMPLETE",
                "incident_link_results_sha256": hashlib.sha256(cross_result_content.encode()).hexdigest(),
            }
            (output / "trajectory_manifest.json").write_text(json.dumps(manifest))
            global_ready = prepare_goal_global_incident_link_inputs(Path(tmp))
            self.assertEqual(global_ready["incident_component_count"], 1)
            self.assertEqual(global_ready["incident_link_input_count"], 1)
    def test_replay_reads_real_replacement_history_without_image_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rollout.jsonl"
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "s1"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "compacted", "payload": {
                    "message": "",
                    "replacement_history": [{
                        "type": "message",
                        "role": "user",
                        "content": [{"type": "input_text", "text": "Keep the approved plan. <image>{\"image_url\":\"data:image/png;base64,AAAA\"}</image>"}],
                    }],
                }},
                {"timestamp": "2026-08-16T00:02:00Z", "type": "event_msg", "payload": {"type": "agent_message", "message": "continue"}},
            ]
            content = "".join(json.dumps(row) + "\n" for row in rows).encode()
            path.write_bytes(content)
            boundary = _hash(_event_basis(rows[1], 2))
            history = _replacement_history({
                "source_path": str(path),
                "scanned_bytes": len(content),
                "scanned_prefix_sha256": hashlib.sha256(content).hexdigest(),
            }, boundary)
            self.assertEqual(len(history), 1)
            self.assertIn("Keep the approved plan", history[0]["content"])
            self.assertNotIn("data:image", history[0]["content"])
            self.assertIn("visual content unassessed", history[0]["content"])

    def test_causal_reconstruction_keeps_adjacent_target_compactions(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rollout.jsonl"
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "s1"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "response_item", "payload": {"type": "message", "role": "user", "content": "Keep constraint A."}},
                {"timestamp": "2026-08-16T00:01:30Z", "type": "response_item", "payload": {"type": "function_call", "name": "exec_command", "call_id": "before", "arguments": {"cmd": "python -m unittest"}}},
                {"timestamp": "2026-08-16T00:02:00Z", "type": "compacted", "payload": {"content": "First summary."}},
                {"timestamp": "2026-08-16T00:02:10Z", "type": "response_item", "payload": {"type": "function_call_output", "call_id": "before", "output": {"exit_code": 1, "output": "pre-boundary call completed late"}}},
                {"timestamp": "2026-08-16T00:02:20Z", "type": "response_item", "payload": {"type": "message", "role": "assistant", "content": "First plan."}},
                {"timestamp": "2026-08-16T00:02:30Z", "type": "compacted", "payload": {"content": "Second summary."}},
                {"timestamp": "2026-08-16T00:02:40Z", "type": "response_item", "payload": {"type": "message", "role": "assistant", "content": "Second plan."}},
            ]
            content = "".join(json.dumps(row) + "\n" for row in rows).encode()
            path.write_bytes(content)
            state_packets = {}
            for line_number in (4, 7):
                row = rows[line_number - 1]
                boundary = _hash(_event_basis(row, line_number))
                opportunity = f"opportunity-{line_number}"
                state_packets[opportunity] = {
                    "scan_run_id": "scan",
                    "opportunity_id_hash": opportunity,
                    "session_id_hash": _hash("s1"),
                    "source_prefix_sha256": hashlib.sha256(content).hexdigest(),
                    "cutoff": {"boundary_id_hash": boundary},
                    "pre_compaction_events": [],
                    "compaction_summary_events": [],
                    "post_compaction_plan_events": [],
                }
            packets = _causal_packets_for_session({
                "source_path": str(path),
                "scanned_bytes": len(content),
                "scanned_prefix_sha256": hashlib.sha256(content).hexdigest(),
            }, state_packets)
            self.assertEqual(
                [row["opportunity_id_hash"] for row in packets],
                ["opportunity-4", "opportunity-7"],
            )
            self.assertEqual(packets[0]["verified_engineering_outcomes"], [])

    def test_causal_reconstruction_does_not_cap_late_actions_outcomes_or_followups(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rollout.jsonl"
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "s1"}},
                {"timestamp": "2026-08-16T00:00:01Z", "type": "compacted", "payload": {"content": "summary"}},
            ]
            for index in range(25):
                rows.extend([
                    {"timestamp": f"2026-08-16T00:01:{index:02d}Z", "type": "response_item", "payload": {
                        "type": "function_call", "name": "exec_command", "call_id": f"call-{index}",
                        "arguments": {"cmd": "python -m unittest"},
                    }},
                    {"timestamp": f"2026-08-16T00:02:{index:02d}Z", "type": "response_item", "payload": {
                        "type": "function_call_output", "call_id": f"call-{index}",
                        "output": {"exit_code": 0, "output": f"result {index}"},
                    }},
                ])
            for index in range(8):
                rows.append({
                    "timestamp": f"2026-08-16T00:03:{index:02d}Z", "type": "response_item",
                    "payload": {"type": "message", "role": "user", "content": f"followup {index}"},
                })
            content = "".join(json.dumps(row) + "\n" for row in rows).encode()
            path.write_bytes(content)
            boundary = _hash(_event_basis(rows[1], 2))
            packets = _causal_packets_for_session({
                "source_path": str(path),
                "scanned_bytes": len(content),
                "scanned_prefix_sha256": hashlib.sha256(content).hexdigest(),
            }, {"opportunity": {
                "scan_run_id": "scan", "opportunity_id_hash": "opportunity",
                "session_id_hash": _hash("s1"),
                "source_prefix_sha256": hashlib.sha256(content).hexdigest(),
                "cutoff": {"boundary_id_hash": boundary},
                "pre_compaction_events": [], "compaction_summary_events": [],
                "post_compaction_plan_events": [],
            }})
            self.assertEqual(len(packets[0]["action_events"]), 25)
            self.assertEqual(len(packets[0]["verified_engineering_outcomes"]), 25)
            self.assertEqual(len(packets[0]["user_followup_events"]), 8)

    def test_semantic_event_preserves_annotation_and_complete_user_request(self):
        text = """
        # Response annotations:
        <response-annotations>[{"text":"全库搜索"}]</response-annotations>

        ## My request for Codex:

        这个全库搜索如果是在所有书里面搜索，就没有必要了。你应该只在当前打开的这一本书里面搜索。
        """

        long_tail = "尾部语义" * 200
        event = _semantic_event({
            "timestamp": "2026-08-17T00:00:00Z",
            "type": "response_item",
            "payload": {
                "id": "user-message",
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": text + long_tail}],
            },
        }, 1)

        self.assertIn("Response annotations", event["content"])
        self.assertIn('"text":"全库搜索"', event["content"])
        self.assertIn("当前打开的这一本书", event["content"])
        self.assertTrue(event["content"].endswith(long_tail))
        self.assertGreater(len(event["content"]), 280)
        self.assertTrue(event["content_complete"])

    def test_responses_transport_omits_image_bytes_but_preserves_evidence_marker(self):
        data_url = "data:image/png;base64," + ("A" * 1000)
        packet = {
            "pre_compaction_events": [{
                "evidence_id": "event-1",
                "content": (
                    "before\n<image name=[Image #1]>\n"
                    + json.dumps({"type": "input_image", "image_url": data_url, "detail": "low"})
                    + "\n</image>\nafter"
                ),
            }],
            "compaction_summary_events": [],
            "post_compaction_plan_events": [],
        }

        request_input = _responses_multimodal_input({"packet": packet})

        self.assertEqual(len(request_input), 1)
        content = request_input[0]["content"]
        self.assertEqual(len(content), 1)
        self.assertNotIn(data_url, content[0]["text"])
        self.assertIn("before", content[0]["text"])
        self.assertIn("after", content[0]["text"])
        self.assertIn("evidence_id=event-1", content[0]["text"])
        self.assertIn("visual content unassessed", content[0]["text"])
        self.assertIn(data_url, packet["pre_compaction_events"][0]["content"])

    def test_duplicate_evidence_ids_are_normalized_without_a_second_call(self):
        result = {
            "states": {"goal": [{"evidence_ids": ["pre", "pre"]}]},
            "diffs": [{
                "pre_evidence_ids": ["pre", "pre"],
                "post_evidence_ids": ["post", "post"],
            }],
        }

        normalized = _deduplicate_result_evidence_ids(result)

        self.assertEqual(normalized["states"]["goal"][0]["evidence_ids"], ["pre"])
        self.assertEqual(normalized["diffs"][0]["pre_evidence_ids"], ["pre"])
        self.assertEqual(normalized["diffs"][0]["post_evidence_ids"], ["post"])
        self.assertEqual(normalized["duplicate_evidence_ids_removed"], 3)

    def bind_review_artifacts(
        self,
        output: Path,
        *,
        overflow: int = 0,
        reviewable_population_size: int | None = None,
        cross_status: str = "COMPLETE",
    ) -> None:
        evidence = output / "evidence_cards.jsonl"
        queue = output / "user_review_queue.json"
        summary = {
            "scan_run_id": "test-run",
            "candidate_episode_overflow": overflow,
            "opportunity_population_count": len(evidence.read_text().splitlines()) + overflow,
            "cross_session_opportunity_count": 0,
            "cross_session_invalidation_mining_status": cross_status,
        }
        manifest = {
            "scan_run_id": "test-run",
            "scanner_version": "s0-v8",
            "candidate_episode_overflow": overflow,
            "opportunity_population_count": len(evidence.read_text().splitlines()) + overflow,
            "population_replayability_validated": overflow == 0,
            "cross_session_invalidation_mining_status": cross_status,
            "opportunity_population_sha256": hashlib.sha256(b"").hexdigest(),
            "cross_session_opportunity_count": 0,
            "cross_session_opportunity_population_sha256": hashlib.sha256(b"").hexdigest(),
            "evidence_cards_sha256": hashlib.sha256(evidence.read_bytes()).hexdigest(),
            "user_review_queue_sha256": hashlib.sha256(queue.read_bytes()).hexdigest(),
        }
        (output / "screening_summary.json").write_text(json.dumps(summary))
        (output / "s0_review_manifest.json").write_text(json.dumps(manifest))
        (output / "opportunity_population.jsonl").write_text("")
        (output / "cross_session_opportunity_population.jsonl").write_text("")

    def write_bound_answers(
        self,
        output: Path,
        path: Path,
        answers: list[dict],
        *,
        reviewer_type: str = "HUMAN_CONFIRMED",
        **extra: object,
    ) -> None:
        manifest = json.loads((output / "s0_review_manifest.json").read_text())
        path.write_text(json.dumps({
            "scan_run_id": manifest["scan_run_id"],
            "evidence_cards_sha256": manifest["evidence_cards_sha256"],
            "user_review_queue_sha256": manifest["user_review_queue_sha256"],
            "reviewer_type": reviewer_type,
            "answers": answers,
            **extra,
        }))

    def event(self, event_id: str, session: str, timestamp: str, content: str, **kwargs) -> CanonicalEvent:
        return CanonicalEvent(event_id, session, timestamp, 0, "user", kwargs.pop("event_type", "message"), content, **kwargs)

    def test_timestamp_requires_timezone(self):
        with self.assertRaises(ValueError):
            self.event("e", "s", "2026-01-01T00:00:00", "hello")

    def test_explicit_http_504_retries_are_capped_and_audited(self):
        packet = {"opportunity_id_hash": "op-1", "scan_run_id": "run-1"}
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            path = _claim_api_dispatch(
                directory,
                judge_id="judge",
                configuration_sha256="config",
                packet=packet,
            )
            failed = json.loads(path.read_text())
            failed.update({"status": "HTTP_ERROR_NO_RETRY", "http_status": 504})
            _secure_write(path, json.dumps(failed))

            retried = _claim_api_dispatch(
                directory,
                judge_id="judge",
                configuration_sha256="config",
                packet=packet,
                allow_http_504_retry=True,
            )
            record = json.loads(retried.read_text())
            self.assertEqual(record["judge_attempt"], 2)
            self.assertEqual(record["prior_attempts"][0]["http_status"], 504)
            record.update({"status": "HTTP_ERROR_NO_RETRY", "http_status": 504})
            _secure_write(path, json.dumps(record))
            third = _claim_api_dispatch(
                directory,
                judge_id="judge",
                configuration_sha256="config",
                packet=packet,
                allow_http_504_retry=True,
            )
            third_record = json.loads(third.read_text())
            self.assertEqual(third_record["judge_attempt"], 3)
            self.assertEqual(len(third_record["prior_attempts"]), 2)
            third_record.update({"status": "HTTP_ERROR_NO_RETRY", "http_status": 504})
            _secure_write(path, json.dumps(third_record))
            with self.assertRaisesRegex(NonRetryableJudgeError, "automatic resend is forbidden"):
                _claim_api_dispatch(
                    directory,
                    judge_id="judge",
                    configuration_sha256="config",
                    packet=packet,
                    allow_http_504_retry=True,
                )

    def test_explicit_http_502_retry_is_once_and_audited(self):
        packet = {"opportunity_id_hash": "op-502", "scan_run_id": "run-1"}
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            path = _claim_api_dispatch(
                directory, judge_id="judge", configuration_sha256="config", packet=packet,
            )
            failed = json.loads(path.read_text())
            failed.update({
                "status": "HTTP_ERROR_NO_RETRY", "http_status": 502,
                "api_request_id": "request-reached-proxy",
            })
            _secure_write(path, json.dumps(failed))
            retried = _claim_api_dispatch(
                directory, judge_id="judge", configuration_sha256="config", packet=packet,
                allow_http_502_retry=True,
            )
            record = json.loads(retried.read_text())
            self.assertEqual(record["judge_attempt"], 2)
            self.assertEqual(record["prior_attempts"], [{
                "status": "HTTP_ERROR_NO_RETRY", "judge_attempt": 1, "http_status": 502,
            }])
            record.update({"status": "HTTP_ERROR_NO_RETRY", "http_status": 502})
            _secure_write(path, json.dumps(record))
            with self.assertRaisesRegex(NonRetryableJudgeError, "automatic resend is forbidden"):
                _claim_api_dispatch(
                    directory, judge_id="judge", configuration_sha256="config", packet=packet,
                    allow_http_502_retry=True,
                )

    def test_preconnection_dns_failure_can_resume_without_claiming_dispatch(self):
        packet = {"opportunity_id_hash": "op-dns", "scan_run_id": "run-1"}
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            path = _claim_api_dispatch(
                directory,
                judge_id="judge",
                configuration_sha256="config",
                packet=packet,
            )
            failed = json.loads(path.read_text())
            failed.update({
                "status": "NOT_DISPATCHED_DNS_FAILURE",
                "transport_error_type": "gaierror",
            })
            _secure_write(path, json.dumps(failed))

            retried = _claim_api_dispatch(
                directory,
                judge_id="judge",
                configuration_sha256="config",
                packet=packet,
                allow_http_504_retry=True,
            )

            record = json.loads(retried.read_text())
            self.assertEqual(record["judge_attempt"], 2)
            self.assertEqual(record["prior_attempts"][0]["status"], "NOT_DISPATCHED_DNS_FAILURE")
            self.assertEqual(record["prior_attempts"][0]["transport_error_type"], "gaierror")

    def test_preconnection_dns_failure_does_not_consume_http_504_retry_budget(self):
        packet = {"opportunity_id_hash": "op-mixed", "scan_run_id": "run-1"}
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            path = _claim_api_dispatch(
                directory,
                judge_id="judge",
                configuration_sha256="config",
                packet=packet,
            )
            first = json.loads(path.read_text())
            first.update({"status": "HTTP_ERROR_NO_RETRY", "http_status": 504})
            _secure_write(path, json.dumps(first))

            _claim_api_dispatch(
                directory,
                judge_id="judge",
                configuration_sha256="config",
                packet=packet,
                allow_http_504_retry=True,
            )
            second = json.loads(path.read_text())
            second.update({
                "status": "NOT_DISPATCHED_DNS_FAILURE",
                "transport_error_type": "gaierror",
            })
            _secure_write(path, json.dumps(second))

            third = _claim_api_dispatch(
                directory,
                judge_id="judge",
                configuration_sha256="config",
                packet=packet,
                allow_http_504_retry=True,
            )
            third_record = json.loads(third.read_text())
            self.assertEqual(third_record["judge_attempt"], 3)
            third_record.update({"status": "HTTP_ERROR_NO_RETRY", "http_status": 504})
            _secure_write(path, json.dumps(third_record))

            fourth = _claim_api_dispatch(
                directory,
                judge_id="judge",
                configuration_sha256="config",
                packet=packet,
                allow_http_504_retry=True,
            )
            fourth_record = json.loads(fourth.read_text())
            self.assertEqual(fourth_record["judge_attempt"], 4)
            self.assertEqual(
                [attempt.get("http_status") for attempt in fourth_record["prior_attempts"]].count(504),
                2,
            )

    def test_secondary_state_judge_uses_targeted_root_balanced_review(self):
        packets = [
            {
                "opportunity_id_hash": f"{index:064x}",
                "goal_thread_id_hash": f"root-{index % 8}",
                "post_compaction_plan_events": (
                    [] if 50 <= index < 54 else [{"evidence_id": "post"}]
                ),
            }
            for index in range(60)
        ]
        primary = [
            {
                "opportunity_id_hash": packet["opportunity_id_hash"],
                "suspected_state_change": index < 3,
                "confidence": 0.5 if index in {3, 4} else 0.9,
                "assessment_status": (
                    "UNASSESSABLE"
                    if not packet["post_compaction_plan_events"]
                    else ("SUSPECT" if index < 3 else "NO_MATERIAL_CHANGE")
                ),
            }
            for index, packet in enumerate(packets)
        ]
        selected, strata, metadata = _select_secondary_state_packets(
            "scan-run", packets, primary
        )
        selected_again, strata_again, metadata_again = _select_secondary_state_packets(
            "scan-run", list(reversed(packets)), list(reversed(primary))
        )
        selected_ids = {row["opportunity_id_hash"] for row in selected}
        self.assertEqual(len(selected), 30)
        self.assertTrue({f"{index:064x}" for index in range(5)} <= selected_ids)
        self.assertEqual(metadata["no_post_control_count"], 3)
        self.assertEqual(metadata["healthy_no_material_change_count"], 22)
        self.assertEqual(metadata["distinct_goal_root_count"], 8)
        self.assertFalse(metadata["maximum_exceeded_by_mandatory_cases"])
        self.assertEqual(
            [row["opportunity_id_hash"] for row in selected],
            list(reversed([row["opportunity_id_hash"] for row in selected_again])),
        )
        self.assertEqual(strata, strata_again)
        self.assertEqual(metadata, metadata_again)

    def test_secondary_state_judge_keeps_real_controls_when_mandatory_cases_overflow(self):
        packets = [
            {
                "opportunity_id_hash": f"{index:064x}",
                "goal_thread_id_hash": f"root-{index % 8}",
                "post_compaction_plan_events": (
                    [] if 45 <= index < 50 else [{"evidence_id": "post"}]
                ),
            }
            for index in range(60)
        ]
        primary = [
            {
                "opportunity_id_hash": packet["opportunity_id_hash"],
                "suspected_state_change": index < 45,
                "confidence": 0.95,
                "assessment_status": (
                    "SUSPECT"
                    if index < 45
                    else (
                        "UNASSESSABLE"
                        if not packet["post_compaction_plan_events"]
                        else "NO_MATERIAL_CHANGE"
                    )
                ),
            }
            for index, packet in enumerate(packets)
        ]

        selected, strata, metadata = _select_secondary_state_packets(
            "scan-run", packets, primary
        )

        self.assertEqual(len(selected), 51)
        self.assertEqual(metadata["mandatory_count"], 45)
        self.assertEqual(metadata["no_post_control_count"], 3)
        self.assertEqual(metadata["healthy_no_material_change_count"], 3)
        self.assertTrue(metadata["maximum_exceeded_by_mandatory_cases"])
        self.assertEqual(
            Counter(strata.values())["no_post_control"], 3
        )
        self.assertEqual(
            Counter(strata.values())["healthy_no_material_change"], 3
        )

    def test_state_diff_top_level_is_derived_from_direct_risks(self):
        packet = {"post_compaction_plan_events": [{"evidence_id": "post"}]}
        row = {
            "assessment_status": "SUSPECT",
            "suspected_state_change": True,
            "diffs": [
                {
                    "status": "stale_reactivated",
                    "downstream_relevance": "NONE",
                }
            ],
        }
        normalized = _normalize_state_diff_top_level(packet, row)
        self.assertEqual(normalized["assessment_status"], "NO_MATERIAL_CHANGE")
        self.assertFalse(normalized["suspected_state_change"])
        self.assertTrue(normalized["top_level_normalized"])
        self.assertEqual(normalized["judge_reported_assessment_status"], "SUSPECT")

    def test_redacts_nested_secrets(self):
        clean, count = redact_value({
            "token": "abc",
            "api_usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
            "body": "api_key=secret-value password=hunter2 AKIAABCDEFGHIJKLMNOP -----BEGIN PRIVATE KEY----- private-material -----END PRIVATE KEY-----",
        })
        self.assertEqual(clean["token"], "[REDACTED]")
        self.assertNotIn("secret-value", clean["body"])
        self.assertEqual(clean["api_usage"]["total_tokens"], 15)
        self.assertNotIn("hunter2", clean["body"])
        self.assertNotIn("AKIAABCDEFGHIJKLMNOP", clean["body"])
        self.assertNotIn("private-material", clean["body"])
        self.assertGreaterEqual(count, 5)
        hyphen_key, hyphen_count = redact_value("token sk-example0123456789abcdef")
        self.assertEqual(hyphen_key, "token [REDACTED]")
        self.assertEqual(hyphen_count, 1)

    def test_source_is_stable_and_lists_sessions(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            path.write_text(json.dumps({"session_id": "s1"}) + "\n")
            source = JsonExportSource(path)
            self.assertEqual(source.list_sessions(), ["s1"])
            self.assertTrue(source.discover()["read_only_verified"])

    def test_incremental_state_preserves_supersession(self):
        events = [
            self.event("e1", "s", "2026-01-01T00:00:00Z", "GOAL: old"),
            self.event("e2", "s", "2026-01-01T00:01:00Z", "GOAL: new"),
        ]
        items = update_state(events)
        self.assertEqual(items[0].status, "superseded")
        self.assertEqual(items[1].supersedes, items[0].state_item_id)

    def test_ingestion_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "events.jsonl"
            source.write_text(json.dumps({"session_id": "s", "timestamp": "2026-01-01T00:00:00Z", "actor": "user", "content": "hello"}) + "\n")
            workspace = root / "out"
            ingest(source, workspace)
            ingest(source, workspace)
            with sqlite3.connect(workspace / "data/index.sqlite") as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 1)

    def test_missing_session_is_rejected_and_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "events.jsonl"
            source.write_text(json.dumps({
                "timestamp": "2026-01-01T00:00:00Z",
                "actor": "user",
                "content": "missing session",
            }) + "\n")
            report = ingest(source, root / "out")
            self.assertEqual(report["accepted_events"], 0)
            self.assertEqual(report["rejected_events"], 1)
            self.assertIn("session_id", report["errors"][0]["error"])

    def test_reusing_workspace_replaces_stale_index_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_a = root / "a.jsonl"
            source_b = root / "b.jsonl"
            source_a.write_text("".join(json.dumps({
                "session_id": "old",
                "timestamp": f"2026-01-01T00:0{minute}:00Z",
                "actor": "user",
                "content": "old",
            }) + "\n" for minute in range(2)))
            source_b.write_text(json.dumps({
                "session_id": "new",
                "timestamp": "2026-01-02T00:00:00Z",
                "actor": "user",
                "content": "new",
            }) + "\n")
            workspace = root / "out"
            ingest(source_a, workspace)
            ingest(source_b, workspace)
            with sqlite3.connect(workspace / "data/index.sqlite") as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 1)
                self.assertEqual(db.execute("SELECT session_id FROM sessions").fetchall(), [("new",)])

    def test_pipeline_detects_cross_session_invalidation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "events.jsonl"
            rows = [
                {"session_id": "a", "timestamp": "2026-01-01T00:00:00Z", "actor": "agent", "content": "PLAN: edit runtime\nDEPENDS: src/runtime.py"},
                {"session_id": "b", "timestamp": "2026-01-01T00:01:00Z", "actor": "agent", "event_type": "file_change", "content": "changed API", "file_paths": ["src/runtime.py"]},
                {"session_id": "a", "timestamp": "2026-01-01T00:02:00Z", "actor": "user", "content": "你忘了我们之前已经决定"},
            ]
            source.write_text("".join(json.dumps(row) + "\n" for row in rows))
            counts = run(source, root / "out")
            self.assertEqual(counts["invalidations"], 1)
            self.assertEqual(counts["drift_candidates"], 1)
            decision = json.loads((root / "out/data/reports/decision.json").read_text())
            self.assertEqual(decision["temporal_state_consistency"]["decision"], "INSUFFICIENT_EVIDENCE")

    def test_discovery_writes_redacted_phase_0a_manifests_without_mutating_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            codex_home = root / ".codex"
            sessions = codex_home / "sessions/2026/08/16"
            sessions.mkdir(parents=True)
            rollout = sessions / "rollout-test.jsonl"
            rollout.write_text("".join([
                json.dumps({
                    "timestamp": "2026-08-16T00:00:00Z",
                    "type": "session_meta",
                    "payload": {"id": "session-1", "cwd": "/private/project"},
                }) + "\n",
                json.dumps({
                    "timestamp": "2026-08-16T00:00:01Z",
                    "type": "response_item",
                    "payload": {"type": "message", "content": "api_key=must-not-leak"},
                }) + "\n",
            ]))
            before = hashlib.sha256(rollout.read_bytes()).hexdigest()

            workspace = root / "workspace"
            result = discover_codex_environment(
                workspace,
                codex_home=codex_home,
                codex_executable=root / "missing-codex",
            )

            manifests = workspace / "data/manifests"
            required = {
                "source_manifest.json",
                "storage_candidates.json",
                "selected_adapter.json",
                "schema_signature.json",
                "discovery_log.jsonl",
            }
            self.assertEqual({path.name for path in manifests.iterdir()}, required)
            self.assertEqual(result["selected_adapter"], "codex_rollout_jsonl_v1")
            self.assertEqual(hashlib.sha256(rollout.read_bytes()).hexdigest(), before)
            persisted = "".join(path.read_text() for path in manifests.iterdir())
            self.assertNotIn("must-not-leak", persisted)
            self.assertNotIn("api_key", persisted)

            candidates = json.loads((manifests / "storage_candidates.json").read_text())["candidates"]
            official = next(row for row in candidates if row["name"] == "official_app_server_v2")
            self.assertFalse(official["runtime_read_verified"] if "runtime_read_verified" in official else False)

    def test_discovery_fails_closed_for_unknown_history_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            codex_home = root / ".codex"
            sessions = codex_home / "sessions"
            sessions.mkdir(parents=True)
            (sessions / "unknown.jsonl").write_text(json.dumps({"unexpected": "shape"}) + "\n")

            result = discover_codex_environment(
                root / "workspace",
                codex_home=codex_home,
                codex_executable=root / "missing-codex",
            )

            self.assertIsNone(result["selected_adapter"])
            selected = json.loads((root / "workspace/data/manifests/selected_adapter.json").read_text())
            self.assertEqual(selected["status"], "insufficient_evidence")

    def test_protocol_freeze_records_hypothesis_specific_thresholds(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            initialize(workspace)

            protocol = workspace / "protocol"
            self.assertEqual(
                {path.name for path in protocol.iterdir()},
                {
                    "protocol_v1.md",
                    "hypotheses_v1.json",
                    "metrics_v1.json",
                    "decision_thresholds_v1.json",
                    "screening_v1.json",
                    "screening_sampling_amendment_v2.json",
                    "semantic_grading_amendment_v3.json",
                },
            )
            thresholds = json.loads((protocol / "decision_thresholds_v1.json").read_text())
            self.assertEqual(thresholds["H5"]["minimum_auroc"], 0.70)
            self.assertEqual(thresholds["H8"]["minimum_precision"], 0.80)
            self.assertEqual(thresholds["H8"]["maximum_false_pause_rate"], 0.10)
            self.assertEqual(thresholds["default_without_completed_replays"], "INSUFFICIENT_EVIDENCE")
            screening = json.loads((protocol / "screening_v1.json").read_text())
            self.assertEqual(screening["allowed_decisions"], ["STOP", "PIVOT", "PROCEED_TO_CONFIRMATION"])
            self.assertEqual(screening["S0"]["maximum_eligible_sessions"], 100)
            self.assertEqual(screening["S0"]["stop_if_confirmed_type_abc_below"], 5)
            sampling = json.loads((protocol / "screening_sampling_amendment_v2.json").read_text())
            self.assertEqual(sampling["preferred_goal_minimum_seconds"], 7200)
            self.assertEqual(sampling["gate_changes"], "none")
            self.assertEqual(sampling["opportunity_population"]["keyword_rules"], "ranking_only_not_population_definition")
            self.assertIn("not a human-equivalent", sampling["duration_semantics"])
            semantic = json.loads((protocol / "semantic_grading_amendment_v3.json").read_text())
            self.assertEqual(semantic["S0a"]["name"], "evidence_infrastructure")
            self.assertEqual(semantic["S0b"]["state_diff_coverage"], "every compaction opportunity")
            self.assertFalse(semantic["S0b"]["machine_judges_are_ground_truth"])
            self.assertIn("do not truncate or redact", semantic["S0b"]["user_message_serialization"])
            self.assertTrue((workspace / "data/manifests/capability_manifest.json").is_file())

    def test_s0_screening_keeps_candidates_uncertain_and_does_not_persist_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rollout = sessions / "rollout.jsonl"
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "s1", "cwd": "/private/repo"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "event_msg", "payload": {"type": "context_compacted"}},
                {"timestamp": "2026-08-16T00:02:00Z", "type": "response_item", "payload": {"id": "e3", "type": "message", "role": "user", "content": "你忘了 original plan; api_key=must-not-persist; git revert"}},
            ]
            rollout.write_text("".join(json.dumps(row) + "\n" for row in rows))

            result = run_s0_screening(root / "out", [sessions], max_sessions=1)

            self.assertEqual(result["eligible_sessions"], 1)
            self.assertEqual(result["candidate_decision_points"], 1)
            self.assertIsNone(result["decision"])
            self.assertEqual(result["status"], "PENDING_EVIDENCE_REVIEW")
            persisted = "".join(path.read_text() for path in (root / "out/data/screening").iterdir())
            self.assertNotIn("must-not-persist", persisted)
            self.assertNotIn("original plan", persisted)
            self.assertIn('"classification": "uncertain"', persisted)
            self.assertEqual((root / "out/data/screening").stat().st_mode & 0o777, 0o700)
            self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in (root / "out/data/screening").iterdir()))

    def test_s0_excludes_guardian_sessions_and_does_not_treat_turn_settings_as_compaction(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            main_rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "main", "cwd": "/repo", "source": "vscode"}},
                *[
                    {"timestamp": f"2026-08-16T00:{index // 60:02d}:{index % 60:02d}Z", "type": "response_item", "payload": {"id": f"m{index}", "type": "message", "role": "assistant", "content": "ordinary work"}}
                    for index in range(100)
                ],
                {"timestamp": "2026-08-16T01:41:00Z", "type": "turn_context", "payload": {"summary": "auto", "cwd": "/repo"}},
                {"timestamp": "2026-08-16T01:42:00Z", "type": "response_item", "payload": {"id": "correction", "type": "message", "role": "user", "content": "你忘了 the requirement"}},
            ]
            (sessions / "main.jsonl").write_text("".join(json.dumps(row) + "\n" for row in main_rows))
            guardian_rows = [
                {"timestamp": "2026-08-16T02:00:00Z", "type": "session_meta", "payload": {"id": "guardian", "cwd": "/repo", "source": {"subagent": {"other": "guardian"}}}},
                {"timestamp": "2026-08-16T02:01:00Z", "type": "compacted", "payload": {"message": "summary"}},
                {"timestamp": "2026-08-16T02:02:00Z", "type": "response_item", "payload": {"id": "quoted", "type": "message", "role": "user", "content": "quoted transcript says tests failed and git reset"}},
            ]
            (sessions / "guardian.jsonl").write_text("".join(json.dumps(row) + "\n" for row in guardian_rows))

            result = run_s0_screening(root / "out", [sessions], max_sessions=2)

            self.assertEqual(result["eligible_sessions"], 1)
            self.assertEqual(result["auxiliary_sessions_excluded"], 1)
            eligible = json.loads((root / "out/data/screening/eligible_sessions.jsonl").read_text())
            self.assertEqual(eligible["session_id"], "main")
            self.assertEqual(eligible["compaction_count_scanned"], 0)
            self.assertEqual(eligible["summary_count_scanned"], 0)
            self.assertEqual((root / "out/data/screening/candidate_decision_points.jsonl").read_text(), "")

    def test_s0_ignores_internal_subagent_notifications_as_user_corrections(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "main", "cwd": "/repo"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "compacted", "payload": {"id": "compact"}},
                {"timestamp": "2026-08-16T00:02:00Z", "type": "response_item", "payload": {
                    "id": "notification", "type": "message", "role": "user",
                    "content": "<subagent_notification>review says rollback and 你忘了 a test</subagent_notification>",
                }},
            ]
            (sessions / "main.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))

            result = run_s0_screening(root / "out", [sessions])

            self.assertEqual(result["raw_candidate_signals"], 0)
            self.assertEqual(result["candidate_decision_points"], 1)
            candidate = json.loads((root / "out/data/screening/candidate_decision_points.jsonl").read_text())
            self.assertEqual(candidate["rule_signals"], [])
            self.assertFalse(candidate["has_observable_outcome"])

    def test_s0_excludes_auxiliary_code_review_subagents(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {
                    "id": "reviewer", "cwd": "/repo",
                    "source": {"subagent": {"thread_spawn": {
                        "parent_thread_id": "main", "agent_path": "/root/final_code_review",
                        "agent_role": "code-reviewer",
                    }}},
                }},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "compacted", "payload": {"id": "compact"}},
                {"timestamp": "2026-08-16T00:02:00Z", "type": "response_item", "payload": {
                    "id": "finding", "type": "message", "role": "assistant", "content": "rollback path is unsafe",
                }},
            ]
            (sessions / "reviewer.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))

            result = run_s0_screening(root / "out", [sessions])

            self.assertEqual(result["eligible_sessions"], 0)
            self.assertEqual(result["auxiliary_sessions_excluded"], 1)

    def test_s0_excludes_no_role_spec_review_by_terminal_task_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {
                    "id": "reviewer", "cwd": "/repo",
                    "source": {"subagent": {"thread_spawn": {
                        "parent_thread_id": "main", "agent_path": "/root/event_snapshot_spec_review2",
                    }}},
                }},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "compacted", "payload": {"id": "compact"}},
            ]
            (sessions / "reviewer.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))

            result = run_s0_screening(root / "out", [sessions])

            self.assertEqual(result["eligible_sessions"], 0)
            self.assertEqual(result["auxiliary_sessions_excluded"], 1)

    def test_s0_assistant_rollback_mention_is_not_an_engineering_consequence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "main", "cwd": "/repo"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "compacted", "payload": {"id": "compact"}},
                {"timestamp": "2026-08-16T00:02:00Z", "type": "response_item", "payload": {
                    "id": "mention", "type": "message", "role": "assistant", "content": "review the rollback behavior",
                }},
            ]
            (sessions / "main.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))

            run_s0_screening(root / "out", [sessions])

            candidate = json.loads((root / "out/data/screening/candidate_decision_points.jsonl").read_text())
            self.assertFalse(candidate["has_observable_outcome"])

    def test_s0_preserves_legitimate_user_text_next_to_internal_envelope(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "main", "cwd": "/repo"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "response_item", "payload": {"id": "state", "type": "message", "role": "user", "content": "must preserve the real constraint"}},
                {"timestamp": "2026-08-16T00:02:00Z", "type": "compacted", "payload": {"id": "compact"}},
                {"timestamp": "2026-08-16T00:03:00Z", "type": "response_item", "payload": {"id": "action", "type": "message", "role": "assistant", "content": "continue"}},
                {"timestamp": "2026-08-16T00:04:00Z", "type": "response_item", "payload": {"id": "correction", "type": "message", "role": "user", "content": "<recommended_plugins>internal</recommended_plugins> 你忘了 real constraint"}},
            ]
            (sessions / "main.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))

            result = run_s0_screening(root / "out", [sessions])

            self.assertEqual(result["raw_candidate_signals"], 1)
            opportunity = json.loads((root / "out/data/screening/opportunity_population.jsonl").read_text())
            self.assertIn("user_correction", opportunity["rule_signals"])

    def test_s0_keeps_implementation_subagent_whose_name_mentions_review_findings(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "impl", "cwd": "/repo", "source": {"subagent": {"thread_spawn": {"parent_thread_id": "main", "agent_path": "/root/luna_fix_review_findings", "agent_role": "sol_advisor_luna_implementer"}}}}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "compacted", "payload": {"id": "compact"}},
                {"timestamp": "2026-08-16T00:02:00Z", "type": "response_item", "payload": {"id": "action", "type": "message", "role": "assistant", "content": "implementation continues"}},
            ]
            (sessions / "impl.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))

            result = run_s0_screening(root / "out", [sessions])

            self.assertEqual(result["eligible_sessions"], 1)
            self.assertEqual(result["auxiliary_sessions_excluded"], 0)

    def test_s0_expected_tdd_failure_is_not_an_observable_consequence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "main", "cwd": "/repo"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "response_item", "payload": {"id": "state", "type": "message", "role": "user", "content": "must add regression coverage"}},
                {"timestamp": "2026-08-16T00:02:00Z", "type": "compacted", "payload": {"id": "compact"}},
                {"timestamp": "2026-08-16T00:03:00Z", "type": "response_item", "payload": {"id": "red", "type": "message", "role": "assistant", "content": "This red test should fail before the fix."}},
                {"timestamp": "2026-08-16T00:04:00Z", "type": "response_item", "payload": {"id": "failure", "type": "function_call_output", "output": "tests failed"}},
            ]
            (sessions / "main.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))

            run_s0_screening(root / "out", [sessions])

            opportunity = json.loads((root / "out/data/screening/opportunity_population.jsonl").read_text())
            self.assertFalse(opportunity["has_observable_outcome"])

    def test_s0_fails_closed_instead_of_truncating_a_rollout(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            (sessions / "large.jsonl").write_text("x" * 101)

            with patch("coordy.screening.MAX_SCAN_BYTES_PER_SESSION", 100):
                with self.assertRaisesRegex(RuntimeError, "fail-closed scan ceiling"):
                    run_s0_screening(root / "out", [sessions])

    def test_s0_deduplicates_compaction_episodes_before_candidate_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            first = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "s1", "cwd": "/repo-a"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "compacted", "payload": {"id": "c1", "message": "summary"}},
                *[
                    {"timestamp": f"2026-08-16T00:{index + 2:02d}:00Z", "type": "response_item", "payload": {"id": f"failure-{index}", "type": "function_call_output", "output": "tests failed"}}
                    for index in range(10)
                ],
            ]
            second = [
                {"timestamp": "2026-08-16T02:00:00Z", "type": "session_meta", "payload": {"id": "s2", "cwd": "/repo-b"}},
                {"timestamp": "2026-08-16T02:01:00Z", "type": "compacted", "payload": {"id": "c2", "message": "summary"}},
                {"timestamp": "2026-08-16T02:02:00Z", "type": "response_item", "payload": {"id": "correction", "type": "message", "role": "user", "content": "重新规划"}},
            ]
            (sessions / "first.jsonl").write_text("".join(json.dumps(row) + "\n" for row in first))
            (sessions / "second.jsonl").write_text("".join(json.dumps(row) + "\n" for row in second))

            result = run_s0_screening(root / "out", [sessions], max_sessions=2, max_candidates=2)

            self.assertEqual(result["raw_candidate_signals"], 11)
            self.assertEqual(result["opportunity_population_count"], 2)
            self.assertEqual(result["candidate_episode_overflow"], 0)
            candidates = [
                json.loads(line)
                for line in (root / "out/data/screening/candidate_decision_points.jsonl").read_text().splitlines()
            ]
            self.assertEqual({row["session_id_hash"] for row in candidates}, {
                hashlib.sha256(b"s1").hexdigest(), hashlib.sha256(b"s2").hexdigest()
            })

    def test_s0_prioritizes_multi_hour_goal_lineage_before_recent_proxies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            goal_db = root / "goals_1.sqlite"
            with sqlite3.connect(goal_db) as db:
                db.execute(
                    """CREATE TABLE thread_goals (
                        thread_id TEXT PRIMARY KEY,
                        objective TEXT NOT NULL,
                        status TEXT NOT NULL,
                        tokens_used INTEGER NOT NULL,
                        time_used_seconds INTEGER NOT NULL,
                        created_at_ms INTEGER NOT NULL,
                        updated_at_ms INTEGER NOT NULL
                    )"""
                )
                db.execute(
                    "INSERT INTO thread_goals VALUES (?, ?, ?, ?, ?, ?, ?)",
                    ("long-root", "private objective must-not-persist", "complete", 500000, 10800, 1, 2),
                )
            root_rows = [
                {"timestamp": "2026-08-01T00:00:00Z", "type": "session_meta", "payload": {"id": "long-root", "cwd": "/repo"}},
                {"timestamp": "2026-08-01T00:01:00Z", "type": "response_item", "payload": {"id": "root-work", "type": "message", "role": "assistant", "content": "ordinary root work"}},
            ]
            child_rows = [
                {
                    "timestamp": "2026-08-01T01:00:00Z",
                    "type": "session_meta",
                    "payload": {
                        "id": "long-child",
                        "cwd": "/repo",
                        "source": {"subagent": {"thread_spawn": {"parent_thread_id": "long-root", "depth": 1}}},
                    },
                },
                {"timestamp": "2026-08-01T01:01:00Z", "type": "response_item", "payload": {"id": "child-work", "type": "message", "role": "assistant", "content": "ordinary child work"}},
            ]
            recent_rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "recent-proxy", "cwd": "/other"}},
                *[
                    {"timestamp": f"2026-08-16T00:{index // 60:02d}:{index % 60:02d}Z", "type": "response_item", "payload": {"id": f"recent-{index}", "type": "message", "role": "assistant", "content": "ordinary work"}}
                    for index in range(100)
                ],
            ]
            root_path = sessions / "root.jsonl"
            child_path = sessions / "child.jsonl"
            recent_path = sessions / "recent.jsonl"
            root_path.write_text("".join(json.dumps(row) + "\n" for row in root_rows))
            child_path.write_text("".join(json.dumps(row) + "\n" for row in child_rows))
            recent_path.write_text("".join(json.dumps(row) + "\n" for row in recent_rows))
            root_path.touch()
            child_path.touch()
            recent_path.touch()

            before = hashlib.sha256(goal_db.read_bytes()).hexdigest()
            result = run_s0_screening(
                root / "out",
                [sessions],
                max_sessions=2,
                goal_db=goal_db,
                min_goal_seconds=7200,
            )

            self.assertEqual(hashlib.sha256(goal_db.read_bytes()).hexdigest(), before)
            self.assertEqual(result["eligible_sessions"], 2)
            self.assertEqual(result["goal_catalog_status"], "verified_read_only")
            self.assertEqual(result["multi_hour_goals_discovered"], 1)
            self.assertEqual(result["goal_lineage_rollouts_discovered"], 2)
            self.assertEqual(result["goal_lineage_sessions_selected"], 2)
            eligible = [
                json.loads(line)
                for line in (root / "out/data/screening/eligible_sessions.jsonl").read_text().splitlines()
            ]
            self.assertEqual({row["session_id"] for row in eligible}, {"long-root", "long-child"})
            self.assertEqual({row["goal_lineage_depth"] for row in eligible}, {0, 1})
            self.assertTrue(all(row["goal_time_used_seconds"] == 10800 for row in eligible))
            self.assertTrue(all("goal_thread_id" not in row for row in eligible))
            self.assertNotIn("must-not-persist", "".join(
                path.read_text() for path in (root / "out/data/screening").iterdir()
            ))

    def test_s0_goal_catalog_fails_closed_for_unknown_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            goal_db = root / "goals_1.sqlite"
            with sqlite3.connect(goal_db) as db:
                db.execute("CREATE TABLE unexpected (value TEXT)")

            with self.assertRaisesRegex(RuntimeError, "unsupported Goal database schema"):
                run_s0_screening(root / "out", [sessions], goal_db=goal_db)

    def test_s0_goal_catalog_snapshot_does_not_mutate_live_wal_sidecars(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            (sessions / "goal.jsonl").write_text(json.dumps({
                "type": "session_meta",
                "payload": {"id": "long-root", "cwd": "/repo"},
            }) + "\n")
            goal_db = root / "goals_1.sqlite"
            writer = sqlite3.connect(goal_db)
            try:
                writer.execute("PRAGMA journal_mode=WAL")
                writer.execute("PRAGMA wal_autocheckpoint=0")
                writer.execute(
                    """CREATE TABLE thread_goals (
                        thread_id TEXT PRIMARY KEY, status TEXT NOT NULL,
                        tokens_used INTEGER NOT NULL, time_used_seconds INTEGER NOT NULL,
                        created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
                    )"""
                )
                writer.execute("INSERT INTO thread_goals VALUES ('long-root', 'complete', 1, 10800, 1, 2)")
                writer.commit()
                source_files = [goal_db, Path(f"{goal_db}-wal"), Path(f"{goal_db}-shm")]
                before = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in source_files}

                result = run_s0_screening(root / "out", [sessions], goal_db=goal_db)

                after = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in source_files}
                self.assertEqual(after, before)
                self.assertEqual(result["multi_hour_goals_discovered"], 1)
            finally:
                writer.close()

    def test_s0_goal_catalog_rejects_duplicate_goal_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            goal_db = root / "goals_1.sqlite"
            with sqlite3.connect(goal_db) as db:
                db.execute(
                    """CREATE TABLE thread_goals (
                        thread_id TEXT, status TEXT, tokens_used INTEGER,
                        time_used_seconds INTEGER, created_at_ms INTEGER, updated_at_ms INTEGER
                    )"""
                )
                db.executemany(
                    "INSERT INTO thread_goals VALUES ('duplicate', 'complete', 1, ?, 1, 2)",
                    [(10800,), (14400,)],
                )

            with self.assertRaisesRegex(RuntimeError, "duplicate Goal thread identity"):
                run_s0_screening(root / "out", [sessions], goal_db=goal_db)

    def test_s0_goal_lineage_rejects_conflicting_parents_and_cycles(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            goal_db = root / "goals_1.sqlite"
            with sqlite3.connect(goal_db) as db:
                db.execute(
                    """CREATE TABLE thread_goals (
                        thread_id TEXT PRIMARY KEY, status TEXT, tokens_used INTEGER,
                        time_used_seconds INTEGER, created_at_ms INTEGER, updated_at_ms INTEGER
                    )"""
                )
                db.executemany(
                    "INSERT INTO thread_goals VALUES (?, 'complete', 1, 10800, 1, 2)",
                    [("root-a",), ("root-b",)],
                )

            conflicting = root / "conflicting"
            conflicting.mkdir()
            for name, parent in (("one", "root-a"), ("two", "root-b")):
                (conflicting / f"{name}.jsonl").write_text(json.dumps({
                    "type": "session_meta",
                    "payload": {
                        "id": "same-child",
                        "source": {"subagent": {"thread_spawn": {"parent_thread_id": parent}}},
                    },
                }) + "\n")
            with self.assertRaisesRegex(RuntimeError, "conflicting parent lineage"):
                run_s0_screening(root / "out-conflict", [conflicting], goal_db=goal_db)

            cyclic = root / "cyclic"
            cyclic.mkdir()
            for session, parent in (("cycle-a", "cycle-b"), ("cycle-b", "cycle-a")):
                (cyclic / f"{session}.jsonl").write_text(json.dumps({
                    "type": "session_meta",
                    "payload": {
                        "id": session,
                        "source": {"subagent": {"thread_spawn": {"parent_thread_id": parent}}},
                    },
                }) + "\n")
            with self.assertRaisesRegex(RuntimeError, "cycle in rollout lineage"):
                run_s0_screening(root / "out-cycle", [cyclic], goal_db=goal_db)

    def test_s0_balances_selected_sessions_across_multi_hour_goal_roots(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            goal_db = root / "goals_1.sqlite"
            with sqlite3.connect(goal_db) as db:
                db.execute(
                    """CREATE TABLE thread_goals (
                        thread_id TEXT PRIMARY KEY,
                        status TEXT NOT NULL,
                        tokens_used INTEGER NOT NULL,
                        time_used_seconds INTEGER NOT NULL,
                        created_at_ms INTEGER NOT NULL,
                        updated_at_ms INTEGER NOT NULL
                    )"""
                )
                db.executemany(
                    "INSERT INTO thread_goals VALUES (?, ?, ?, ?, ?, ?)",
                    [
                        ("goal-a", "complete", 1, 36000, 1, 2),
                        ("goal-b", "complete", 1, 10800, 1, 2),
                    ],
                )
            rollouts = {
                "a-root.jsonl": [
                    {"timestamp": "2026-08-01T00:00:00Z", "type": "session_meta", "payload": {"id": "goal-a", "cwd": "/repo-a"}},
                ],
                "a-child.jsonl": [
                    {"timestamp": "2026-08-01T01:00:00Z", "type": "session_meta", "payload": {"id": "goal-a-child", "cwd": "/repo-a", "source": {"subagent": {"thread_spawn": {"parent_thread_id": "goal-a", "depth": 1}}}}},
                ],
                "b-root.jsonl": [
                    {"timestamp": "2026-08-01T02:00:00Z", "type": "session_meta", "payload": {"id": "goal-b", "cwd": "/repo-b"}},
                ],
            }
            for name, rows in rollouts.items():
                (sessions / name).write_text("".join(json.dumps(row) + "\n" for row in rows))

            result = run_s0_screening(
                root / "out",
                [sessions],
                max_sessions=2,
                goal_db=goal_db,
                min_goal_seconds=7200,
            )

            eligible = [
                json.loads(line)
                for line in (root / "out/data/screening/eligible_sessions.jsonl").read_text().splitlines()
            ]
            self.assertEqual({row["session_id"] for row in eligible}, {"goal-a", "goal-b"})
            self.assertEqual(result["distinct_goal_roots_selected"], 2)
            self.assertEqual(result["root_goal_sessions_selected"], 2)
            self.assertEqual(result["child_goal_sessions_selected"], 0)

    def test_s0_keeps_first_session_meta_as_rollout_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rollout = sessions / "fork.jsonl"
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "current-session", "cwd": "/current-repo"}},
                {"timestamp": "2026-08-16T00:00:01Z", "type": "session_meta", "payload": {"id": "inherited-parent", "cwd": "/parent-repo"}},
                *[
                    {"timestamp": f"2026-08-16T00:{index // 60:02d}:{index % 60:02d}Z", "type": "response_item", "payload": {"id": f"work-{index}", "type": "message", "role": "assistant", "content": "ordinary work"}}
                    for index in range(100)
                ],
            ]
            rollout.write_text("".join(json.dumps(row) + "\n" for row in rows))

            run_s0_screening(root / "out", [sessions], max_sessions=1)

            eligible = json.loads((root / "out/data/screening/eligible_sessions.jsonl").read_text())
            self.assertEqual(eligible["session_id"], "current-session")
            self.assertEqual(eligible["repository_identity_hash"], hashlib.sha256(b"/current-repo").hexdigest())
            self.assertEqual(eligible["conflicting_session_meta_count"], 1)

    def test_s0_balances_candidate_cap_across_goal_roots(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            goal_db = root / "goals_1.sqlite"
            with sqlite3.connect(goal_db) as db:
                db.execute(
                    """CREATE TABLE thread_goals (
                        thread_id TEXT PRIMARY KEY,
                        status TEXT NOT NULL,
                        tokens_used INTEGER NOT NULL,
                        time_used_seconds INTEGER NOT NULL,
                        created_at_ms INTEGER NOT NULL,
                        updated_at_ms INTEGER NOT NULL
                    )"""
                )
                db.executemany(
                    "INSERT INTO thread_goals VALUES (?, 'complete', 1, 10800, 1, 2)",
                    [("goal-a",), ("goal-b",), ("goal-c",)],
                )
            goal_a_rows = [
                {"timestamp": "2026-08-01T00:00:00Z", "type": "session_meta", "payload": {"id": "goal-a", "cwd": "/repo-a"}},
            ]
            for index in range(5):
                goal_a_rows.extend([
                    {"timestamp": f"2026-08-01T00:{index * 2 + 1:02d}:00Z", "type": "compacted", "payload": {"id": f"compact-a-{index}"}},
                    {"timestamp": f"2026-08-01T00:{index * 2 + 2:02d}:00Z", "type": "response_item", "payload": {"id": f"signal-a-{index}", "type": "function_call_output", "output": "tests failed"}},
                ])
            rollouts = {
                "a.jsonl": goal_a_rows,
                "b.jsonl": [
                    {"timestamp": "2026-08-01T01:00:00Z", "type": "session_meta", "payload": {"id": "goal-b", "cwd": "/repo-b"}},
                    {"timestamp": "2026-08-01T01:01:00Z", "type": "compacted", "payload": {"id": "compact-b"}},
                    {"timestamp": "2026-08-01T01:02:00Z", "type": "response_item", "payload": {"id": "signal-b", "type": "message", "role": "user", "content": "你忘了 the requirement"}},
                ],
                "c.jsonl": [
                    {"timestamp": "2026-08-01T02:00:00Z", "type": "session_meta", "payload": {"id": "goal-c", "cwd": "/repo-c"}},
                    {"timestamp": "2026-08-01T02:01:00Z", "type": "compacted", "payload": {"id": "compact-c"}},
                    {"timestamp": "2026-08-01T02:02:00Z", "type": "response_item", "payload": {"id": "signal-c", "type": "message", "role": "user", "content": "你忘了 the requirement"}},
                ],
            }
            for name, rows in rollouts.items():
                (sessions / name).write_text("".join(json.dumps(row) + "\n" for row in rows))

            result = run_s0_screening(
                root / "out",
                [sessions],
                max_sessions=3,
                max_candidates=3,
                goal_db=goal_db,
            )

            candidates = [
                json.loads(line)
                for line in (root / "out/data/screening/candidate_decision_points.jsonl").read_text().splitlines()
            ]
            self.assertEqual(len({row["goal_thread_id_hash"] for row in candidates}), 3)
            self.assertEqual(result["distinct_candidate_goal_roots"], 3)

    def test_s0_deduplicates_copied_episode_across_one_goal_lineage(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            goal_db = root / "goals_1.sqlite"
            with sqlite3.connect(goal_db) as db:
                db.execute(
                    """CREATE TABLE thread_goals (
                        thread_id TEXT PRIMARY KEY,
                        status TEXT NOT NULL,
                        tokens_used INTEGER NOT NULL,
                        time_used_seconds INTEGER NOT NULL,
                        created_at_ms INTEGER NOT NULL,
                        updated_at_ms INTEGER NOT NULL
                    )"""
                )
                db.execute("INSERT INTO thread_goals VALUES ('goal-root', 'complete', 1, 10800, 1, 2)")
            for child in ("child-a", "child-b"):
                rows = [
                    {"timestamp": "2026-08-01T00:00:00Z", "type": "session_meta", "payload": {"id": child, "cwd": "/repo", "source": {"subagent": {"thread_spawn": {"parent_thread_id": "goal-root", "depth": 1}}}}},
                    {"timestamp": "2026-08-01T00:01:00Z", "type": "compacted", "payload": {"id": "copied-compact"}},
                    {"timestamp": "2026-08-01T00:02:00Z", "type": "response_item", "payload": {"id": "copied-failure", "type": "function_call_output", "output": "tests failed"}},
                ]
                (sessions / f"{child}.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))

            result = run_s0_screening(
                root / "out",
                [sessions],
                max_sessions=2,
                goal_db=goal_db,
            )

            self.assertEqual(result["raw_candidate_signals"], 2)
            self.assertEqual(result["opportunity_population_count"], 1)
            candidate = json.loads((root / "out/data/screening/candidate_decision_points.jsonl").read_text())
            self.assertEqual(candidate["cluster_observation_count"], 2)
            opportunity_text = (root / "out/data/screening/opportunity_population.jsonl").read_text()
            opportunity = json.loads(opportunity_text)
            self.assertEqual(opportunity["goal_time_used_seconds_observed"], 10800)
            self.assertNotIn("human", opportunity_text.lower())
            self.assertNotIn("goal-root", opportunity_text)

    def test_s0_enumerates_cross_session_entity_change_opportunities_without_raw_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()

            def patch(timestamp: str, call_id: str, path: str) -> dict:
                return {
                    "timestamp": timestamp,
                    "type": "event_msg",
                    "payload": {
                        "type": "patch_apply_end",
                        "call_id": call_id,
                        "turn_id": f"turn-{call_id}",
                        "success": True,
                        "status": "completed",
                        "stdout": "",
                        "stderr": "",
                        "changes": {path: {"type": "update", "content": "private source"}},
                    },
                }

            filler = [
                {
                    "timestamp": f"2026-08-16T00:00:{index:02d}Z",
                    "type": "response_item",
                    "payload": {"id": f"work-{index}", "type": "message", "role": "assistant", "content": "ordinary work"},
                }
                for index in range(60)
            ]
            filler += [
                {
                    "timestamp": f"2026-08-16T00:01:{index:02d}Z",
                    "type": "response_item",
                    "payload": {"id": f"more-{index}", "type": "message", "role": "assistant", "content": "ordinary work"},
                }
                for index in range(40)
            ]
            affected = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "affected-private-id", "cwd": "/private/shared-repo"}},
                *filler,
                patch("2026-08-16T00:02:00Z", "affected-before", "src/private_name.py"),
                patch("2026-08-16T00:06:00Z", "affected-after", "src/private_name.py"),
            ]
            changer = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "changer-private-id", "cwd": "/private/shared-repo"}},
                *filler,
                patch("2026-08-16T00:04:00Z", "external-change", "src/private_name.py"),
            ]
            (sessions / "affected.jsonl").write_text("".join(json.dumps(row) + "\n" for row in affected))
            (sessions / "changer.jsonl").write_text("".join(json.dumps(row) + "\n" for row in changer))

            result = run_s0_screening(root / "out", [sessions], max_sessions=2)

            path = root / "out/data/screening/cross_session_opportunity_population.jsonl"
            opportunities = [json.loads(line) for line in path.read_text().splitlines()]
            self.assertEqual(result["cross_session_opportunity_count"], 1)
            self.assertEqual(result["cross_session_invalidation_mining_status"], "STRUCTURAL_ENTITY_JOIN_COMPLETE")
            self.assertEqual(len(opportunities), 1)
            opportunity = opportunities[0]
            self.assertEqual(opportunity["schema_version"], 2)
            self.assertTrue(opportunity["has_pre_change_entity_change"])
            self.assertTrue(opportunity["has_external_change"])
            self.assertTrue(opportunity["has_post_change_entity_change"])
            self.assertNotIn("pre_change_dependency_event_id_hash", opportunity)
            self.assertEqual(opportunity["affected_session_id_hash"], hashlib.sha256(b"affected-private-id").hexdigest())
            persisted = path.read_text()
            self.assertNotIn("affected-private-id", persisted)
            self.assertNotIn("changer-private-id", persisted)
            self.assertNotIn("private_name.py", persisted)
            self.assertNotIn("/private/shared-repo", persisted)
            self.assertNotIn("private source", persisted)

            prepare_s0_review(root / "out")
            manifest = json.loads((root / "out/data/screening/s0_review_manifest.json").read_text())
            self.assertEqual(manifest["cross_session_opportunity_count"], 1)
            self.assertEqual(
                manifest["cross_session_opportunity_population_sha256"],
                hashlib.sha256(path.read_bytes()).hexdigest(),
            )

    def test_s0_cross_session_join_ignores_unrelated_entity_and_same_session_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()

            def rows(session_id: str, path: str, times: list[str]) -> list[dict]:
                result = [
                    {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": session_id, "cwd": "/repo"}},
                ]
                result.extend(
                    {
                        "timestamp": f"2026-08-16T00:00:{index:02d}Z",
                        "type": "response_item",
                        "payload": {"id": f"{session_id}-{index}", "type": "message", "role": "assistant", "content": "ordinary work"},
                    }
                    for index in range(100)
                )
                result.extend(
                    {
                        "timestamp": timestamp,
                        "type": "event_msg",
                        "payload": {
                            "type": "patch_apply_end", "call_id": f"{session_id}-{timestamp}",
                            "turn_id": "turn", "success": True, "status": "completed",
                            "stdout": "", "stderr": "", "changes": {path: {"type": "update"}},
                        },
                    }
                    for timestamp in times
                )
                return result

            (sessions / "one.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows(
                "one", "src/one.py", ["2026-08-16T00:02:00Z", "2026-08-16T00:06:00Z"]
            )))
            (sessions / "two.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows(
                "two", "src/two.py", ["2026-08-16T00:04:00Z"]
            )))

            result = run_s0_screening(root / "out", [sessions], max_sessions=2)

            self.assertEqual(result["cross_session_opportunity_count"], 0)
            self.assertEqual(
                (root / "out/data/screening/cross_session_opportunity_population.jsonl").read_text(),
                "",
            )

    def test_prepare_s0_review_separates_cutoff_evidence_from_outcome_and_redacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rollout = sessions / "rollout.jsonl"
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "s1", "cwd": "/private/repo"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "response_item", "payload": {"id": "goal", "type": "message", "role": "user", "content": "Keep database access in the host app."}},
                {"timestamp": "2026-08-16T00:02:00Z", "type": "event_msg", "payload": {"id": "compact", "type": "context_compacted"}},
                {"timestamp": "2026-08-16T00:03:00Z", "type": "response_item", "payload": {"id": "wrong", "type": "message", "role": "assistant", "content": "I will open the database in the extension."}},
                {"timestamp": "2026-08-16T00:04:00Z", "type": "response_item", "payload": {"id": "correction", "type": "message", "role": "user", "content": "你忘了 host-only rule; api_key=must-not-leak"}},
                {"timestamp": "2026-08-16T00:05:00Z", "type": "response_item", "payload": {"id": "result", "type": "function_call_output", "output": "tests failed after invalid extension access"}},
            ]
            rollout.write_text("".join(json.dumps(row) + "\n" for row in rows))
            workspace = root / "out"
            run_s0_screening(workspace, [sessions], max_sessions=1)

            result = prepare_s0_review(workspace, max_reviews=12)

            self.assertEqual(result["review_cards"], 1)
            self.assertEqual(result["status"], "PENDING_USER_REVIEW")
            self.assertIsNone(result["decision"])
            card = json.loads((workspace / "data/screening/evidence_cards.jsonl").read_text().splitlines()[0])
            self.assertEqual(card["cutoff"]["timestamp"], "2026-08-16T00:02:00Z")
            self.assertEqual(card["cutoff"]["maximum_allowed_event_id"], hashlib.sha256(b"compact").hexdigest())
            contemporaneous = json.dumps(card["contemporaneous_evidence"])
            retrospective = json.dumps(card["retrospective_outcome_evidence"], ensure_ascii=False)
            self.assertNotIn("tests failed", contemporaneous)
            self.assertNotIn("tests failed", retrospective)
            self.assertIn("test_failure", retrospective)
            self.assertIn("你忘了", retrospective)
            self.assertNotIn("must-not-leak", json.dumps(card))
            self.assertIn("[REDACTED]", json.dumps(card))
            self.assertEqual(card["classification"], "uncertain")
            self.assertTrue(card["evidence_completeness"]["has_pre_cutoff_state"])
            self.assertTrue(card["evidence_completeness"]["has_post_cutoff_consequence"])
            self.assertTrue(card["evidence_completeness"]["structural_opportunity"])
            template = json.loads((workspace / "data/screening/user_review_answers.json").read_text())
            self.assertEqual(len(template["answers"]), 1)

    def test_prepare_s0b_state_inputs_covers_all_opportunities_and_blinds_outcomes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "private-session", "cwd": "/private/repo"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "response_item", "payload": {"id": "constraint", "type": "message", "role": "user", "content": "Constraint: keep the database in the host app"}},
                {"timestamp": "2026-08-16T00:02:00Z", "type": "compacted", "payload": {"id": "compact", "content": "Summary: keep the database in the host app"}},
                {"timestamp": "2026-08-16T00:03:00Z", "type": "response_item", "payload": {"id": "plan", "type": "message", "role": "assistant", "content": "Plan: continue with the host-only database boundary"}},
                {"timestamp": "2026-08-16T00:04:00Z", "type": "response_item", "payload": {"id": "tool", "type": "function_call", "name": "exec_command", "arguments": "{}"}},
                {"timestamp": "2026-08-16T00:05:00Z", "type": "response_item", "payload": {"id": "failure", "type": "function_call_output", "output": "tests failed api_key=must-not-leak"}},
                {"timestamp": "2026-08-16T00:06:00Z", "type": "response_item", "payload": {"id": "correction", "type": "message", "role": "user", "content": "you forgot the host-only constraint"}},
            ]
            (sessions / "rollout.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
            workspace = root / "out"
            screening = run_s0_screening(workspace, [sessions], max_sessions=1)

            result = prepare_s0b_state_inputs(workspace)

            self.assertEqual(result["state_diff_input_count"], screening["opportunity_population_count"])
            packets = [
                json.loads(line)
                for line in (workspace / "data/screening/s0b_state_diff_inputs.jsonl").read_text().splitlines()
            ]
            self.assertEqual(len(packets), 1)
            packet = packets[0]
            self.assertEqual(packet["stage"], "S0b_SEMANTIC_GRADING")
            self.assertTrue(packet["blinding"]["engineering_outcomes_hidden"])
            text = json.dumps(packet)
            self.assertIn("host app", text)
            self.assertNotIn("tests failed", text)
            self.assertNotIn("you forgot", text)
            self.assertNotIn("must-not-leak", text)
            self.assertNotIn("private-session", text)
            self.assertNotIn("/private/repo", text)
            self.assertEqual(
                set(packet["allowed_evidence_ids"]),
                {
                    event["evidence_id"]
                    for section in ("pre_compaction_events", "compaction_summary_events", "post_compaction_plan_events")
                    for event in packet[section]
                },
            )

    def test_state_diff_validation_requires_known_evidence_ids_and_complete_taxonomy(self):
        packet = {
            "opportunity_id_hash": "opportunity",
            "allowed_evidence_ids": ["e1", "e2"],
            "pre_compaction_events": [{"evidence_id": "e1"}],
            "compaction_summary_events": [],
            "post_compaction_plan_events": [{"evidence_id": "e2"}],
        }
        valid = {
            "opportunity_id_hash": "opportunity",
            "states": {
                key: []
                for key in ("goal", "constraint", "decision", "rejected_option", "plan", "dependency", "acceptance_criteria")
            },
            "diffs": [{
                "state_type": "constraint",
                "pre_state_statement": "The constraint is active.",
                "pre_evidence_ids": ["e1"],
                "status": "preserved",
                "downstream_relevance": "NONE",
                "post_evidence_ids": ["e2"],
                "rationale": "The constraint is present before and after compaction.",
            }],
            "assessment_status": "NO_MATERIAL_CHANGE",
            "suspected_state_change": False,
            "confidence": 0.9,
        }
        valid["states"]["constraint"] = [{
            "phase": "pre_compaction",
            "statement": "The constraint is active.",
            "evidence_ids": ["e1"],
        }]
        normalized = validate_state_diff_result(packet, valid)
        self.assertEqual(normalized["diffs"][0]["status"], "preserved")

        vacuous = json.loads(json.dumps(valid))
        vacuous["diffs"] = []
        with self.assertRaisesRegex(ValueError, "earlier-to-post evidence comparison"):
            validate_state_diff_result(packet, vacuous)

        invalid = json.loads(json.dumps(valid))
        invalid["diffs"][0]["post_evidence_ids"] = ["future-event"]
        with self.assertRaisesRegex(ValueError, "unknown evidence"):
            validate_state_diff_result(packet, invalid)

        duplicate = json.loads(json.dumps(valid))
        duplicate["states"]["constraint"][0]["evidence_ids"] = ["e1", "e1"]
        with self.assertRaisesRegex(ValueError, "duplicates"):
            validate_state_diff_result(packet, duplicate)

        wrong_phase = json.loads(json.dumps(valid))
        wrong_phase["states"]["constraint"][0]["phase"] = "post_compaction_plan"
        with self.assertRaisesRegex(ValueError, "unknown evidence"):
            validate_state_diff_result(packet, wrong_phase)

        missing_state_reference = json.loads(json.dumps(valid))
        missing_state_reference["diffs"][0]["pre_evidence_ids"] = []
        with self.assertRaisesRegex(ValueError, "direct pre-state"):
            validate_state_diff_result(packet, missing_state_reference)

        summary_only_packet = json.loads(json.dumps(packet))
        summary_only_packet["allowed_evidence_ids"].append("summary")
        summary_only_packet["compaction_summary_events"] = [{"evidence_id": "summary"}]
        summary_only = json.loads(json.dumps(valid))
        summary_only["states"]["constraint"][0] = {
            "phase": "compaction_summary",
            "statement": "The summary mentions the constraint.",
            "evidence_ids": ["summary"],
        }
        summary_only["diffs"][0]["pre_evidence_ids"] = ["summary"]
        with self.assertRaisesRegex(ValueError, "unknown evidence"):
            validate_state_diff_result(summary_only_packet, summary_only)

        no_post_packet = json.loads(json.dumps(packet))
        no_post_packet["post_compaction_plan_events"] = []
        no_post_packet["allowed_evidence_ids"] = ["e1"]
        unassessable = json.loads(json.dumps(valid))
        unassessable["diffs"] = []
        unassessable["assessment_status"] = "UNASSESSABLE"
        unassessable["suspected_state_change"] = False
        validate_state_diff_result(no_post_packet, unassessable)
        unassessable["assessment_status"] = "SUSPECT"
        unassessable["suspected_state_change"] = True
        with self.assertRaisesRegex(ValueError, "directly relevant state risk"):
            validate_state_diff_result(no_post_packet, unassessable)

    def test_s0b_state_diff_runs_primary_on_every_opportunity_and_binds_second_judge_audit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "s1", "cwd": "/repo"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "response_item", "payload": {"id": "goal", "type": "message", "role": "user", "content": "Goal: keep compatibility"}},
            ]
            for index in range(3):
                rows.extend([
                    {"timestamp": f"2026-08-16T00:{index * 2 + 2:02d}:00Z", "type": "compacted", "payload": {"id": f"compact-{index}", "content": "Goal: keep compatibility"}},
                    {"timestamp": f"2026-08-16T00:{index * 2 + 3:02d}:00Z", "type": "response_item", "payload": {"id": f"plan-{index}", "type": "message", "role": "assistant", "content": "Plan: preserve compatibility"}},
                ])
            (sessions / "rollout.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
            workspace = root / "out"
            run_s0_screening(workspace, [sessions], max_sessions=1)
            prepare_s0b_state_inputs(workspace)
            smoke = prepare_s0b_state_smoke(workspace, sample_size=3, no_post_plan_quota=0)
            smoke_again = prepare_s0b_state_smoke(workspace, sample_size=3, no_post_plan_quota=0)
            self.assertEqual(smoke, smoke_again)
            self.assertEqual(smoke["smoke_input_count"], 3)
            self.assertFalse(smoke["external_transmission_completed"])
            self.assertEqual(
                smoke["smoke_inputs_sha256"],
                hashlib.sha256(
                    (workspace / "data/screening/s0b_state_smoke_inputs.jsonl").read_bytes()
                ).hexdigest(),
            )
            with self.assertRaisesRegex(RuntimeError, "cannot be overwritten"):
                prepare_s0b_state_smoke(workspace, sample_size=2, no_post_plan_quota=0)

            class FakeJudge:
                def __init__(self, judge_id: str, disagree: bool = False):
                    self.judge_id = judge_id
                    self.model = f"fake-{judge_id}"
                    self.configuration_sha256 = f"config-{judge_id}-{disagree}"
                    self.calls: list[list[str]] = []
                    self.disagree = disagree

                def grade(self, packets: list[dict]) -> list[dict]:
                    self.calls.append([packet["opportunity_id_hash"] for packet in packets])
                    results = []
                    for packet in packets:
                        earlier = packet["pre_compaction_events"][0]["evidence_id"]
                        post = packet["post_compaction_plan_events"][0]["evidence_id"]
                        results.append({
                            "opportunity_id_hash": packet["opportunity_id_hash"],
                            "states": {key: ([{
                                "phase": "pre_compaction",
                                "statement": "The goal remains active.",
                                "evidence_ids": [earlier],
                            }] if key == "goal" else []) for key in packet["required_state_types"]},
                            "diffs": [{
                                "state_type": "goal",
                                "pre_state_statement": "The goal remains active.",
                                "pre_evidence_ids": [earlier],
                                "status": "missing" if self.disagree else "preserved",
                                "downstream_relevance": "DIRECT" if self.disagree else "NONE",
                                "post_evidence_ids": [post],
                                "rationale": "Independent semantic assessment.",
                            }],
                            "assessment_status": "SUSPECT" if self.disagree else "NO_MATERIAL_CHANGE",
                            "suspected_state_change": self.disagree,
                            "confidence": 0.9,
                        })
                    return results

            primary = FakeJudge("primary")
            secondary = FakeJudge("secondary", disagree=True)
            class FlakySmokeJudge(FakeJudge):
                def __init__(self):
                    super().__init__("smoke")
                    self.failed_once = False

                def grade(self, packets: list[dict]) -> list[dict]:
                    results = super().grade(packets)
                    if not self.failed_once:
                        self.failed_once = True
                        results[0]["diffs"][0]["post_evidence_ids"] = ["unknown-evidence"]
                    return results

            smoke_judge = FlakySmokeJudge()
            with self.assertRaisesRegex(RuntimeError, "approved smoke hash"):
                run_s0b_state_smoke(
                    workspace,
                    smoke_judge,
                    "wrong-hash",
                    smoke_judge.configuration_sha256,
                )
            with self.assertRaisesRegex(RuntimeError, "judge configuration hash"):
                run_s0b_state_smoke(
                    workspace,
                    smoke_judge,
                    smoke["smoke_inputs_sha256"],
                    "wrong-configuration",
                )
            self.assertEqual(smoke_judge.calls, [])
            smoke_report = run_s0b_state_smoke(
                workspace,
                smoke_judge,
                smoke["smoke_inputs_sha256"],
                smoke_judge.configuration_sha256,
            )
            self.assertEqual(smoke_report["smoke_input_count"], 3)
            self.assertTrue(smoke_report["external_transmission_completed"])
            self.assertFalse(smoke_report["full_population_authorized"])
            self.assertEqual(sum(len(call) for call in smoke_judge.calls), 4)
            lock_path = workspace / "data/screening/.s0b_semantic_writer.lock"
            lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                with self.assertRaisesRegex(RuntimeError, "already owns"):
                    run_s0b_state_diff(workspace, primary, secondary, batch_size=2)
            finally:
                fcntl.flock(lock_fd, fcntl.LOCK_UN)
                os.close(lock_fd)
            result = run_s0b_state_diff(workspace, primary, secondary, batch_size=2)

            self.assertEqual(sum(len(call) for call in primary.calls), 3)
            self.assertGreaterEqual(sum(len(call) for call in secondary.calls), 1)
            self.assertEqual(result["primary_state_diff_count"], 3)
            self.assertEqual(result["calibration_queue_count"], 3)
            self.assertEqual(result["status"], "PENDING_HUMAN_CALIBRATION")
            manifest = json.loads((workspace / "data/screening/s0b_semantic_manifest.json").read_text())
            self.assertEqual(manifest["primary_judge_id"], "primary")
            self.assertEqual(manifest["secondary_judge_id"], "secondary")
            self.assertEqual(
                manifest["primary_state_diffs_sha256"],
                hashlib.sha256((workspace / "data/screening/s0b_primary_state_diffs.jsonl").read_bytes()).hexdigest(),
            )
            queue = json.loads(
                (workspace / "data/screening/s0b_semantic_calibration_queue.json").read_text()
            )
            self.assertEqual(len(queue), 3)
            self.assertIn("deterministic_control", {row["selection_stratum"] for row in queue})

            resumed_primary = FakeJudge("primary")
            resumed_secondary = FakeJudge("secondary", disagree=True)
            run_s0b_state_diff(
                workspace, resumed_primary, resumed_secondary, batch_size=1, workers=2
            )
            self.assertEqual(resumed_primary.calls, [])
            self.assertEqual(resumed_secondary.calls, [])

            changed_config = FakeJudge("primary")
            changed_config.configuration_sha256 = "changed-prompt-or-effort"
            with self.assertRaisesRegex(RuntimeError, "stale or mixed semantic checkpoint"):
                run_s0b_state_diff(
                    workspace, changed_config, FakeJudge("secondary", disagree=True), batch_size=1
                )

            answers_path = workspace / "state_calibration_answers.json"
            answers_path.write_text(json.dumps({
                "scan_run_id": manifest["scan_run_id"],
                "semantic_calibration_queue_sha256": manifest["semantic_calibration_queue_sha256"],
                "reviewer_type": "HUMAN_CONFIRMED",
                "answers": [
                    {
                        "opportunity_id_hash": row["opportunity_id_hash"],
                        "answer": "NO",
                    }
                    for row in queue
                ],
            }))
            calibration = adjudicate_s0b_state_calibration(workspace, answers_path)
            self.assertEqual(calibration["human_decided_cases"], 3)
            self.assertEqual(calibration["status"], "INSUFFICIENT_SEMANTIC_CALIBRATION")
            self.assertFalse(calibration["machine_judges_are_ground_truth"])

            primary_path = workspace / "data/screening/s0b_primary_state_diffs.jsonl"
            saved = [json.loads(line) for line in primary_path.read_text().splitlines()]
            saved[0]["input_packet_sha256"] = "tampered"
            primary_path.write_text("".join(json.dumps(row) + "\n" for row in saved))
            with self.assertRaisesRegex(RuntimeError, "stale or mixed semantic checkpoint"):
                run_s0b_state_diff(
                    workspace, FakeJudge("primary"), FakeJudge("secondary", disagree=True)
                )

    def test_s0b_causal_inputs_accept_only_program_verified_engineering_outcomes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            structured_result = [{
                "type": "text",
                "text": json.dumps({
                    "exit_code": 1,
                    "output": "test_preserves_constraint failed",
                    "wall_time_seconds": 0.2,
                }),
            }]
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "s1", "cwd": "/repo"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "response_item", "payload": {"id": "goal", "type": "message", "role": "user", "content": "Keep the compatibility constraint."}},
                {"timestamp": "2026-08-16T00:02:00Z", "type": "compacted", "payload": {"id": "compact", "content": "Continue implementation."}},
                {"timestamp": "2026-08-16T00:03:00Z", "type": "response_item", "payload": {"id": "plan", "type": "message", "role": "assistant", "content": "Run the compatibility test."}},
                {"timestamp": "2026-08-16T00:04:00Z", "type": "response_item", "payload": {"id": "claim", "type": "message", "role": "assistant", "content": "tests failed and I rolled back"}},
                {"timestamp": "2026-08-16T00:05:00Z", "type": "response_item", "payload": {"id": "call", "call_id": "c1", "type": "function_call", "name": "exec_command", "arguments": json.dumps({"cmd": "python -m unittest test_preserves_constraint"})}},
                {"timestamp": "2026-08-16T00:06:00Z", "type": "response_item", "payload": {"id": "result", "call_id": "c1", "type": "function_call_output", "output": structured_result}},
                {"timestamp": "2026-08-16T00:07:00Z", "type": "event_msg", "payload": {"id": "patch", "type": "patch_apply_end", "success": True, "changes": [{"path": "/repo/private.py"}]}},
                {"timestamp": "2026-08-16T00:08:00Z", "type": "response_item", "payload": {"id": "correction", "type": "message", "role": "user", "content": "Restore the compatibility constraint. <image>{\"image_url\":\"data:image/png;base64,AAAA\"}</image>"}},
            ]
            (sessions / "rollout.jsonl").write_text(
                "".join(json.dumps(row) + "\n" for row in rows)
            )
            workspace = root / "out"
            run_s0_screening(workspace, [sessions], max_sessions=1)
            prepare_s0_review(workspace, max_reviews=1)
            prepare_s0b_state_inputs(workspace)

            class SuspectJudge:
                def __init__(self, judge_id: str, *, suspect: bool = True):
                    self.judge_id = judge_id
                    self.model = f"fake-{judge_id}"
                    self.configuration_sha256 = f"config-{judge_id}"
                    self.suspect = suspect

                def grade(self, packets: list[dict]) -> list[dict]:
                    results = []
                    for packet in packets:
                        earlier = packet["pre_compaction_events"][0]["evidence_id"]
                        post = packet["post_compaction_plan_events"][0]["evidence_id"]
                        results.append({
                        "opportunity_id_hash": packet["opportunity_id_hash"],
                        "states": {key: ([{
                            "phase": "pre_compaction",
                            "statement": "The constraint remains active.",
                            "evidence_ids": [earlier],
                        }] if key == "constraint" else []) for key in packet["required_state_types"]},
                        "diffs": [{
                            "state_type": "constraint",
                            "pre_state_statement": "The constraint remains active.",
                            "pre_evidence_ids": [earlier],
                            "status": "missing" if self.suspect else "preserved",
                            "downstream_relevance": "DIRECT" if self.suspect else "NONE",
                            "post_evidence_ids": [post],
                            "rationale": (
                                "The constraint is absent after compaction."
                                if self.suspect else
                                "The constraint is preserved after compaction."
                            ),
                        }],
                        "assessment_status": "SUSPECT" if self.suspect else "NO_MATERIAL_CHANGE",
                        "suspected_state_change": self.suspect,
                        "confidence": 0.95,
                        })
                    return results

            run_s0b_state_diff(
                workspace,
                SuspectJudge("primary"),
                SuspectJudge("secondary", suspect=False),
                batch_size=1,
            )
            primary_state = json.loads(
                (workspace / "data/screening/s0b_primary_state_diffs.jsonl")
                .read_text()
                .strip()
            )
            self.assertEqual(primary_state["assessment_status"], "SUSPECT")
            eligible_path = workspace / "data/screening/eligible_sessions.jsonl"
            eligible_content = eligible_path.read_text()
            eligible_path.write_text(eligible_content + "{}\n")
            with self.assertRaisesRegex(RuntimeError, "eligible sessions"):
                prepare_s0b_causal_inputs(workspace)
            eligible_path.write_text(eligible_content)
            semantic_manifest_path = workspace / "data/screening/s0b_semantic_manifest.json"
            stale_manifest = json.loads(semantic_manifest_path.read_text())
            stale_manifest["primary_causal_sha256"] = "stale"
            stale_manifest["machine_confirmed_causal_failure_count"] = 99
            semantic_manifest_path.write_text(json.dumps(stale_manifest))
            manifest = prepare_s0b_causal_inputs(workspace)
            self.assertEqual(manifest["causal_input_count"], 1)
            self.assertNotIn("primary_causal_sha256", manifest)
            self.assertNotIn("machine_confirmed_causal_failure_count", manifest)
            causal_path = workspace / "data/screening/s0b_causal_inputs.jsonl"
            packet = json.loads(causal_path.read_text().strip())
            self.assertTrue(packet["pre_compaction_events"])
            self.assertTrue(packet["compaction_summary_events"])
            outcomes = packet["verified_engineering_outcomes"]
            self.assertEqual(
                {(row["verification_source"], row["operation_kind"]) for row in outcomes},
                {("structured_tool_result", "test"), ("patch_apply_end", "patch")},
            )
            patch_outcome = next(
                row for row in outcomes if row["verification_source"] == "patch_apply_end"
            )
            self.assertIn(
                patch_outcome["evidence_id"],
                {row["evidence_id"] for row in packet["action_events"]},
            )
            self.assertEqual(outcomes[0]["exit_code"], 1)
            self.assertIn("test_preserves_constraint failed", outcomes[0]["result_excerpt"])
            serialized = causal_path.read_text()
            self.assertNotIn(
                "tests failed and I rolled back", json.dumps(outcomes, sort_keys=True)
            )
            self.assertNotIn("/repo/private.py", serialized)
            self.assertNotIn("data:image/png;base64", serialized)
            self.assertEqual(causal_path.stat().st_mode & 0o777, 0o600)

            class CausalJudge:
                def __init__(self, judge_id: str):
                    self.judge_id = judge_id
                    self.model = f"fake-{judge_id}"
                    self.configuration_sha256 = f"config-{judge_id}"

                def grade(self, packets: list[dict]) -> list[dict]:
                    return [{
                        "opportunity_id_hash": item["opportunity_id_hash"],
                        "wrong_action": "YES",
                        "engineering_consequence": "VERIFIED",
                        "caused_by_state_loss": "YES",
                        "ordinary_reasoning_alternative": "The implementation may independently be wrong.",
                        "failure_type": "A",
                        "counterfactual": "Replay with the missing constraint restored.",
                        "evidence_ids": [
                            item["action_events"][0]["evidence_id"],
                            item["verified_engineering_outcomes"][0]["evidence_id"],
                        ],
                        "confidence": 0.9,
                    } for item in packets]

            result = run_s0b_causal_judges(
                workspace, CausalJudge("primary-causal"), CausalJudge("secondary-causal")
            )
            self.assertEqual(result["machine_confirmed_causal_failure_count"], 1)
            self.assertEqual(result["status"], "PENDING_HUMAN_CAUSAL_REVIEW")
            self.assertFalse(result["machine_judges_are_ground_truth"])

            queue_path = workspace / "data/screening/s0b_causal_human_review_queue.json"
            queue = json.loads(queue_path.read_text())
            causal_chain = queue[0]["causal_chain"]
            self.assertTrue(causal_chain["T0_pre_compaction_state"])
            self.assertTrue(causal_chain["T1_compaction_summary"])
            self.assertTrue(causal_chain["T2_post_compaction_plan_or_judgment"])
            self.assertTrue(causal_chain["T3_actual_action"])
            self.assertTrue(causal_chain["T4_program_verified_outcome"])
            self.assertIn("evidence_id", causal_chain["T1_compaction_summary"][0])
            answers_path = workspace / "causal_answers.json"
            answers_path.write_text(json.dumps({
                "scan_run_id": result["scan_run_id"],
                "causal_human_review_queue_sha256": result["causal_human_review_queue_sha256"],
                "reviewer_type": "HUMAN_CONFIRMED",
                "answers": [
                    {"opportunity_id_hash": row["opportunity_id_hash"], "answer": "YES"}
                    for row in queue
                ],
            }))
            causal_calibration = adjudicate_s0b_causal_review(workspace, answers_path)
            self.assertEqual(causal_calibration["human_confirmed_causal_failures"], 1)
            self.assertEqual(causal_calibration["human_confirmed_type_abc"], 1)
            self.assertEqual(causal_calibration["status"], "INSUFFICIENT_CAUSAL_CALIBRATION")
            evidence_card = json.loads(
                (workspace / "data/screening/evidence_cards.jsonl").read_text().strip()
            )
            self.assertEqual(evidence_card["system_classification"]["status"], "CLASSIFIED")
            self.assertEqual(evidence_card["system_classification"]["failure_type"], "A")

            invalid = CausalJudge("invalid").grade([packet])[0]
            invalid["evidence_ids"] = [packet["action_events"][0]["evidence_id"]]
            with self.assertRaisesRegex(ValueError, "program-verified outcome"):
                validate_causal_result(packet, invalid)

            missing_action = CausalJudge("missing-action").grade([packet])[0]
            missing_action["evidence_ids"] = [
                packet["verified_engineering_outcomes"][0]["evidence_id"]
            ]
            with self.assertRaisesRegex(ValueError, "actual post-compaction action"):
                validate_causal_result(
                    {**packet, "action_events": []}, missing_action
                )

    def test_secure_write_preserves_previous_checkpoint_if_replace_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "checkpoint.jsonl"
            _secure_write(path, "saved\n")
            with patch("coordy.semantic.os.replace", side_effect=OSError("interrupted")):
                with self.assertRaisesRegex(OSError, "interrupted"):
                    _secure_write(path, "new\n")
            self.assertEqual(path.read_text(), "saved\n")

    def test_human_causal_chain_does_not_retruncate_bound_t0_t5_sections(self):
        events = [{"evidence_id": f"event-{index}", "redacted_excerpt": str(index)} for index in range(20)]
        packet = {
            "pre_compaction_events": events,
            "compaction_summary_events": events[:2],
            "post_compaction_plan_events": events[:3],
            "action_events": events,
            "verified_engineering_outcomes": events,
            "user_followup_events": events[:5],
        }
        chain = _human_causal_chain(packet)
        self.assertEqual(len(chain["T0_pre_compaction_state"]), 20)
        self.assertEqual(len(chain["T3_actual_action"]), 20)
        self.assertEqual(len(chain["T4_program_verified_outcome"]), 20)
        self.assertEqual(chain["T0_pre_compaction_state"][-1]["evidence_id"], "event-19")

    def test_state_smoke_selection_is_reproducible_and_goal_root_balanced(self):
        packets = []
        for index in range(20):
            packets.append({
                "opportunity_id_hash": f"{index:064x}",
                "goal_thread_id_hash": f"root-{index % 8}",
                "post_compaction_plan_events": [] if index < 3 else [{"evidence_id": "post"}],
            })
        first = _select_state_smoke_packets(packets)
        second = _select_state_smoke_packets(list(reversed(packets)))
        self.assertEqual(
            [row["opportunity_id_hash"] for row in first],
            [row["opportunity_id_hash"] for row in second],
        )
        self.assertEqual(len(first), 12)
        self.assertEqual(sum(not row["post_compaction_plan_events"] for row in first), 3)
        self.assertEqual(len({row["goal_thread_id_hash"] for row in first}), 8)
        with self.assertRaisesRegex(RuntimeError, "exact frozen quotas"):
            _select_state_smoke_packets(packets[3:], no_post_plan_quota=3)
        with self.assertRaisesRegex(RuntimeError, "exact frozen quotas"):
            _select_state_smoke_packets(packets[:5], sample_size=12, no_post_plan_quota=3)

    def test_all_semantic_mutations_share_one_workspace_writer_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            lock_path = workspace / "data/screening/.s0b_semantic_writer.lock"
            lock_path.parent.mkdir(parents=True)
            descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                with self.assertRaisesRegex(RuntimeError, "already owns"):
                    prepare_s0b_state_inputs(workspace)
                with self.assertRaisesRegex(RuntimeError, "already owns"):
                    prepare_s0b_causal_inputs(workspace)
            finally:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
                os.close(descriptor)

    def test_state_judge_schema_is_singleton_and_evidence_bound(self):
        packet = {
            "opportunity_id_hash": "opportunity-1",
            "allowed_evidence_ids": ["event-1", "event-2"],
            "pre_compaction_events": [{"evidence_id": "event-1"}],
            "compaction_summary_events": [],
            "post_compaction_plan_events": [{"evidence_id": "event-2"}],
        }
        schema = _state_diff_batch_schema([packet])
        results = schema["properties"]["results"]
        self.assertEqual(results["minItems"], 1)
        self.assertEqual(results["maxItems"], 1)
        item = results["items"]
        self.assertEqual(
            item["properties"]["opportunity_id_hash"]["enum"], ["opportunity-1"]
        )
        diff_schema = item["properties"]["diffs"]
        self.assertEqual(diff_schema["minItems"], 1)
        diff_properties = diff_schema["items"]["properties"]
        self.assertEqual(
            diff_properties["pre_evidence_ids"]["items"]["enum"], ["event-1"]
        )
        self.assertEqual(
            diff_properties["post_evidence_ids"]["items"]["enum"], ["event-2"]
        )
        state_variants = item["properties"]["states"]["properties"]["goal"]["items"]["anyOf"]
        self.assertEqual(
            {
                variant["properties"]["phase"]["enum"][0]:
                variant["properties"]["evidence_ids"]["items"]["enum"]
                for variant in state_variants
            },
            {"pre_compaction": ["event-1"], "post_compaction_plan": ["event-2"]},
        )
        with self.assertRaisesRegex(ValueError, "one isolated opportunity"):
            _state_diff_batch_schema([packet, packet])

    def test_responses_api_state_judge_binds_contract_without_persisting_key(self):
        packet = {
            "opportunity_id_hash": "opportunity",
            "scan_run_id": "scan",
            "allowed_evidence_ids": ["earlier", "post"],
            "pre_compaction_events": [{"evidence_id": "earlier"}],
            "compaction_summary_events": [],
            "post_compaction_plan_events": [{"evidence_id": "post"}],
            "required_state_types": list(STATE_TYPES),
        }
        result = {
            "opportunity_id_hash": "opportunity",
            "states": {key: ([{
                "phase": "pre_compaction",
                "statement": "The goal remains active.",
                "evidence_ids": ["earlier"],
            }] if key == "goal" else []) for key in STATE_TYPES},
            "diffs": [{
                "state_type": "goal",
                "pre_state_statement": "The goal remains active.",
                "pre_evidence_ids": ["earlier"],
                "status": "preserved",
                "downstream_relevance": "NONE",
                "rationale": "The goal remains active.",
                "post_evidence_ids": ["post"],
            }],
            "assessment_status": "NO_MATERIAL_CHANGE",
            "suspected_state_change": False,
            "confidence": 0.9,
        }
        schema = _state_diff_batch_schema([packet])
        response_envelope = {
            "id": "response-id",
            "status": "completed",
            "error": None,
            "model": "gpt-5.6-luna",
            "instructions": STATE_JUDGE_INSTRUCTIONS,
            "tools": [],
            "store": False,
            "parallel_tool_calls": False,
            "text": {"format": {
                "type": "json_schema",
                "name": "coordy_state_diff",
                "strict": True,
                "schema": schema,
            }},
            "output": [{
                "type": "message",
                "content": [{
                    "type": "output_text",
                    "text": json.dumps({"results": [result]}),
                }],
            }],
            "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
        }

        class FakeResponse:
            headers = {"X-Request-Id": "request-id"}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps(response_envelope).encode()

        class FakeOpener:
            request = None
            calls = 0

            def open(self, request, timeout):
                self.calls += 1
                self.request = request
                self.timeout = timeout
                return FakeResponse()

        opener = FakeOpener()
        dispatch_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(dispatch_tmp.cleanup)
        dispatch_dir = Path(dispatch_tmp.name)
        with patch("coordy.semantic.urllib.request.build_opener", return_value=opener):
            judge = ResponsesAPIStateJudge(
                judge_id="api-state",
                api_key="fake-secret",
                base_url="https://example.invalid",
                dispatch_log_dir=dispatch_dir,
            )
            other_key_judge = ResponsesAPIStateJudge(
                judge_id="api-state",
                api_key="different-secret",
                base_url="https://example.invalid",
                dispatch_log_dir=dispatch_dir,
            )
            rows = judge.grade([packet])
            with self.assertRaisesRegex(NonRetryableJudgeError, "automatic resend"):
                judge.grade([packet])
        self.assertEqual(rows[0]["api_request_id"], "request-id")
        self.assertEqual(rows[0]["api_usage"]["total_tokens"], 15)
        self.assertEqual(judge.configuration_sha256, other_key_judge.configuration_sha256)
        request_body = json.loads(opener.request.data)
        self.assertEqual(request_body["tools"], [])
        self.assertFalse(request_body["store"])
        self.assertFalse(request_body["parallel_tool_calls"])
        self.assertNotIn("fake-secret", opener.request.data.decode())
        self.assertEqual(opener.calls, 1)
        self.assertEqual(judge.configuration["api_base_url"], "https://example.invalid")
        self.assertNotIn("fake-secret", json.dumps(judge.configuration))
        accepted_dispatch = json.loads(next(dispatch_dir.glob("*.json")).read_text())
        self.assertEqual(accepted_dispatch["request_body_bytes"], len(opener.request.data))
        self.assertEqual(
            accepted_dispatch["request_body_sha256"],
            hashlib.sha256(opener.request.data).hexdigest(),
        )

        malformed_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(malformed_tmp.cleanup)
        malformed_judge = ResponsesAPIStateJudge(
            judge_id="api-state-malformed",
            api_key="fake-secret",
            base_url="https://example.invalid",
            dispatch_log_dir=Path(malformed_tmp.name),
        )
        response_envelope["tools"] = ["unexpected"]
        with patch("coordy.semantic.urllib.request.build_opener", return_value=FakeOpener()):
            with self.assertRaisesRegex(NonRetryableJudgeError, "frozen response contract"):
                malformed_judge.grade([packet])
        response_envelope["tools"] = []
        dispatch_records = list(Path(malformed_tmp.name).glob("*.json"))
        self.assertEqual(len(dispatch_records), 1)
        failed_dispatch = json.loads(dispatch_records[0].read_text())
        self.assertEqual(failed_dispatch["status"], "HTTP_COMPLETED_UNVALIDATED")
        self.assertEqual(failed_dispatch["api_request_id"], "request-id")
        self.assertEqual(failed_dispatch["api_usage"]["total_tokens"], 15)

        semantic_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(semantic_tmp.cleanup)
        semantic_judge = ResponsesAPIStateJudge(
            judge_id="api-state-semantic-invalid",
            api_key="fake-secret",
            base_url="https://example.invalid",
            dispatch_log_dir=Path(semantic_tmp.name),
        )
        result["diffs"][0]["pre_evidence_ids"] = []
        response_envelope["output"][0]["content"][0]["text"] = json.dumps({"results": [result]})
        with patch("coordy.semantic.urllib.request.build_opener", return_value=FakeOpener()):
            with self.assertRaisesRegex(NonRetryableJudgeError, "semantic validation"):
                semantic_judge.grade([packet])
        semantic_record = json.loads(next(Path(semantic_tmp.name).glob("*.json")).read_text())
        self.assertEqual(semantic_record["status"], "SEMANTIC_VALIDATION_FAILED_NO_RETRY")
        self.assertEqual(
            semantic_record["rejected_result"][0]["diffs"][0]["pre_evidence_ids"],
            [],
        )
        result["diffs"][0]["pre_evidence_ids"] = ["earlier"]
        response_envelope["output"][0]["content"][0]["text"] = json.dumps({"results": [result]})

        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = Path(tmp) / "checkpoint.jsonl"
            checkpoint_judge = ResponsesAPIStateJudge(
                judge_id="api-state-checkpoint",
                api_key="fake-secret",
                base_url="https://example.invalid",
                dispatch_log_dir=Path(tmp) / "dispatch",
            )
            with patch("coordy.semantic.urllib.request.build_opener", return_value=opener):
                saved = _run_judge_batches(checkpoint_judge, [packet], 1, checkpoint, 1)
            self.assertEqual(saved[0]["api_request_id"], "request-id")
            self.assertNotIn("fake-secret", checkpoint.read_text())
            damaged = json.loads(checkpoint.read_text())
            damaged.pop("api_request_id")
            checkpoint.write_text(json.dumps(damaged) + "\n")
            with self.assertRaisesRegex(RuntimeError, "stale or mixed semantic checkpoint"):
                _run_judge_batches(checkpoint_judge, [packet], 1, checkpoint, 1)

    def test_judge_env_file_requires_private_exact_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env.local"
            env_file.write_text(
                "COORDY_JUDGE_API_KEY=fake-key\n"
                "COORDY_JUDGE_BASE_URL=https://example.invalid\n"
            )
            os.chmod(env_file, 0o644)
            with patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(RuntimeError, "0600"):
                    _judge_api_settings(env_file)
                os.chmod(env_file, 0o600)
                self.assertEqual(
                    _judge_api_settings(env_file),
                    ("fake-key", "https://example.invalid"),
                )

    def test_state_smoke_gate_is_safety_only_and_fails_overbroad_judge(self):
        packets = [
            {
                "opportunity_id_hash": "control",
                "post_compaction_plan_events": [],
            },
            *[
                {
                    "opportunity_id_hash": f"post-{index}",
                    "post_compaction_plan_events": [{"evidence_id": f"event-{index}"}],
                }
                for index in range(3)
            ],
        ]
        results = [{
            "opportunity_id_hash": "control",
            "assessment_status": "UNASSESSABLE",
            "suspected_state_change": False,
        }]
        results.extend({
            "opportunity_id_hash": f"post-{index}",
            "assessment_status": "SUSPECT",
            "suspected_state_change": True,
        } for index in range(3))
        gate = _evaluate_state_smoke(packets, results)
        self.assertFalse(gate["smoke_safety_gate_passed"])
        self.assertFalse(gate["accuracy_claimed"])
        self.assertEqual(gate["gate_scope"], "safety_and_evidence_binding_only")

    def test_state_smoke_forbids_parallel_external_dispatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "workers=1"):
                run_s0b_state_smoke(
                    Path(tmp),
                    object(),
                    "not-used",
                    "not-used",
                    workers=2,
                )

    def test_parallel_state_failures_preserve_other_completed_checkpoints(self):
        packets = []
        for index in range(5):
            packets.append({
                "opportunity_id_hash": f"opportunity-{index}",
                "scan_run_id": "scan",
                "allowed_evidence_ids": [f"earlier-{index}", f"post-{index}"],
                "pre_compaction_events": [{"evidence_id": f"earlier-{index}"}],
                "compaction_summary_events": [],
                "post_compaction_plan_events": [{"evidence_id": f"post-{index}"}],
                "required_state_types": list(STATE_TYPES),
            })

        class PartialFailureJudge:
            judge_id = "partial-failure"
            model = "fake"
            configuration_sha256 = "config"

            def __init__(self):
                self.calls = []

            def grade(self, batch):
                packet = batch[0]
                self.calls.append(packet["opportunity_id_hash"])
                if packet["opportunity_id_hash"] == "opportunity-1":
                    raise RuntimeError("expected isolated failure")
                index = packet["opportunity_id_hash"].rsplit("-", 1)[1]
                return [{
                    "opportunity_id_hash": packet["opportunity_id_hash"],
                    "states": {key: ([{
                        "phase": "pre_compaction",
                        "statement": "The goal remains active.",
                        "evidence_ids": [f"earlier-{index}"],
                    }] if key == "goal" else []) for key in STATE_TYPES},
                    "diffs": [{
                        "state_type": "goal",
                        "pre_state_statement": "The goal remains active.",
                        "pre_evidence_ids": [f"earlier-{index}"],
                        "status": "preserved",
                        "downstream_relevance": "NONE",
                        "rationale": "Bound comparison.",
                        "post_evidence_ids": [f"post-{index}"],
                    }],
                    "assessment_status": "NO_MATERIAL_CHANGE",
                    "suspected_state_change": False,
                    "confidence": 0.9,
                }]

        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = Path(tmp) / "checkpoint.jsonl"
            judge = PartialFailureJudge()
            with self.assertRaisesRegex(RuntimeError, "successful concurrent results"):
                _run_judge_batches(
                    judge, packets, 1, checkpoint, workers=2
                )
            saved = [json.loads(line) for line in checkpoint.read_text().splitlines()]
            self.assertEqual(
                {row["opportunity_id_hash"] for row in saved},
                {"opportunity-0"},
            )
            self.assertEqual(set(judge.calls), {"opportunity-0", "opportunity-1"})

    def test_nonretryable_judge_error_does_not_repeat_external_request(self):
        packet = {
            "opportunity_id_hash": "opportunity",
            "scan_run_id": "scan",
            "allowed_evidence_ids": ["earlier", "post"],
            "pre_compaction_events": [{"evidence_id": "earlier"}],
            "compaction_summary_events": [],
            "post_compaction_plan_events": [{"evidence_id": "post"}],
            "required_state_types": list(STATE_TYPES),
        }

        class RejectingJudge:
            judge_id = "rejecting"
            model = "test"
            configuration_sha256 = "config"
            calls = 0

            def grade(self, _packets):
                self.calls += 1
                raise NonRetryableJudgeError("authentication rejected")

        judge = RejectingJudge()
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(NonRetryableJudgeError, "authentication"):
                _run_judge_batches(
                    judge,
                    [packet],
                    1,
                    Path(tmp) / "checkpoint.jsonl",
                    1,
                )
        self.assertEqual(judge.calls, 1)

    def test_prepare_s0_review_withholds_goal_context_injected_into_rollout(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rollout = sessions / "rollout.jsonl"
            private_objective = "private objective git reset must-not-persist " + ("x" * 5000)
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "s1", "cwd": "/repo"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "response_item", "payload": {"id": "goal", "type": "message", "role": "user", "content": f"<codex_internal_context source=\"goal\"><objective>{private_objective}</objective></codex_internal_context> ordinary constraint"}},
                {"timestamp": "2026-08-16T00:02:00Z", "type": "compacted", "payload": {"id": "compact"}},
                {"timestamp": "2026-08-16T00:03:00Z", "type": "response_item", "payload": {"id": "action", "type": "message", "role": "assistant", "content": "wrong action"}},
                {"timestamp": "2026-08-16T00:04:00Z", "type": "response_item", "payload": {"id": "correction", "type": "message", "role": "user", "content": "你忘了 the constraint"}},
            ]
            rollout.write_text("".join(json.dumps(row) + "\n" for row in rows))
            workspace = root / "out"
            run_s0_screening(workspace, [sessions])

            prepare_s0_review(workspace)

            persisted = "".join(path.read_text() for path in (workspace / "data/screening").iterdir())
            self.assertNotIn(private_objective, persisted)
            self.assertNotIn("git reset", persisted)
            self.assertIn("[goal context withheld]", persisted)

    def test_prepare_s0_review_uses_latest_compaction_boundary_without_hash_guessing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rollout = sessions / "rollout.jsonl"
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "s1", "cwd": "/repo"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "response_item", "payload": {"id": "goal", "type": "message", "role": "user", "content": "preserve constraint"}},
                {"timestamp": "2026-08-16T00:02:00Z", "type": "compacted", "payload": {"id": "old-compact", "message": "old"}},
                {"timestamp": "2026-08-16T00:03:00Z", "type": "response_item", "payload": {"id": "work", "type": "message", "role": "assistant", "content": "continue"}},
                {"timestamp": "2026-08-16T00:10:00Z", "type": "event_msg", "payload": {"id": "latest-compact", "type": "context_compacted"}},
                {"timestamp": "2026-08-16T00:10:01Z", "type": "world_state", "payload": {}},
                {"timestamp": "2026-08-16T00:10:01Z", "type": "turn_context", "payload": {}},
                {"timestamp": "2026-08-16T00:10:02Z", "type": "compacted", "payload": {"id": "latest-compact-paired"}},
                {"timestamp": "2026-08-16T00:10:03Z", "type": "response_item", "payload": {"id": "developer", "type": "message", "role": "developer", "content": "internal instructions are not an agent action"}},
                {"timestamp": "2026-08-16T00:11:00Z", "type": "response_item", "payload": {"id": "action", "type": "message", "role": "assistant", "content": "wrong next action"}},
                {"timestamp": "2026-08-16T00:12:00Z", "type": "response_item", "payload": {"id": "correction", "type": "message", "role": "user", "content": "你忘了 the constraint"}},
            ]
            rollout.write_text("".join(json.dumps(row) + "\n" for row in rows))
            workspace = root / "out"
            run_s0_screening(workspace, [sessions], max_sessions=1)

            prepare_s0_review(workspace)

            cards = [json.loads(line) for line in (workspace / "data/screening/evidence_cards.jsonl").read_text().splitlines()]
            card = next(card for card in cards if card["cutoff"]["timestamp"] == "2026-08-16T00:10:02Z")
            self.assertEqual(card["cutoff"]["timestamp"], "2026-08-16T00:10:02Z")
            self.assertEqual(
                card["cutoff"]["maximum_allowed_event_id"],
                hashlib.sha256(b"latest-compact-paired").hexdigest(),
            )
            self.assertEqual(
                card["causal_chain"]["T2_post_compaction_plan_or_judgment"]["redacted_excerpt"],
                "wrong next action",
            )

    def test_prepare_s0_review_uses_complete_structural_population_before_stopping(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "s1", "cwd": "/repo"}},
                {"timestamp": "2026-08-16T00:00:01Z", "type": "response_item", "payload": {"id": "state", "type": "message", "role": "user", "content": "preserve constraint"}},
            ]
            for index in range(35):
                rows.extend([
                    {"timestamp": f"2026-08-16T00:{index + 1:02d}:00Z", "type": "compacted", "payload": {"id": f"compact-{index}"}},
                    {"timestamp": f"2026-08-16T00:{index + 1:02d}:01Z", "type": "response_item", "payload": {"id": f"mention-{index}", "type": "message", "role": "assistant", "content": "review rollback behavior"}},
                ])
                if index == 0:
                    rows.append({
                        "timestamp": "2026-08-16T00:01:02Z", "type": "response_item",
                        "payload": {"id": "correction", "type": "message", "role": "user", "content": "你忘了 the constraint"},
                    })
            (sessions / "rollout.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
            workspace = root / "out"

            screening = run_s0_screening(workspace, [sessions], max_candidates=30)
            result = prepare_s0_review(workspace)

            self.assertEqual(screening["opportunity_population_count"], 35)
            self.assertEqual(screening["candidate_episode_overflow"], 5)
            self.assertEqual(len((workspace / "data/screening/opportunity_population.jsonl").read_text().splitlines()), 35)
            self.assertIsNone(result["decision"])
            self.assertEqual(result["status"], "PENDING_USER_REVIEW")

    def test_prepare_s0_review_builds_reproducible_three_stratum_queue(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rows = [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "private-session-id", "cwd": "/private/secret-repo"}},
                {"timestamp": "2026-08-16T00:00:01Z", "type": "response_item", "payload": {"id": "state", "type": "message", "role": "user", "content": "must preserve constraint"}},
            ]
            for index in range(12):
                minute = index + 1
                rows.extend([
                    {"timestamp": f"2026-08-16T00:{minute:02d}:00Z", "type": "compacted", "payload": {"id": f"compact-{index}"}},
                    {"timestamp": f"2026-08-16T00:{minute:02d}:01Z", "type": "response_item", "payload": {"id": f"action-{index}", "type": "message", "role": "assistant", "content": "continue implementation"}},
                ])
                if index < 6:
                    rows.append({"timestamp": f"2026-08-16T00:{minute:02d}:02Z", "type": "response_item", "payload": {"id": f"failure-{index}", "type": "function_call_output", "output": "tests failed"}})
            (sessions / "rollout.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
            queues = []
            for name in ("first", "second"):
                workspace = root / name
                run_s0_screening(workspace, [sessions])
                result = prepare_s0_review(workspace)
                queue = json.loads((workspace / "data/screening/user_review_queue.json").read_text())
                queues.append([(row["candidate_id"], row["selection_stratum"]) for row in queue])
                self.assertEqual(result["selection_stratum_actual"], {
                    "high_signal": 6,
                    "recall_probe": 3,
                    "healthy_hard_negative": 3,
                })
                opportunity_text = (workspace / "data/screening/opportunity_population.jsonl").read_text()
                self.assertNotIn("private-session-id", opportunity_text)
                self.assertNotIn("/private/secret-repo", opportunity_text)
            self.assertEqual(queues[0], queues[1])

    def test_adjudicate_s0_recall_probe_yes_requires_candidate_expansion(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            cards = [
                {
                    "candidate_id": f"case-{index}",
                    "session_id_hash": f"session-{index}",
                    "goal_thread_id_hash": f"root-{index}",
                    "evidence_completeness": {"has_post_cutoff_consequence": True},
                }
                for index in range(6)
            ]
            (output / "evidence_cards.jsonl").write_text("".join(json.dumps(card) + "\n" for card in cards))
            queue = [
                {
                    "candidate_id": card["candidate_id"],
                    "selection_stratum": "recall_probe" if index == 5 else "high_signal",
                    "goal_cluster_hash": card["goal_thread_id_hash"],
                }
                for index, card in enumerate(cards)
            ]
            (output / "user_review_queue.json").write_text(json.dumps(queue))
            self.bind_review_artifacts(output)
            answers = workspace / "answers.json"
            self.write_bound_answers(output, answers, [
                {"candidate_id": card["candidate_id"], "answer": "YES"}
                for card in cards
            ])

            result = adjudicate_s0(workspace, answers)

            self.assertEqual(result["status"], "PENDING_CANDIDATE_EXPANSION")
            self.assertIsNone(result["decision"])
            self.assertGreater(result["missed_positive_probe_rate"], 0)
            tampered = json.loads(answers.read_text())
            tampered["scan_run_id"] = "other-run"
            answers.write_text(json.dumps(tampered))
            with self.assertRaisesRegex(RuntimeError, "answers are not bound"):
                adjudicate_s0(workspace, answers)

    def test_adjudicate_s0_treats_machine_answers_as_prelabels_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            card = {
                "candidate_id": "case-0",
                "session_id_hash": "session-0",
                "evidence_completeness": {"has_post_cutoff_consequence": False},
            }
            (output / "evidence_cards.jsonl").write_text(json.dumps(card) + "\n")
            (output / "user_review_queue.json").write_text(json.dumps([{
                "candidate_id": "case-0",
                "selection_stratum": "healthy_hard_negative",
                "goal_cluster_hash": "root-0",
            }]))
            self.bind_review_artifacts(output)
            answers = workspace / "answers.json"
            self.write_bound_answers(
                output,
                answers,
                [{"candidate_id": "case-0", "answer": "NO"}],
                reviewer_type="MACHINE_PRELABEL",
            )

            result = adjudicate_s0(workspace, answers)

            self.assertEqual(result["status"], "PENDING_HUMAN_CALIBRATION")
            self.assertIsNone(result["decision"])
            self.assertEqual(result["metrics_status"], "PRELIMINARY_MACHINE_PRELABEL")
            persisted = json.loads((output / "s0_adjudication.json").read_text())
            self.assertEqual(persisted["scan_run_id"], "test-run")
            self.assertEqual(persisted["answers_sha256"], hashlib.sha256(answers.read_bytes()).hexdigest())
            self.assertEqual(persisted["evidence_cards_sha256"], hashlib.sha256((output / "evidence_cards.jsonl").read_bytes()).hexdigest())
            self.assertEqual(persisted["user_review_queue_sha256"], hashlib.sha256((output / "user_review_queue.json").read_bytes()).hexdigest())

    def test_adjudicate_s0_does_not_invent_failure_type_from_yes(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            card = {
                "candidate_id": "case-0",
                "session_id_hash": "session-0",
                "evidence_completeness": {"has_post_cutoff_consequence": True},
            }
            (output / "evidence_cards.jsonl").write_text(json.dumps(card) + "\n")
            (output / "user_review_queue.json").write_text(json.dumps([{
                "candidate_id": "case-0",
                "selection_stratum": "high_signal",
                "goal_cluster_hash": "root-0",
            }]))
            self.bind_review_artifacts(output)
            answers = workspace / "answers.json"
            self.write_bound_answers(output, answers, [{"candidate_id": "case-0", "answer": "YES"}])

            result = adjudicate_s0(workspace, answers)

            self.assertEqual(result["confirmed_causal_failures"], 1)
            self.assertEqual(result["confirmed_type_abc"], 0)

    def test_adjudicate_s0_cannot_stop_before_type_b_opportunities_exist(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            card = {
                "candidate_id": "case-0",
                "session_id_hash": "session-0",
                "evidence_completeness": {"has_post_cutoff_consequence": False},
            }
            (output / "evidence_cards.jsonl").write_text(json.dumps(card) + "\n")
            (output / "user_review_queue.json").write_text(json.dumps([{
                "candidate_id": "case-0",
                "selection_stratum": "healthy_hard_negative",
                "goal_cluster_hash": "root-0",
            }]))
            self.bind_review_artifacts(output, cross_status="NOT_EXECUTED")
            answers = workspace / "answers.json"
            self.write_bound_answers(output, answers, [{"candidate_id": "case-0", "answer": "NO"}])

            result = adjudicate_s0(workspace, answers)

            self.assertEqual(result["status"], "INSUFFICIENT_EVIDENCE")
            self.assertIsNone(result["decision"])

    def test_adjudicate_s0_waits_for_all_reviews_then_applies_stop_threshold(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            cards = [
                {
                    "candidate_id": f"case-{index}",
                    "classification": "uncertain",
                    "system_classification": {"status": "CLASSIFIED", "failure_type": "A"},
                    "session_id_hash": f"session-{index}",
                    "repository_identity_hash": "repo-a",
                    "cutoff": {"timestamp": f"2026-08-16T00:{index:02d}:00Z"},
                    "evidence_completeness": {"structural_opportunity": True, "has_post_cutoff_consequence": True},
                }
                for index in range(10)
            ]
            (output / "evidence_cards.jsonl").write_text("".join(json.dumps(card) + "\n" for card in cards))
            queue = [{"candidate_id": card["candidate_id"], "selection_stratum": "high_signal", "goal_cluster_hash": card["session_id_hash"]} for card in cards]
            (output / "user_review_queue.json").write_text(json.dumps(queue))
            self.bind_review_artifacts(output)
            incomplete = workspace / "incomplete.json"
            self.write_bound_answers(output, incomplete, [{"candidate_id": "case-0", "answer": "YES"}])

            pending = adjudicate_s0(workspace, incomplete)

            self.assertEqual(pending["status"], "PENDING_USER_REVIEW")
            self.assertIsNone(pending["decision"])

            complete = workspace / "complete.json"
            self.write_bound_answers(output, complete, [
                {"candidate_id": f"case-{index}", "answer": "YES" if index < 4 else "NO"}
                for index in range(10)
            ])

            decided = adjudicate_s0(workspace, complete)

            self.assertEqual(decided["status"], "DECIDED")
            self.assertEqual(decided["decision"], "STOP")
            self.assertEqual(decided["confirmed_type_abc"], 4)
            self.assertTrue(any("confirmed Type A/B/C below 5" in reason for reason in decided["decision_reasons"]))

    def test_adjudicate_s0_does_not_pivot_from_repository_concentration_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            cards = [
                {
                    "candidate_id": f"case-{index}",
                    "classification": "uncertain",
                    "system_classification": {"status": "CLASSIFIED", "failure_type": "A"},
                    "session_id_hash": f"session-{index}",
                    "repository_identity_hash": "one-repository",
                    "cutoff": {"timestamp": f"2026-08-16T00:{index:02d}:00Z"},
                    "evidence_completeness": {
                        "structural_opportunity": True,
                        "has_post_cutoff_consequence": True,
                    },
                }
                for index in range(10)
            ]
            (output / "evidence_cards.jsonl").write_text("".join(json.dumps(card) + "\n" for card in cards))
            queue = [{"candidate_id": f"case-{index}", "selection_stratum": "high_signal", "goal_cluster_hash": f"session-{index}"} for index in range(10)]
            (output / "user_review_queue.json").write_text(json.dumps(queue))
            self.bind_review_artifacts(output)
            answers = workspace / "answers.json"
            self.write_bound_answers(output, answers, [
                {"candidate_id": f"case-{index}", "answer": "YES" if index < 5 else "NO"}
                for index in range(10)
            ])

            result = adjudicate_s0(workspace, answers)

            self.assertEqual(result["decision"], "PROCEED_TO_CONFIRMATION")
            self.assertEqual(result["stage_outcome"], "PROCEED_TO_CONFIRMATION")

    def test_adjudicate_s0_pivots_only_with_bound_scenario_and_multiple_roots(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            cards = [
                {
                    "candidate_id": f"case-{index}",
                    "system_classification": {"status": "CLASSIFIED", "failure_type": "A"},
                    "session_id_hash": f"session-{index}",
                    "goal_thread_id_hash": f"root-{index}",
                    "evidence_completeness": {"has_post_cutoff_consequence": True},
                }
                for index in range(5)
            ]
            (output / "evidence_cards.jsonl").write_text("".join(json.dumps(card) + "\n" for card in cards))
            (output / "user_review_queue.json").write_text(json.dumps([
                {
                    "candidate_id": card["candidate_id"],
                    "selection_stratum": "high_signal",
                    "goal_cluster_hash": card["goal_thread_id_hash"],
                }
                for card in cards
            ]))
            self.bind_review_artifacts(output, overflow=5)
            answers = workspace / "answers.json"
            self.write_bound_answers(
                output,
                answers,
                [
                    {"candidate_id": card["candidate_id"], "answer": "YES" if index < 3 else "NO"}
                    for index, card in enumerate(cards)
                ],
                pivot_scenario={
                    "tag": "compaction-restores-obsolete-plan",
                    "case_ids": ["case-0", "case-1", "case-2"],
                    "high_value_reason": "",
                },
            )

            result = adjudicate_s0(workspace, answers)

            self.assertEqual(result["decision"], "PIVOT")
            self.assertEqual(result["pivot_scenario_tag"], "compaction-restores-obsolete-plan")
            self.assertEqual(result["pivot_distinct_goal_roots"], 3)

            self.write_bound_answers(
                output,
                answers,
                [{"candidate_id": card["candidate_id"], "answer": "YES"} for card in cards],
                pivot_scenario={
                    "tag": "compaction-restores-obsolete-plan",
                    "case_ids": ["case-0", "case-1", "case-2"],
                    "high_value_reason": "",
                },
            )
            widespread = adjudicate_s0(workspace, answers)
            self.assertEqual(widespread["decision"], "PROCEED_TO_CONFIRMATION")

    def test_adjudicate_s0_does_not_stop_or_pivot_from_an_overflowed_sample(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            cards = [
                {
                    "candidate_id": f"case-{index}",
                    "system_classification": {"status": "CLASSIFIED", "failure_type": "A"},
                    "session_id_hash": f"session-{index}",
                    "repository_identity_hash": "one-repository",
                    "cutoff": {"timestamp": f"2026-08-16T00:{index:02d}:00Z"},
                    "evidence_completeness": {
                        "structural_opportunity": True,
                        "has_post_cutoff_consequence": True,
                    },
                }
                for index in range(5)
            ]
            (output / "evidence_cards.jsonl").write_text("".join(json.dumps(card) + "\n" for card in cards))
            (output / "user_review_queue.json").write_text(json.dumps([
                {"candidate_id": card["candidate_id"], "selection_stratum": "high_signal", "goal_cluster_hash": card["session_id_hash"]} for card in cards
            ]))
            self.bind_review_artifacts(output, overflow=20)
            answers = workspace / "answers.json"
            self.write_bound_answers(output, answers, [
                {"candidate_id": card["candidate_id"], "answer": "YES"} for card in cards
            ])

            result = adjudicate_s0(workspace, answers)

            self.assertEqual(result["status"], "DECIDED")
            self.assertEqual(result["decision"], "PROCEED_TO_CONFIRMATION")
            self.assertEqual(result["candidate_episode_overflow"], 20)

    def test_prepare_s0_review_rejects_mixed_scan_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rollout = sessions / "rollout.jsonl"
            rollout.write_text("".join(json.dumps(row) + "\n" for row in [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "s1", "cwd": "/repo"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "response_item", "payload": {"id": "signal", "type": "message", "role": "user", "content": "重新规划"}},
            ]))
            workspace = root / "out"
            run_s0_screening(workspace, [sessions], max_sessions=1)
            candidate_path = workspace / "data/screening/candidate_decision_points.jsonl"
            candidate_path.write_text(candidate_path.read_text() + "\n")

            with self.assertRaisesRegex(RuntimeError, "one complete compatible scan run"):
                prepare_s0_review(workspace)

    def test_prepare_s0_review_rejects_tampered_cross_session_population(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            sessions.mkdir()
            rollout = sessions / "rollout.jsonl"
            rollout.write_text("".join(json.dumps(row) + "\n" for row in [
                {"timestamp": "2026-08-16T00:00:00Z", "type": "session_meta", "payload": {"id": "s1", "cwd": "/repo"}},
                {"timestamp": "2026-08-16T00:01:00Z", "type": "compacted", "payload": {"id": "compact"}},
                {"timestamp": "2026-08-16T00:02:00Z", "type": "response_item", "payload": {"id": "action", "type": "message", "role": "assistant", "content": "continue"}},
            ]))
            workspace = root / "out"
            run_s0_screening(workspace, [sessions], max_sessions=1)
            cross_path = workspace / "data/screening/cross_session_opportunity_population.jsonl"
            cross_path.write_text(json.dumps({"tampered": True}) + "\n")

            with self.assertRaisesRegex(RuntimeError, "one complete compatible scan run"):
                prepare_s0_review(workspace)


if __name__ == "__main__":
    unittest.main()
