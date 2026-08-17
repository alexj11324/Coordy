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
from coordy.sources import JsonExportSource
from coordy.screening import run_s0_screening
from coordy.state import update_state


class CoordyTests(unittest.TestCase):
    def event(self, event_id: str, session: str, timestamp: str, content: str, **kwargs) -> CanonicalEvent:
        return CanonicalEvent(event_id, session, timestamp, 0, "user", kwargs.pop("event_type", "message"), content, **kwargs)

    def test_timestamp_requires_timezone(self):
        with self.assertRaises(ValueError):
            self.event("e", "s", "2026-01-01T00:00:00", "hello")

    def test_redacts_nested_secrets(self):
        clean, count = redact_value({"token": "abc", "body": "api_key=secret-value"})
        self.assertEqual(clean["token"], "[REDACTED]")
        self.assertNotIn("secret-value", clean["body"])
        self.assertEqual(count, 2)

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


if __name__ == "__main__":
    unittest.main()
