from __future__ import annotations

import hashlib
import json
import os
import platform
import plistlib
import shutil
import sqlite3
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import __version__

ADAPTER_VERSION = "1"
MANIFEST_VERSION = "1"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _run(command: list[str], timeout: int = 10) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            check=False,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"available": False, "error": type(exc).__name__}
    output = "\n".join(
        line for line in (completed.stdout + "\n" + completed.stderr).splitlines()
        if not line.startswith("WARNING:")
    ).strip()
    return {
        "available": completed.returncode == 0,
        "returncode": completed.returncode,
        "output": output,
    }


def _hash_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _prefix_hash(path: Path, limit: int = 1024 * 1024) -> tuple[str, bool]:
    before = path.stat()
    with path.open("rb") as handle:
        content = handle.read(limit)
    after = path.stat()
    changed = (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns)
    return _hash_bytes(content), changed


def _inspect_jsonl_root(root: Path) -> dict[str, Any]:
    files = sorted(root.rglob("*.jsonl")) if root.is_dir() else []
    metadata = []
    for path in files:
        stat = path.stat()
        metadata.append((str(path.relative_to(root)), stat.st_size, stat.st_mtime_ns))
    digest = _hash_bytes(json.dumps(metadata, sort_keys=True).encode())
    top_level_keys: set[str] = set()
    record_types: set[str] = set()
    payload_keys: dict[str, set[str]] = {}
    parse_errors = 0
    sampled_records = 0
    sample_hashes = []
    for path in sorted(files, key=lambda item: item.stat().st_mtime_ns, reverse=True)[:3]:
        prefix_hash, changed = _prefix_hash(path)
        sample_hashes.append({"relative_path": str(path.relative_to(root)), "prefix_sha256": prefix_hash, "prefix_bytes": 1024 * 1024, "changed_while_reading": changed})
        with path.open("rb") as handle:
            for _ in range(64 - sampled_records):
                raw_line = handle.readline(1024 * 1024 + 1)
                if not raw_line:
                    break
                if len(raw_line) > 1024 * 1024:
                    parse_errors += 1
                    break
                line = raw_line.decode("utf-8", errors="strict")
                if sampled_records >= 64:
                    break
                if not line.strip():
                    continue
                sampled_records += 1
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    parse_errors += 1
                    continue
                if not isinstance(row, dict):
                    parse_errors += 1
                    continue
                top_level_keys.update(str(key) for key in row)
                record_type = str(row.get("type") or row.get("record_type") or "unknown")
                record_types.add(record_type)
                payload = row.get("payload")
                if isinstance(payload, dict):
                    payload_keys.setdefault(record_type, set()).update(str(key) for key in payload)
            if sampled_records >= 64:
                break
    sample_changed = any(row["changed_while_reading"] for row in sample_hashes)
    supported = not sample_changed and "session_meta" in record_types and bool({"type", "timestamp"}.issubset(top_level_keys))
    signature_basis = {
        "top_level_keys": sorted(top_level_keys),
        "record_types": sorted(record_types),
        "payload_keys": {key: sorted(value) for key, value in sorted(payload_keys.items())},
    }
    return {
        "source_type": "codex_rollout_jsonl",
        "path": str(root),
        "exists": root.is_dir(),
        "file_count": len(files),
        "total_bytes": sum(item[1] for item in metadata),
        "metadata_sha256": digest,
        "sample_hashes": sample_hashes,
        "sample_changed_while_reading": sample_changed,
        "sampled_records": sampled_records,
        "parse_errors": parse_errors,
        "schema": signature_basis,
        "schema_signature": _hash_bytes(json.dumps(signature_basis, sort_keys=True).encode()),
        "adapter": "codex_rollout_jsonl_v1" if supported else None,
        "supported": supported,
        "read_only": True,
        "content_persisted": False,
    }


def _inspect_sqlite(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {
        "source_type": "sqlite",
        "path": str(path),
        "exists": path.is_file(),
        "read_only": True,
        "snapshot_required_before_ingestion": True,
    }
    if not path.is_file():
        return result
    try:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            connection.execute("PRAGMA query_only=ON")
            tables = [row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )]
            columns = {
                table: [row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')]
                for table in tables
            }
        finally:
            connection.close()
    except sqlite3.Error as exc:
        result.update({"supported": False, "error": type(exc).__name__})
        return result
    signature = _hash_bytes(json.dumps(columns, sort_keys=True).encode())
    result.update({
        "supported": "thread_items" in tables and "thread_turns" in tables,
        "tables": tables,
        "columns": columns,
        "schema_signature": signature,
        "content_hash": "deferred_until_consistent_snapshot",
    })
    return result


def _inspect_app_bundle(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {"path": str(path), "exists": path.is_dir()}
    info = path / "Contents/Info.plist"
    if not info.is_file():
        return result
    try:
        with info.open("rb") as handle:
            plist = plistlib.load(handle)
    except (OSError, plistlib.InvalidFileException):
        result["metadata_readable"] = False
        return result
    result.update({
        "metadata_readable": True,
        "bundle_identifier": plist.get("CFBundleIdentifier"),
        "version": plist.get("CFBundleShortVersionString"),
        "build": plist.get("CFBundleVersion"),
    })
    return result


def _inspect_app_server(codex: Path) -> dict[str, Any]:
    if not codex.is_file():
        return {"available": False, "reason": "codex executable not found"}
    with tempfile.TemporaryDirectory(prefix="coordy-app-server-schema-") as tmp:
        result = _run([str(codex), "app-server", "generate-json-schema", "--experimental", "--out", tmp], timeout=30)
        if not result.get("available"):
            return {"available": False, "reason": result.get("error") or f"exit {result.get('returncode')}"}
        schemas = sorted(Path(tmp).glob("*protocol.v2.schemas.json"))
        if not schemas:
            return {"available": False, "reason": "v2 protocol schema not generated"}
        schema = schemas[0].read_bytes()
    text = schema.decode("utf-8", errors="replace")
    methods = [method for method in ("thread/list", "thread/read", "thread/turns/list") if method in text]
    return {
        "available": False,
        "protocol_available": "thread/list" in methods and "thread/read" in methods,
        "runtime_read_verified": False,
        "reason": "Protocol schema is available, but no read-only connection to a running App Server was verified.",
        "adapter": "codex_app_server_v2",
        "methods": methods,
        "explicit_compaction_event": "ContextCompactedNotification" in text,
        "schema_sha256": _hash_bytes(schema),
        "content_persisted": False,
    }


def discover_codex_environment(
    workspace: Path,
    *,
    codex_home: Path | None = None,
    codex_executable: Path | None = None,
) -> dict[str, Any]:
    """Discover Codex history interfaces without persisting transcript content."""
    started_at = _now()
    executable = Path(codex_executable) if codex_executable is not None else Path(shutil.which("codex") or "")
    version_result = _run([str(executable), "--version"]) if executable.is_file() else {"available": False}
    help_result = _run([str(executable), "--help"]) if executable.is_file() else {"available": False}
    resolved_home = Path(codex_home) if codex_home is not None else Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))

    app_server = _inspect_app_server(executable)
    active_rollouts = _inspect_jsonl_root(resolved_home / "sessions")
    archived_rollouts = _inspect_jsonl_root(resolved_home / "archived_sessions")
    thread_database = _inspect_sqlite(resolved_home / "thread_history_1.sqlite")
    candidates = [
        {"priority": 1, "name": "official_app_server_v2", **app_server},
        {
            "priority": 2,
            "name": "official_cli",
            "available": bool(help_result.get("available")),
            "session_commands": [name for name in ("resume", "archive", "fork") if name in help_result.get("output", "")],
            "export_supported": False,
        },
        {"priority": 4, "name": "thread_history_sqlite", **thread_database},
        {"priority": 6, "name": "active_rollout_jsonl", **active_rollouts},
        {"priority": 6, "name": "archived_rollout_jsonl", **archived_rollouts},
    ]

    if app_server.get("runtime_read_verified"):
        adapter = "codex_app_server_v2"
        secondary = "codex_rollout_jsonl_v1" if active_rollouts.get("supported") else None
        reason = "Official structured thread/list and thread/read calls were verified against a running App Server."
    elif active_rollouts.get("supported") or archived_rollouts.get("supported"):
        adapter = "codex_rollout_jsonl_v1"
        secondary = None
        reason = "Official structured read interface was unavailable; a recognized rollout JSONL schema was detected."
    else:
        adapter = None
        secondary = None
        reason = "No supported read interface or recognized rollout schema was detected."

    source_manifest = {
        "manifest_version": MANIFEST_VERSION,
        "coordy_version": __version__,
        "discovered_at": started_at,
        "platform": {"system": platform.system(), "release": platform.release(), "machine": platform.machine()},
        "python_version": platform.python_version(),
        "codex": {
            "executable": str(executable) if executable.is_file() else None,
            "version": version_result.get("output") if version_result.get("available") else None,
            "home": str(resolved_home),
            "config_source": str(resolved_home / "config.toml") if (resolved_home / "config.toml").is_file() else None,
            "config_content_read": False,
        },
        "desktop_apps": [
            _inspect_app_bundle(Path("/Applications/Codex.app")),
            _inspect_app_bundle(Path.home() / "Applications/Codex.app"),
        ],
        "source_report": {
            "name": "多人协作智能体：现有技术缺口分析与创业结论.md",
            "status": "missing",
            "impact": "Protocol execution continues; the report is not treated as ground truth.",
        },
        "privacy": {"transcript_content_persisted": False, "config_content_read": False, "credentials_read": False},
    }
    selected = {
        "status": "selected" if adapter else "insufficient_evidence",
        "adapter": adapter,
        "adapter_version": ADAPTER_VERSION if adapter else None,
        "secondary_adapter": secondary,
        "reason": reason,
        "limitations": [
            "App-server ThreadItems are documented as lossy for some command executions; rollout JSONL remains a completeness cross-check.",
            "Live SQLite content must use a consistent backup before Phase 0B ingestion.",
        ],
    }
    signatures = {
        "manifest_version": MANIFEST_VERSION,
        "app_server_v2": app_server.get("schema_sha256"),
        "active_rollout_jsonl": active_rollouts.get("schema_signature"),
        "archived_rollout_jsonl": archived_rollouts.get("schema_signature"),
        "thread_history_sqlite": thread_database.get("schema_signature"),
    }
    logs = [
        {"timestamp": started_at, "stage": "environment", "status": "completed"},
        {"timestamp": _now(), "stage": "official_interfaces", "status": "completed", "selected": adapter},
        {"timestamp": _now(), "stage": "bounded_local_candidates", "status": "completed", "candidate_count": len(candidates)},
    ]

    manifests = workspace / "data/manifests"
    _write_json(manifests / "source_manifest.json", source_manifest)
    _write_json(manifests / "storage_candidates.json", {"candidates": candidates})
    _write_json(manifests / "selected_adapter.json", selected)
    _write_json(manifests / "schema_signature.json", signatures)
    (manifests / "discovery_log.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in logs), encoding="utf-8"
    )
    return {
        "selected_adapter": adapter,
        "secondary_adapter": secondary,
        "candidate_count": len(candidates),
        "manifest_directory": str(manifests),
    }
