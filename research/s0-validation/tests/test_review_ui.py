from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from coordy.review import _hash
from coordy.review_ui import ReviewStore
from coordy.semantic import _secure_write


def _answer(case_id: str, episode_key: str) -> dict:
    return {
        "incident_case_id_hash": case_id,
        "episode_key": episode_key,
        "classification": "UNASSESSABLE",
        **{
            phase: {"status": "UNASSESSABLE", "summary": "证据不足。", "evidence_ids": []}
            for phase in ("T0", "T1", "T2", "T3", "T4", "T5")
        },
        "compaction_caused": "UNCERTAIN",
        "wrong_action": "UNCERTAIN",
        "engineering_consequence": "UNCERTAIN",
        "ordinary_reasoning_better_explanation": "UNCERTAIN",
        "confidence": 0.0,
        "rationale": "人工复核认为当前 packet 缺少可判定后果。",
    }


class ReviewStoreTests(unittest.TestCase):
    def make_store(self) -> ReviewStore:
        root = Path(self.tmp.name)
        output = root / "data/screening"
        output.mkdir(parents=True)
        case_id = "case-1"
        episode_key = "episode-1"
        item = {
            "review_item_id": "item-1",
            "incident_case_id_hash": case_id,
            "episode_key": episode_key,
            "topic": "test topic",
            "triage_bucket": "DIFFICULT_NEGATIVE_OR_UNASSESSABLE",
            "machine_classification": "UNASSESSABLE",
            "machine_confidence": 0.0,
            "allowed_source_event_ids": ["event-1"],
            "allowed_boundary_ids": ["boundary-1"],
            "context_packet_sha256": "",
            "machine_prelabel": {
                "episode_key": episode_key,
                "classification": "UNASSESSABLE",
                **{
                    phase: {"status": "UNASSESSABLE", "summary": "machine", "evidence_ids": []}
                    for phase in ("T0", "T1", "T2", "T3", "T4", "T5")
                },
                "compaction_caused": "UNCERTAIN",
                "wrong_action": "UNCERTAIN",
                "engineering_consequence": "UNCERTAIN",
                "ordinary_reasoning_better_explanation": "UNCERTAIN",
                "confidence": 0.0,
                "rationale": "machine",
            },
        }
        packet = {
            "incident_case_id_hash": case_id,
            "input_sha256": "packet-input",
            "topic": "test topic",
            "allowed_source_event_ids": ["event-1"],
            "allowed_boundary_ids": ["boundary-1"],
            "source_events": [{"evidence_id": "event-1", "content": "source"}],
            "compaction_opportunities": [{"boundary_id_hash": "boundary-1", "compaction_event": {"sequence": 1}}],
        }
        item["context_packet_sha256"] = _hash(json.dumps(packet, ensure_ascii=False, sort_keys=True))
        context_row = {"review_item": {**item}, "source_packet": packet}
        queue_content = json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n"
        context_content = json.dumps(context_row, ensure_ascii=False, sort_keys=True) + "\n"
        causal_input = {"incident_case_id_hash": case_id, "input_sha256": "packet-input"}
        causal_input_content = json.dumps(causal_input, ensure_ascii=False, sort_keys=True) + "\n"
        _secure_write(output / "incident_causal_human_triage_queue_v1.jsonl", queue_content)
        _secure_write(output / "incident_causal_human_triage_context_v1.jsonl", context_content)
        _secure_write(output / "incident_causal_inputs_v1.jsonl", causal_input_content)
        triage_manifest = {
            "status": "PENDING_HUMAN_REVIEW_TRIAGED",
            "scan_run_id": "scan-1",
            "triage_queue_sha256": _hash(queue_content.encode()),
            "triage_context_sha256": _hash(context_content.encode()),
            "human_review_item_count": 1,
            "triage_bucket_counts": {"DIFFICULT_NEGATIVE_OR_UNASSESSABLE": 1},
        }
        review_manifest = {
            "status": "PENDING_HUMAN_REVIEW",
            "scan_run_id": "scan-1",
            "review_context_sha256": _hash(causal_input_content.encode()),
        }
        _secure_write(output / "incident_causal_human_triage_manifest_v1.json", json.dumps(triage_manifest))
        _secure_write(output / "incident_causal_review_manifest_v1.json", json.dumps(review_manifest))
        return ReviewStore(root)

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_save_is_source_bound_and_survives_reload(self) -> None:
        store = self.make_store()
        before = store.state()
        self.assertEqual(before["saved"], 0)
        answer = _answer("case-1", "episode-1")
        after = store.save_answer("item-1", answer)
        self.assertEqual(after["saved"], 1)
        reloaded = ReviewStore(Path(self.tmp.name))
        self.assertEqual(reloaded.item("item-1")["draft_answer"], answer)

    def test_wrong_case_cannot_be_saved(self) -> None:
        store = self.make_store()
        answer = _answer("other-case", "episode-1")
        with self.assertRaisesRegex(ValueError, "another incident case"):
            store.save_answer("item-1", answer)

    def test_optional_local_subagent_review_is_exposed_as_auxiliary(self) -> None:
        store = self.make_store()
        sibling = Path(self.tmp.name).parent / "screening-s0-v45-independent-subagent" / "data" / "screening"
        sibling.mkdir(parents=True)
        self.addCleanup(lambda: shutil.rmtree(sibling.parent.parent, ignore_errors=True))
        packet = store.context_by_id["item-1"]["source_packet"]
        causal_input_content = (store.output / "incident_causal_inputs_v1.jsonl").read_text(encoding="utf-8")
        episode = dict(store.queue[0]["machine_prelabel"])
        row = {
            "protocol_version": "incident-causal-subagent-review-v1",
            "reviewer_type": "LOCAL_SUBAGENT_PROVISIONAL",
            "ground_truth": False,
            "api_used": False,
            "network_used": False,
            "row_number": 1,
            "incident_case_id_hash": "case-1",
            "source_packet_input_sha256": packet["input_sha256"],
            "review_depth": "FULL",
            "episodes": [episode],
        }
        review_content = json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n"
        _secure_write(sibling / "incident_causal_subagent_review_v1.jsonl", review_content)
        manifest = {
            "protocol_version": "incident-causal-subagent-review-manifest-v1",
            "artifact_role": "AUXILIARY_PROVISIONAL_REVIEW_NOT_GROUND_TRUTH",
            "reviewer_type": "LOCAL_SUBAGENT_PROVISIONAL",
            "api_used": False,
            "network_used": False,
            "scan_run_id": "scan-1",
            "input_sha256": _hash(causal_input_content.encode()),
            "output_sha256": _hash(review_content.encode()),
            "coverage": {"input_rows": 1, "output_rows": 1, "unique_cases": 1},
        }
        _secure_write(
            sibling / "incident_causal_subagent_review_manifest_v1.json",
            json.dumps(manifest, sort_keys=True),
        )
        reloaded = ReviewStore(Path(self.tmp.name))
        self.assertEqual(reloaded.state()["items"][0]["independent_classification"], "UNASSESSABLE")
        self.assertEqual(reloaded.state()["items"][0]["independent_review_depth"], "FULL")
        self.assertEqual(
            reloaded.item("item-1")["independent_review"]["reviewer_type"],
            "LOCAL_SUBAGENT_PROVISIONAL",
        )

    def test_finalize_requires_all_answers_and_explicit_confirmation(self) -> None:
        store = self.make_store()
        with self.assertRaisesRegex(ValueError, "explicit confirmation"):
            store.finalize(False)
        with self.assertRaisesRegex(RuntimeError, "human review is incomplete"):
            store.finalize(True)
        store.save_answer("item-1", _answer("case-1", "episode-1"))
        with patch("coordy.review_ui.adjudicate_incident_causal_review", return_value={"status": "ok"}) as judge:
            self.assertEqual(store.finalize(True), {"status": "ok"})
            judge.assert_called_once()
        with self.assertRaisesRegex(RuntimeError, "already finalized"):
            store.save_answer("item-1", _answer("case-1", "episode-1"))
        with self.assertRaisesRegex(RuntimeError, "already finalized"):
            store.finalize(True)
        envelope = json.loads(store.template_path.read_text(encoding="utf-8"))
        self.assertEqual(envelope["reviewer_type"], "HUMAN_CONFIRMED")


if __name__ == "__main__":
    unittest.main()
