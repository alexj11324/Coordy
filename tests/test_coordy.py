from __future__ import annotations

import json
import hashlib
import sqlite3
import tempfile
import unittest
from pathlib import Path

from coordy.ingest import ingest
from coordy.discovery import discover_codex_environment
from coordy.models import CanonicalEvent
from coordy.pipeline import run
from coordy.protocol import initialize
from coordy.redaction import redact_value
from coordy.review import adjudicate_s0, prepare_s0_review
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
    ) -> None:
        evidence = output / "evidence_cards.jsonl"
        queue = output / "user_review_queue.json"
        summary = {
            "scan_run_id": "test-run",
            "candidate_episode_overflow": overflow,
        }
        manifest = {
            "scan_run_id": "test-run",
            "scanner_version": "s0-v3",
            "candidate_episode_overflow": overflow,
            "reviewable_population_size": (
                len(json.loads(queue.read_text()))
                if reviewable_population_size is None else reviewable_population_size
            ),
            "evidence_cards_sha256": hashlib.sha256(evidence.read_bytes()).hexdigest(),
            "user_review_queue_sha256": hashlib.sha256(queue.read_bytes()).hexdigest(),
        }
        (output / "screening_summary.json").write_text(json.dumps(summary))
        (output / "s0_review_manifest.json").write_text(json.dumps(manifest))

    def event(self, event_id: str, session: str, timestamp: str, content: str, **kwargs) -> CanonicalEvent:
        return CanonicalEvent(event_id, session, timestamp, 0, "user", kwargs.pop("event_type", "message"), content, **kwargs)

    def test_timestamp_requires_timezone(self):
        with self.assertRaises(ValueError):
            self.event("e", "s", "2026-01-01T00:00:00", "hello")

    def test_redacts_nested_secrets(self):
        clean, count = redact_value({
            "token": "abc",
            "body": "api_key=secret-value password=hunter2 AKIAABCDEFGHIJKLMNOP -----BEGIN PRIVATE KEY----- private-material -----END PRIVATE KEY-----",
        })
        self.assertEqual(clean["token"], "[REDACTED]")
        self.assertNotIn("secret-value", clean["body"])
        self.assertNotIn("hunter2", clean["body"])
        self.assertNotIn("AKIAABCDEFGHIJKLMNOP", clean["body"])
        self.assertNotIn("private-material", clean["body"])
        self.assertGreaterEqual(count, 5)

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
            candidate = json.loads((root / "out/data/screening/candidate_decision_points.jsonl").read_text())
            self.assertFalse(candidate["after_compaction"])

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
            self.assertEqual(result["unique_candidate_episodes_total"], 2)
            self.assertEqual(result["candidate_episode_overflow"], 0)
            candidates = [
                json.loads(line)
                for line in (root / "out/data/screening/candidate_decision_points.jsonl").read_text().splitlines()
            ]
            self.assertEqual({row["session_id"] for row in candidates}, {"s1", "s2"})

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

            self.assertEqual(result["review_cards"], 0)
            self.assertEqual(result["status"], "DECIDED")
            self.assertEqual(result["decision"], "STOP")
            self.assertEqual(result["unique_structural_replay_upper_bound"], 1)
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
            self.assertTrue(card["evidence_completeness"]["structural_replay_candidate"])
            template = json.loads((workspace / "data/screening/user_review_answers.json").read_text())
            self.assertEqual(template["answers"], [])

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
                {"timestamp": "2026-08-16T00:11:00Z", "type": "response_item", "payload": {"id": "action", "type": "message", "role": "assistant", "content": "wrong next action"}},
                {"timestamp": "2026-08-16T00:12:00Z", "type": "response_item", "payload": {"id": "correction", "type": "message", "role": "user", "content": "你忘了 the constraint"}},
            ]
            rollout.write_text("".join(json.dumps(row) + "\n" for row in rows))
            workspace = root / "out"
            run_s0_screening(workspace, [sessions], max_sessions=1)

            prepare_s0_review(workspace)

            card = json.loads((workspace / "data/screening/evidence_cards.jsonl").read_text())
            self.assertEqual(card["cutoff"]["timestamp"], "2026-08-16T00:10:00Z")
            self.assertEqual(
                card["cutoff"]["maximum_allowed_event_id"],
                hashlib.sha256(b"latest-compact").hexdigest(),
            )

    def test_adjudicate_s0_waits_for_all_reviews_then_applies_stop_threshold(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            cards = [
                {
                    "candidate_id": f"case-{index}",
                    "classification": "uncertain",
                    "suggested_failure_type": "A",
                    "session_id_hash": f"session-{index}",
                    "repository_identity_hash": "repo-a",
                    "cutoff": {"timestamp": f"2026-08-16T00:{index:02d}:00Z"},
                    "evidence_completeness": {"structural_replay_candidate": True, "has_post_cutoff_consequence": True},
                }
                for index in range(10)
            ]
            (output / "evidence_cards.jsonl").write_text("".join(json.dumps(card) + "\n" for card in cards))
            queue = [{"candidate_id": card["candidate_id"]} for card in cards]
            (output / "user_review_queue.json").write_text(json.dumps(queue))
            self.bind_review_artifacts(output)
            incomplete = workspace / "incomplete.json"
            incomplete.write_text(json.dumps({"answers": [{"candidate_id": "case-0", "answer": "YES"}]}))

            pending = adjudicate_s0(workspace, incomplete)

            self.assertEqual(pending["status"], "PENDING_USER_REVIEW")
            self.assertIsNone(pending["decision"])

            complete = workspace / "complete.json"
            complete.write_text(json.dumps({
                "answers": [
                    {"candidate_id": f"case-{index}", "answer": "YES" if index < 4 else "NO"}
                    for index in range(10)
                ]
            }))

            decided = adjudicate_s0(workspace, complete)

            self.assertEqual(decided["status"], "DECIDED")
            self.assertEqual(decided["decision"], "STOP")
            self.assertEqual(decided["confirmed_type_abc"], 4)
            self.assertIn("confirmed Type A/B/C below 5", decided["decision_reasons"])

    def test_adjudicate_s0_pivots_when_confirmed_failures_are_narrowly_concentrated(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            cards = [
                {
                    "candidate_id": f"case-{index}",
                    "classification": "uncertain",
                    "suggested_failure_type": "A",
                    "session_id_hash": f"session-{index}",
                    "repository_identity_hash": "one-repository",
                    "cutoff": {"timestamp": f"2026-08-16T00:{index:02d}:00Z"},
                    "evidence_completeness": {
                        "structural_replay_candidate": True,
                        "has_post_cutoff_consequence": True,
                    },
                }
                for index in range(10)
            ]
            (output / "evidence_cards.jsonl").write_text("".join(json.dumps(card) + "\n" for card in cards))
            queue = [{"candidate_id": f"case-{index}"} for index in range(10)]
            (output / "user_review_queue.json").write_text(json.dumps(queue))
            self.bind_review_artifacts(output)
            answers = workspace / "answers.json"
            answers.write_text(json.dumps({
                "answers": [
                    {"candidate_id": f"case-{index}", "answer": "YES" if index < 5 else "NO"}
                    for index in range(10)
                ]
            }))

            result = adjudicate_s0(workspace, answers)

            self.assertEqual(result["decision"], "PIVOT")
            self.assertEqual(result["stage_outcome"], "PIVOT")

    def test_adjudicate_s0_does_not_stop_or_pivot_from_an_overflowed_sample(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            output = workspace / "data/screening"
            output.mkdir(parents=True)
            cards = [
                {
                    "candidate_id": f"case-{index}",
                    "suggested_failure_type": None,
                    "session_id_hash": f"session-{index}",
                    "repository_identity_hash": "one-repository",
                    "cutoff": {"timestamp": f"2026-08-16T00:{index:02d}:00Z"},
                    "evidence_completeness": {
                        "structural_replay_candidate": True,
                        "has_post_cutoff_consequence": True,
                    },
                }
                for index in range(5)
            ]
            (output / "evidence_cards.jsonl").write_text("".join(json.dumps(card) + "\n" for card in cards))
            (output / "user_review_queue.json").write_text(json.dumps([
                {"candidate_id": card["candidate_id"]} for card in cards
            ]))
            self.bind_review_artifacts(output, overflow=20)
            answers = workspace / "answers.json"
            answers.write_text(json.dumps({"answers": [
                {"candidate_id": card["candidate_id"], "answer": "YES"} for card in cards
            ]}))

            result = adjudicate_s0(workspace, answers)

            self.assertEqual(result["status"], "PENDING_CASE_CONSTRUCTION")
            self.assertIsNone(result["decision"])
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


if __name__ == "__main__":
    unittest.main()
