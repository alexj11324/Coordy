from __future__ import annotations

import fcntl
import hashlib
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from coordy.cli import _judge_api_settings
from coordy.ingest import ingest
from coordy.discovery import discover_codex_environment
from coordy.models import CanonicalEvent
from coordy.pipeline import run
from coordy.protocol import initialize
from coordy.redaction import redact_value
from coordy.review import adjudicate_s0, prepare_s0_review
from coordy.semantic import (
    STATE_JUDGE_INSTRUCTIONS,
    STATE_TYPES,
    NonRetryableJudgeError,
    ResponsesAPIStateJudge,
    _evaluate_state_smoke,
    _run_judge_batches,
    _secure_write,
    _state_diff_batch_schema,
    _human_causal_chain,
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


class CoordyTests(unittest.TestCase):
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

            result = run_s0_screening(root / "out", [sessions], max_sessions=1)

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
                "pre_state_index": 0,
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
        missing_state_reference["diffs"][0]["pre_state_index"] = 1
        with self.assertRaisesRegex(ValueError, "extracted pre-state entry"):
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
        with self.assertRaisesRegex(ValueError, "bound pre-state entry"):
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
                                "pre_state_index": 0,
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
                {"timestamp": "2026-08-16T00:08:00Z", "type": "response_item", "payload": {"id": "correction", "type": "message", "role": "user", "content": "Restore the compatibility constraint."}},
            ]
            (sessions / "rollout.jsonl").write_text(
                "".join(json.dumps(row) + "\n" for row in rows)
            )
            workspace = root / "out"
            run_s0_screening(workspace, [sessions], max_sessions=1)
            prepare_s0_review(workspace, max_reviews=1)
            prepare_s0b_state_inputs(workspace)

            class SuspectJudge:
                def __init__(self, judge_id: str):
                    self.judge_id = judge_id
                    self.model = f"fake-{judge_id}"
                    self.configuration_sha256 = f"config-{judge_id}"

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
                            "pre_state_index": 0,
                            "status": "missing",
                            "downstream_relevance": "DIRECT",
                            "post_evidence_ids": [post],
                            "rationale": "The constraint is absent after compaction.",
                        }],
                        "assessment_status": "SUSPECT",
                        "suspected_state_change": True,
                        "confidence": 0.95,
                        })
                    return results

            run_s0b_state_diff(
                workspace, SuspectJudge("primary"), SuspectJudge("secondary"), batch_size=1
            )
            eligible_path = workspace / "data/screening/eligible_sessions.jsonl"
            eligible_content = eligible_path.read_text()
            eligible_path.write_text(eligible_content + "{}\n")
            with self.assertRaisesRegex(RuntimeError, "eligible sessions"):
                prepare_s0b_causal_inputs(workspace)
            eligible_path.write_text(eligible_content)
            manifest = prepare_s0b_causal_inputs(workspace)
            self.assertEqual(manifest["causal_input_count"], 1)
            causal_path = workspace / "data/screening/s0b_causal_inputs.jsonl"
            packet = json.loads(causal_path.read_text().strip())
            self.assertTrue(packet["pre_compaction_events"])
            self.assertTrue(packet["compaction_summary_events"])
            outcomes = packet["verified_engineering_outcomes"]
            self.assertEqual(
                {(row["verification_source"], row["operation_kind"]) for row in outcomes},
                {("structured_tool_result", "test"), ("patch_apply_end", "patch")},
            )
            self.assertEqual(outcomes[0]["exit_code"], 1)
            self.assertIn("test_preserves_constraint failed", outcomes[0]["result_excerpt"])
            serialized = causal_path.read_text()
            self.assertNotIn(
                "tests failed and I rolled back", json.dumps(outcomes, sort_keys=True)
            )
            self.assertNotIn("/repo/private.py", serialized)
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
                        "evidence_ids": [item["verified_engineering_outcomes"][0]["evidence_id"]],
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
        self.assertNotIn("pre_state_evidence_ids", diff_properties)
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
                "pre_state_index": 0,
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
        result["diffs"][0]["pre_state_index"] = 1
        response_envelope["output"][0]["content"][0]["text"] = json.dumps({"results": [result]})
        with patch("coordy.semantic.urllib.request.build_opener", return_value=FakeOpener()):
            with self.assertRaisesRegex(NonRetryableJudgeError, "semantic validation"):
                semantic_judge.grade([packet])
        semantic_record = json.loads(next(Path(semantic_tmp.name).glob("*.json")).read_text())
        self.assertEqual(semantic_record["status"], "SEMANTIC_VALIDATION_FAILED_NO_RETRY")
        self.assertEqual(
            semantic_record["rejected_result"][0]["diffs"][0]["pre_state_index"],
            1,
        )
        result["diffs"][0]["pre_state_index"] = 0
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
        for index in range(3):
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

            def grade(self, batch):
                packet = batch[0]
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
                        "pre_state_index": 0,
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
            with self.assertRaisesRegex(RuntimeError, "successful concurrent results"):
                _run_judge_batches(
                    PartialFailureJudge(), packets, 1, checkpoint, workers=3
                )
            saved = [json.loads(line) for line in checkpoint.read_text().splitlines()]
            self.assertEqual(
                {row["opportunity_id_hash"] for row in saved},
                {"opportunity-0", "opportunity-2"},
            )

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
