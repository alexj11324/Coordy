"""Local, source-bound web UI for human causal triage.

The review UI deliberately binds itself to the immutable triage queue and its
full-context JSONL file.  It is a loopback-only convenience layer around the
existing strict adjudicator; it never promotes a machine prelabel on its own.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import RLock
from typing import Any
from urllib.parse import unquote, urlsplit

from .incidents import adjudicate_incident_causal_review, validate_incident_causal_review_answer
from .review import _hash
from .semantic import _secure_write


REVIEW_DRAFT_NAME = "incident_causal_human_triage_draft_v1.json"
REVIEW_TEMPLATE_NAME = "incident_causal_human_triage_answers_template_v1.json"
TRIAGE_QUEUE_NAME = "incident_causal_human_triage_queue_v1.jsonl"
TRIAGE_MANIFEST_NAME = "incident_causal_human_triage_manifest_v1.json"
CONTEXT_NAME = "incident_causal_human_triage_context_v1.jsonl"
REVIEW_MANIFEST_NAME = "incident_causal_review_manifest_v1.json"
INDEPENDENT_SUBAGENT_REVIEW_NAME = "incident_causal_subagent_review_v1.jsonl"
INDEPENDENT_SUBAGENT_MANIFEST_NAME = "incident_causal_subagent_review_manifest_v1.json"
MAX_REQUEST_BYTES = 2_000_000

_PHASES = ("T0", "T1", "T2", "T3", "T4", "T5")
_STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _json_line_rows(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise RuntimeError(f"required review artifact is missing: {path.name}")
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"review artifact line {line_number} is not valid JSON") from exc
        if not isinstance(value, dict):
            raise RuntimeError(f"review artifact line {line_number} is not an object")
        rows.append(value)
    return rows


class ReviewStore:
    """Read and persist the triaged human review without weakening provenance."""

    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace.resolve()
        self.output = self.workspace / "data/screening"
        self._lock = RLock()
        self.queue_path = self.output / TRIAGE_QUEUE_NAME
        self.triage_manifest_path = self.output / TRIAGE_MANIFEST_NAME
        self.context_path = self.output / CONTEXT_NAME
        self.review_manifest_path = self.output / REVIEW_MANIFEST_NAME
        self.template_path = self.output / REVIEW_TEMPLATE_NAME
        self.draft_path = self.output / REVIEW_DRAFT_NAME
        self.ground_truth_path = self.output / "incident_causal_ground_truth_v1.jsonl"
        self.trajectory_manifest_path = self.output / "trajectory_manifest.json"
        self.independent_subagent_by_case: dict[str, dict[str, Any]] = {}
        self.independent_subagent_manifest: dict[str, Any] | None = None
        self.finalized = False
        self.queue: list[dict[str, Any]] = []
        self.queue_by_id: dict[str, dict[str, Any]] = {}
        self.context_by_id: dict[str, dict[str, Any]] = {}
        self._load_bound_artifacts()

    def _load_bound_artifacts(self) -> None:
        if not self.triage_manifest_path.is_file() or not self.review_manifest_path.is_file():
            raise RuntimeError("prepare-incident-causal-review must run before the review website")
        triage_manifest = json.loads(self.triage_manifest_path.read_text(encoding="utf-8"))
        review_manifest = json.loads(self.review_manifest_path.read_text(encoding="utf-8"))
        if triage_manifest.get("status") != "PENDING_HUMAN_REVIEW_TRIAGED":
            raise RuntimeError("triaged review queue is not pending human review")
        if review_manifest.get("status") != "PENDING_HUMAN_REVIEW":
            raise RuntimeError("causal review queue is not pending human review")
        queue_bytes = self.queue_path.read_bytes()
        context_bytes = self.context_path.read_bytes()
        causal_inputs_path = self.output / "incident_causal_inputs_v1.jsonl"
        if not causal_inputs_path.is_file():
            raise RuntimeError("causal input artifact is missing")
        causal_inputs_bytes = causal_inputs_path.read_bytes()
        if triage_manifest.get("triage_queue_sha256") != _hash(queue_bytes):
            raise RuntimeError("triaged review queue hash does not match its manifest")
        if triage_manifest.get("triage_context_sha256") != _hash(context_bytes):
            raise RuntimeError("triaged review context hash does not match its manifest")
        if triage_manifest.get("scan_run_id") != review_manifest.get("scan_run_id"):
            raise RuntimeError("triaged review artifacts belong to different scan runs")
        if review_manifest.get("review_context_sha256") != _hash(causal_inputs_bytes):
            raise RuntimeError("review context is not bound to the current causal inputs")
        queue = _json_line_rows(self.queue_path)
        context_rows = _json_line_rows(self.context_path)
        queue_by_id: dict[str, dict[str, Any]] = {}
        for row in queue:
            item_id = str(row.get("review_item_id") or "")
            key = (str(row.get("incident_case_id_hash") or ""), str(row.get("episode_key") or ""))
            if not item_id or not key[0] or not key[1] or item_id in queue_by_id:
                raise RuntimeError("triaged review queue contains duplicate or empty identities")
            queue_by_id[item_id] = row
        context_by_id: dict[str, dict[str, Any]] = {}
        for row in context_rows:
            review_item = row.get("review_item")
            packet = row.get("source_packet")
            if not isinstance(review_item, dict) or not isinstance(packet, dict):
                raise RuntimeError("triaged review context row is malformed")
            item_id = str(review_item.get("review_item_id") or "")
            if item_id not in queue_by_id or item_id in context_by_id:
                raise RuntimeError("triaged review context is not a one-to-one queue binding")
            if review_item != queue_by_id[item_id]:
                raise RuntimeError("triaged review context item differs from the bound queue")
            if review_item.get("context_packet_sha256") != _hash(
                json.dumps(packet, ensure_ascii=False, sort_keys=True)
            ):
                raise RuntimeError("triaged review context packet hash does not match its queue item")
            context_by_id[item_id] = row
        if set(queue_by_id) != set(context_by_id):
            raise RuntimeError("triaged review context does not cover every queue item")
        expected_count = triage_manifest.get("human_review_item_count")
        if expected_count != len(queue):
            raise RuntimeError("triaged review manifest count does not match its queue")
        self.queue = sorted(queue, key=lambda row: str(row["review_item_id"]))
        self.queue_by_id = queue_by_id
        self.context_by_id = context_by_id
        self.triage_manifest = triage_manifest
        self.review_manifest = review_manifest
        self._load_optional_independent_subagent_review(context_by_id)
        self._load_ground_truth_lock()

    def _load_optional_independent_subagent_review(
        self, context_by_id: dict[str, dict[str, Any]]
    ) -> None:
        """Load a sibling local review strictly as auxiliary, never as truth.

        The independent review is deliberately optional so the original queue
        remains usable on its own. If the artifact is present, however, every
        provenance and case binding is checked before it is exposed to the UI.
        """
        sibling_output = self.workspace.parent / "screening-s0-v45-independent-subagent" / "data" / "screening"
        review_path = sibling_output / INDEPENDENT_SUBAGENT_REVIEW_NAME
        manifest_path = sibling_output / INDEPENDENT_SUBAGENT_MANIFEST_NAME
        if not review_path.exists() and not manifest_path.exists():
            return
        if not review_path.is_file() or not manifest_path.is_file():
            raise RuntimeError("independent Subagent review artifact is incomplete")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        causal_inputs_path = self.output / "incident_causal_inputs_v1.jsonl"
        if not causal_inputs_path.is_file():
            raise RuntimeError("independent Subagent review input artifact is missing")
        if (
            manifest.get("artifact_role") != "AUXILIARY_PROVISIONAL_REVIEW_NOT_GROUND_TRUTH"
            or manifest.get("reviewer_type") != "LOCAL_SUBAGENT_PROVISIONAL"
            or manifest.get("api_used") is not False
            or manifest.get("network_used") is not False
            or manifest.get("scan_run_id") != self.triage_manifest.get("scan_run_id")
            or manifest.get("input_sha256") != _hash(causal_inputs_path.read_bytes())
            or manifest.get("output_sha256") != _hash(review_path.read_bytes())
        ):
            raise RuntimeError("independent Subagent review provenance is invalid")
        causal_inputs = _json_line_rows(causal_inputs_path)
        input_by_case: dict[str, dict[str, Any]] = {}
        for packet in causal_inputs:
            case_id = str(packet.get("incident_case_id_hash") or "")
            input_sha = str(packet.get("input_sha256") or "")
            if not case_id or not input_sha or case_id in input_by_case:
                raise RuntimeError("causal input artifact has duplicate or empty case identities")
            input_by_case[case_id] = packet
        rows = _json_line_rows(review_path)
        expected_rows = int(manifest.get("coverage", {}).get("output_rows") or 0)
        expected_cases = int(manifest.get("coverage", {}).get("unique_cases") or 0)
        if (
            expected_rows != len(rows)
            or expected_rows != int(manifest.get("coverage", {}).get("input_rows") or 0)
            or expected_cases != len(input_by_case)
            or expected_cases != len(rows)
        ):
            raise RuntimeError("independent Subagent review coverage is incomplete")
        by_case: dict[str, dict[str, Any]] = {}
        context_cases = {
            str(row.get("review_item", {}).get("incident_case_id_hash"))
            for row in context_by_id.values()
        }
        for row in rows:
            case_id = str(row.get("incident_case_id_hash") or "")
            if not case_id or case_id in by_case:
                raise RuntimeError("independent Subagent review contains duplicate case identities")
            input_packet = input_by_case.get(case_id)
            if input_packet is None or row.get("source_packet_input_sha256") != input_packet.get("input_sha256"):
                raise RuntimeError("independent Subagent review packet is not bound to current causal inputs")
            if row.get("ground_truth") is not False or row.get("api_used") is not False or row.get("network_used") is not False:
                raise RuntimeError("independent Subagent review row is not auxiliary-only")
            episodes = row.get("episodes")
            if not isinstance(episodes, list) or len(episodes) != 1 or not isinstance(episodes[0], dict):
                raise RuntimeError("independent Subagent review episode shape is invalid")
            if case_id in context_cases:
                by_case[case_id] = row
        for context in context_by_id.values():
            packet = context["source_packet"]
            case_id = str(packet.get("incident_case_id_hash") or "")
            independent = by_case.get(case_id)
            if independent is None or packet.get("input_sha256") != independent.get("source_packet_input_sha256"):
                raise RuntimeError("independent Subagent review does not cover the bound triage packet")
            for key in ("goal_thread_id_hash", "event_key", "opportunity_id_hash"):
                if key in packet and independent.get(key) != packet.get(key):
                    raise RuntimeError(f"independent Subagent review {key} is not bound to the triage packet")
        self.independent_subagent_manifest = manifest
        self.independent_subagent_by_case = by_case

    def _load_ground_truth_lock(self) -> None:
        if not self.ground_truth_path.is_file() and not self.trajectory_manifest_path.is_file():
            return
        trajectory_manifest = json.loads(
            self.trajectory_manifest_path.read_text(encoding="utf-8")
        ) if self.trajectory_manifest_path.is_file() else {}
        result = trajectory_manifest.get("incident_causal_ground_truth_v1")
        if not self.ground_truth_path.is_file() and result is None:
            return
        if not self.ground_truth_path.is_file() or not isinstance(result, dict):
            raise RuntimeError("existing Ground Truth artifact is not completely bound")
        if (
            result.get("human_ground_truth") is not True
            or result.get("review_queue_kind") != "TRIAGED"
            or result.get("ground_truth_sha256") != _hash(self.ground_truth_path.read_bytes())
            or result.get("scan_run_id") != self.triage_manifest.get("scan_run_id")
            or result.get("review_queue_sha256") != self.triage_manifest.get("triage_queue_sha256")
        ):
            raise RuntimeError("existing Ground Truth artifact is stale or not bound to this triage queue")
        self.finalized = True

    def _base_draft(self) -> dict[str, Any]:
        return {
            "protocol_version": "incident-causal-human-triage-draft-v1",
            "scan_run_id": self.triage_manifest["scan_run_id"],
            "review_queue_kind": "TRIAGED",
            "review_queue_sha256": self.triage_manifest["triage_queue_sha256"],
            "review_context_sha256": self.review_manifest["review_context_sha256"],
            "reviewer_type": "HUMAN_DRAFT",
            "draft_status": "IN_PROGRESS",
            "answers": [],
        }

    def _read_draft_locked(self) -> dict[str, Any]:
        if not self.draft_path.is_file():
            return self._base_draft()
        try:
            envelope = json.loads(self.draft_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise RuntimeError("saved human review draft is not valid JSON") from exc
        expected = self._base_draft()
        for key in (
            "scan_run_id", "review_queue_kind", "review_queue_sha256", "review_context_sha256",
        ):
            if envelope.get(key) != expected[key]:
                raise RuntimeError("saved human review draft is stale or bound to another queue")
        if envelope.get("reviewer_type") != "HUMAN_DRAFT":
            raise RuntimeError("saved review artifact is not a draft")
        answers = envelope.get("answers")
        if not isinstance(answers, list):
            raise RuntimeError("saved human review draft answers must be an array")
        self._validate_answers(answers)
        return envelope

    def _validate_answers(self, answers: list[Any]) -> None:
        seen: set[tuple[str, str]] = set()
        item_by_key = {
            (str(row["incident_case_id_hash"]), str(row["episode_key"])): row for row in self.queue
        }
        for answer in answers:
            if not isinstance(answer, dict):
                raise RuntimeError("saved human review draft contains a non-object answer")
            key = (str(answer.get("incident_case_id_hash") or ""), str(answer.get("episode_key") or ""))
            if key in seen:
                raise RuntimeError("saved human review draft contains duplicate answers")
            item = item_by_key.get(key)
            if item is None:
                raise RuntimeError("saved human review draft references an unknown episode")
            try:
                validate_incident_causal_review_answer(item, answer)
            except (TypeError, ValueError) as exc:
                raise RuntimeError(f"saved human review draft contains an invalid answer: {exc}") from exc
            seen.add(key)

    def _answer_by_key(self, envelope: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
        return {
            (str(answer["incident_case_id_hash"]), str(answer["episode_key"])): answer
            for answer in envelope.get("answers") or []
        }

    def state(self) -> dict[str, Any]:
        with self._lock:
            draft = self._read_draft_locked()
            by_key = self._answer_by_key(draft)
        items = []
        for row in self.queue:
            key = (str(row["incident_case_id_hash"]), str(row["episode_key"]))
            machine = row.get("machine_prelabel") or {}
            independent = self.independent_subagent_by_case.get(str(row["incident_case_id_hash"]))
            independent_episode = (independent or {}).get("episodes", [None])[0] if independent else None
            items.append({
                "review_item_id": row["review_item_id"],
                "incident_case_id_hash": row["incident_case_id_hash"],
                "episode_key": row["episode_key"],
                "topic": row.get("topic"),
                "triage_bucket": row.get("triage_bucket"),
                "machine_classification": row.get("machine_classification"),
                "machine_confidence": row.get("machine_confidence"),
                "independent_classification": (independent_episode or {}).get("classification"),
                "independent_review_depth": (independent or {}).get("review_depth"),
                "independent_review_scope": "PACKET_LEVEL" if independent else None,
                "saved": key in by_key,
            })
        return {
            "status": "HUMAN_ADJUDICATION_TRIAGE_COMPLETE" if self.finalized else "PENDING_HUMAN_REVIEW_TRIAGED",
            "scan_run_id": self.triage_manifest["scan_run_id"],
            "total": len(self.queue),
            "saved": len(by_key),
            "remaining": len(self.queue) - len(by_key),
            "triage_bucket_counts": self.triage_manifest.get("triage_bucket_counts", {}),
            "items": items,
            "draft_filename": self.draft_path.name,
            "finalized": self.finalized,
            "ground_truth_ready": not self.finalized and len(by_key) == len(self.queue),
        }

    def item(self, item_id: str) -> dict[str, Any]:
        row = self.queue_by_id.get(item_id)
        if row is None:
            raise KeyError(item_id)
        with self._lock:
            draft = self._read_draft_locked()
            by_key = self._answer_by_key(draft)
        key = (str(row["incident_case_id_hash"]), str(row["episode_key"]))
        return {
            "review_item": row,
            "source_packet": self.context_by_id[item_id]["source_packet"],
            "independent_review": self.independent_subagent_by_case.get(
                str(row["incident_case_id_hash"])
            ),
            "draft_answer": by_key.get(key),
        }

    def save_answer(self, item_id: str, answer: dict[str, Any]) -> dict[str, Any]:
        row = self.queue_by_id.get(item_id)
        if row is None:
            raise KeyError(item_id)
        if not isinstance(answer, dict):
            raise ValueError("answer must be an object")
        validate_incident_causal_review_answer(row, answer)
        key = (str(answer["incident_case_id_hash"]), str(answer["episode_key"]))
        expected_key = (str(row["incident_case_id_hash"]), str(row["episode_key"]))
        if key != expected_key:
            raise ValueError("answer does not belong to the selected review item")
        with self._lock:
            if self.finalized:
                raise RuntimeError("human Ground Truth is already finalized; this review is locked")
            envelope = self._read_draft_locked()
            answers = [
                existing for existing in envelope.get("answers", [])
                if (str(existing.get("incident_case_id_hash")), str(existing.get("episode_key"))) != key
            ]
            answers.append(json.loads(json.dumps(answer, ensure_ascii=False)))
            order = {
                (str(item["incident_case_id_hash"]), str(item["episode_key"])): index
                for index, item in enumerate(self.queue)
            }
            answers.sort(key=lambda value: order[(str(value["incident_case_id_hash"]), str(value["episode_key"]))])
            envelope["answers"] = answers
            envelope["updated_at"] = _utc_now()
            _secure_write(self.draft_path, json.dumps(envelope, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
        return self.state()

    def finalize(self, confirm: bool) -> dict[str, Any]:
        if confirm is not True:
            raise ValueError("explicit confirmation is required before Ground Truth is generated")
        with self._lock:
            if self.finalized:
                raise RuntimeError("human Ground Truth is already finalized; this review is locked")
            draft = self._read_draft_locked()
            answers = list(draft.get("answers") or [])
            self._validate_answers(answers)
            answer_keys = {
                (str(answer["incident_case_id_hash"]), str(answer["episode_key"])) for answer in answers
            }
            expected_keys = {
                (str(item["incident_case_id_hash"]), str(item["episode_key"])) for item in self.queue
            }
            missing = expected_keys - answer_keys
            if missing:
                raise RuntimeError(f"human review is incomplete: {len(missing)} items remain")
            envelope = {
                "answers": answers,
                "review_context_sha256": self.review_manifest["review_context_sha256"],
                "review_queue_kind": "TRIAGED",
                "review_queue_sha256": self.triage_manifest["triage_queue_sha256"],
                "reviewer_type": "HUMAN_CONFIRMED",
                "scan_run_id": self.triage_manifest["scan_run_id"],
            }
            _secure_write(
                self.template_path,
                json.dumps(envelope, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            )
            result = adjudicate_incident_causal_review(self.workspace, self.template_path)
            self.finalized = True
            return result


def _site_root() -> Path:
    # The source checkout is the supported execution surface for this private
    # experiment.  Keeping the assets outside .coordy makes the data files
    # private while leaving the UI inspectable and versionable.
    return Path(__file__).resolve().parents[2] / "web" / "incident-review"


class _ReviewHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], store: ReviewStore, site_root: Path) -> None:
        self.review_store = store
        self.site_root = site_root
        super().__init__(address, _ReviewRequestHandler)
        port = self.server_address[1]
        self.allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}", f"[::1]:{port}"}


class _ReviewRequestHandler(BaseHTTPRequestHandler):
    server: _ReviewHTTPServer

    def log_message(self, format: str, *args: Any) -> None:
        # The UI can contain source excerpts; keep them out of terminal logs.
        return

    def _headers(self, content_type: str, length: int) -> None:
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        )

    def _send_json(self, value: dict[str, Any], status: int = HTTPStatus.OK) -> None:
        content = json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self._headers("application/json; charset=utf-8", len(content))
        self.end_headers()
        self.wfile.write(content)

    def _error(self, status: int, message: str) -> None:
        self._send_json({"error": message, "status": status}, status)

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        path = urlsplit(self.path).path
        try:
            self._validate_host()
            if path == "/api/health":
                self._send_json({"status": "ok"})
                return
            if path == "/api/state":
                self._send_json(self.server.review_store.state())
                return
            if path == "/api/draft":
                with self.server.review_store._lock:
                    self._send_json(self.server.review_store._read_draft_locked())
                return
            if path.startswith("/api/items/"):
                item_id = unquote(path.removeprefix("/api/items/"))
                if not item_id or "/" in item_id:
                    self._error(HTTPStatus.NOT_FOUND, "review item not found")
                    return
                self._send_json(self.server.review_store.item(item_id))
                return
            static = _STATIC_FILES.get(path)
            if static is None:
                self._error(HTTPStatus.NOT_FOUND, "not found")
                return
            filename, content_type = static
            source = self.server.site_root / filename
            if not source.is_file():
                self._error(HTTPStatus.INTERNAL_SERVER_ERROR, "review website asset is missing")
                return
            content = source.read_bytes()
            self.send_response(HTTPStatus.OK)
            self._headers(content_type, len(content))
            self.end_headers()
            self.wfile.write(content)
        except KeyError:
            self._error(HTTPStatus.NOT_FOUND, "review item not found")
        except (RuntimeError, ValueError) as exc:
            self._error(HTTPStatus.BAD_REQUEST, str(exc))

    def _read_json_body(self) -> dict[str, Any]:
        self._validate_host()
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            raise ValueError("state-changing requests must use application/json")
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise ValueError("JSON request must include Content-Length")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ValueError("invalid Content-Length") from exc
        if length < 0 or length > MAX_REQUEST_BYTES:
            raise ValueError("request body is too large")
        body = self.rfile.read(length)
        try:
            value = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("request body must be valid JSON") from exc
        if not isinstance(value, dict):
            raise ValueError("request body must be a JSON object")
        return value

    def _validate_host(self) -> None:
        host = self.headers.get("Host", "").strip().lower()
        if host not in self.server.allowed_hosts:
            raise ValueError("request Host is not an allowed loopback origin")
        origin = self.headers.get("Origin")
        if origin:
            expected_origins = {
                *(f"http://{allowed_host}" for allowed_host in self.server.allowed_hosts),
                *(f"https://{allowed_host}" for allowed_host in self.server.allowed_hosts),
            }
            if origin not in expected_origins:
                raise ValueError("cross-origin request rejected")
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            raise ValueError("cross-site request rejected")

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        path = urlsplit(self.path).path
        try:
            body = self._read_json_body()
            if path == "/api/save-answer":
                item_id = body.get("review_item_id")
                if not isinstance(item_id, str) or not item_id:
                    raise ValueError("review_item_id is required")
                answer = body.get("answer")
                if not isinstance(answer, dict):
                    raise ValueError("answer is required")
                self._send_json({"saved": True, "state": self.server.review_store.save_answer(item_id, answer)})
                return
            if path == "/api/finalize":
                result = self.server.review_store.finalize(body.get("confirm") is True)
                self._send_json({"finalized": True, "result": result})
                return
            self._error(HTTPStatus.NOT_FOUND, "not found")
        except KeyError:
            self._error(HTTPStatus.NOT_FOUND, "review item not found")
        except (RuntimeError, ValueError) as exc:
            self._error(HTTPStatus.BAD_REQUEST, str(exc))


def serve_incident_causal_review(
    workspace: Path, *, host: str = "127.0.0.1", port: int = 8765, site_root: Path | None = None,
) -> None:
    """Serve the review UI on loopback until the user stops it with Ctrl-C."""
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError("the human review website only binds to loopback for data safety")
    root = (site_root or _site_root()).resolve()
    if not root.is_dir():
        raise RuntimeError(f"review website assets are missing: {root}")
    store = ReviewStore(workspace)
    server = _ReviewHTTPServer((host, port), store, root)
    print(f"Coordy human review: http://{host}:{server.server_port}/", flush=True)
    print(f"Saving draft locally under: {store.draft_path}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


__all__ = ["ReviewStore", "serve_incident_causal_review"]
