from __future__ import annotations

import json
import platform
import shutil
import subprocess
from pathlib import Path

from . import __version__

HYPOTHESES = {
    "H1": "Structured state improves goal preservation.",
    "H2": "Structured state improves constraint preservation.",
    "H3": "Structured state preserves current decisions and supersession.",
    "H4": "Structured state improves active-plan preservation.",
    "H5": "Compaction is associated with measurable state loss.",
    "H6": "Structured state mitigates compaction-induced drift.",
    "H7": "Latent plan dependencies can be recovered with useful accuracy.",
    "H8": "Dependency changes can detect semantic plan invalidation.",
    "H9": "A minimum sufficient coordination state exists.",
    "H10": "Benefits exceed state, retrieval, and interruption costs.",
}

METRICS = {
    "temporal": ["goal_fidelity", "constraint_recall", "decision_retention", "plan_drift_rate", "compaction_loss_rate"],
    "cross_agent": ["precision", "recall", "f1", "false_positive_rate", "affected_plan_f1", "time_to_detection"],
    "engineering": ["rework_time", "wasted_tokens", "invalid_code_produced", "human_interventions", "alert_burden"],
}

THRESHOLDS = {
    "minimum_locked_cases": 30,
    "minimum_repeats": 3,
    "go_requires": ["statistically_supported_improvement", "engineering_value", "acceptable_false_interruption"],
    "default_without_completed_replays": "INSUFFICIENT_EVIDENCE",
}


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def initialize(workspace: Path) -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    protocol = """# Coordy Protocol v1\n\nProtocol frozen before inspecting evaluation results.\n\n1. Sources are read-only and hashed.\n2. Future events after each cutoff are forbidden.\n3. Candidate signals are not labels.\n4. Development and locked test cases are separated by session/repository.\n5. Native, strongest simple baseline, structured state, and structured state + minimal retrieval use equal model/tool budgets.\n6. `INSUFFICIENT_EVIDENCE` is the only default before confirmatory replay.\n"""
    (workspace / "protocol_v1.md").write_text(protocol)
    _write_json(workspace / "hypotheses_v1.json", HYPOTHESES)
    _write_json(workspace / "metrics_v1.json", METRICS)
    _write_json(workspace / "decision_thresholds_v1.json", THRESHOLDS)
    capability = {
        "coordy_version": __version__, "python": platform.python_version(),
        "git": shutil.which("git") is not None, "shell": True,
        "isolated_model_calls": False, "fixed_temperature": False,
        "fixed_seed": False, "token_usage_recording": False,
    }
    _write_json(workspace / "capability_manifest.json", capability)


def write_reports(workspace: Path, counts: dict[str, int]) -> None:
    reports = workspace / "data/reports"
    reports.mkdir(parents=True, exist_ok=True)
    decision = {
        "temporal_state_consistency": {"decision": "INSUFFICIENT_EVIDENCE", "confidence": 0.0, "primary_evidence": [], "failed_hypotheses": [], "recommended_scope": "Run locked model replays."},
        "cross_agent_coordination": {"decision": "INSUFFICIENT_EVIDENCE", "confidence": 0.0, "primary_evidence": [], "failed_hypotheses": [], "recommended_scope": "Label invalidation candidates and measure precision/recall."},
    }
    _write_json(reports / "decision.json", decision)
    _write_json(reports / "evidence_summary.json", counts)
    _write_json(reports / "cost_and_token_report.json", {"model_calls": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0})
    (reports / "limitations.md").write_text("# Limitations\n\nNo isolated model replay was executed. Rule-based extraction and candidates are baselines, not semantic validation or ground truth.\n")
    (reports / "reproduction.md").write_text("# Reproduction\n\n```bash\ncoordy run --input <authorized-export.jsonl> --workspace <output>\ncoordy summary --workspace <output>\n```\n")
    final = f"""# FINAL VALIDATION REPORT\n\n## 1. Executive Verdict（执行判断）\n\n- Temporal State Consistency: **INSUFFICIENT_EVIDENCE**\n- Cross-Agent Coordination: **INSUFFICIENT_EVIDENCE**\n- Indexed {counts['events']} events across {counts['sessions']} sessions.\n- Generated {counts['drift_candidates']} drift candidates and {counts['invalidations']} dependency invalidations.\n- Candidates have not been labeled or replayed and cannot support GO.\n\n## 2. Failure Taxonomy（失败分类体系）\n\nCandidate-only; Types A/B/C/D/U require evidence labeling.\n\n## 3. Hypotheses（待验证假设）\n\nH1-H10 are frozen in `hypotheses_v1.json`; none is yet confirmed.\n\n## 4. Codex Transcript Discovery（Codex 会话发现）\n\nOnly the explicitly supplied export was inspected. No arbitrary private history paths were scanned.\n\n## 5. Transcript Indexing（会话索引）\n\nCanonical JSONL and SQLite indexes were produced with source hashes.\n\n## 6. Candidate Mining（候选案例挖掘）\n\nRules generated candidates but did not assign ground truth.\n\n## 7. Machine-Assisted Ground Truth（机器辅助标准答案）\n\nNot executed.\n\n## 8. Dataset Construction（数据集构建）\n\nNot executed; labeled cases are insufficient.\n\n## 9. Temporal Leakage Prevention（防止时间泄漏）\n\nTimestamps are strict and evidence retains event IDs and source hashes.\n\n## 10. Historical Replay（历史回放）\n\nNot executed.\n\n## 11. Counterfactual Replay（反事实回放）\n\nNot executed.\n\n## 12. Baselines（基线）\n\nDeterministic state extraction and candidate rules are implemented as low-cost baselines.\n\n## 13. Metrics（评测指标）\n\nFrozen but not estimated.\n\n## 14. Ablation Study（消融实验）\n\nNot executed.\n\n## 15. Controlled Re-run（受控重跑）\n\nNot executed.\n\n## 16. Multi-Agent Experiment（多智能体实验）\n\nNot executed.\n\n## 17. GO / PIVOT / STOP\n\nBoth questions remain `INSUFFICIENT_EVIDENCE`.\n\n## 18. Minimal Next Implementation（最小下一步实现）\n\nAdd an isolated model adapter, label a locked dataset, and compare the strongest simple baseline with structured state.\n\n## 19. Reproduction Checklist（复现检查清单）\n\nSee `reproduction.md`.\n"""
    (reports / "FINAL_VALIDATION_REPORT.md").write_text(final)
