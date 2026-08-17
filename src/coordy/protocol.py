from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
from pathlib import Path

from . import __version__

HYPOTHESES = {
    "H1": {"name": "Goal Preservation", "claim": "Structured state improves operational goal fidelity over the strongest simple baseline."},
    "H2": {"name": "Constraint Preservation", "claim": "Structured state preserves hard constraints and reduces violations."},
    "H3": {"name": "Decision Preservation", "claim": "Structured state preserves current decisions, reasons, and rejected alternatives."},
    "H4": {"name": "Active Plan Preservation", "claim": "Structured state distinguishes active, superseded, abandoned, and possible future plans."},
    "H5": {"name": "Compaction-Induced Drift", "claim": "Critical state loss at compaction predicts consequential later drift."},
    "H6": {"name": "Structured State Mitigation", "claim": "Structured state reduces drift versus Native Codex and the strongest simple baseline."},
    "H7": {"name": "Latent Dependency Recovery", "claim": "Plan-assumption-dependency-entity chains can be recovered with useful accuracy."},
    "H8": {"name": "Semantic Invalidation Detection", "claim": "External changes can be mapped to truly invalidated plans with low false-pause cost."},
    "H9": {"name": "Coordination State Sufficiency", "claim": "Structured state plus minimal retrieval approaches cutoff-only full transcript quality at lower context cost."},
    "H10": {"name": "Engineering Value", "claim": "Reduced rework and waste exceed state, retrieval, and interruption costs."},
}

METRICS = {
    "temporal": [
        "goal_fidelity", "goal_contradiction_rate", "constraint_recall",
        "constraint_contradiction_rate", "decision_retention",
        "rejected_alternative_resurrection_rate", "plan_lifecycle_macro_f1",
        "plan_drift_rate", "compaction_loss_rate", "first_drift_time",
        "drift_detection_lead_time", "correct_next_action_rate",
    ],
    "cross_agent": [
        "precision", "recall", "f1", "false_positive_rate",
        "false_interruption_rate", "time_to_detection", "affected_agent_accuracy",
        "affected_plan_f1", "minimal_impact_set_jaccard", "action_severity_accuracy",
    ],
    "engineering": [
        "rework_time", "wasted_agent_time", "wasted_tokens", "invalid_code_produced",
        "reverted_code", "human_interventions", "task_completion_time",
        "constraint_violations", "final_task_correctness", "state_maintenance_cost",
        "retrieval_token_cost", "alert_burden", "false_pause_cost",
    ],
    "reporting": ["effect_size", "95_percent_confidence_interval", "per_case_distribution", "failure_breakdown"],
}

THRESHOLDS = {
    "H1": {"minimum_goal_fidelity_percentage_point_gain": 0.10, "goal_contradiction_rate_must_decrease": True},
    "H2": {"minimum_constraint_recall_percentage_point_gain": 0.10, "minimum_relative_violation_reduction": 0.25},
    "H3": {"minimum_decision_retention_percentage_point_gain": 0.10, "minimum_relative_resurrection_reduction": 0.30},
    "H4": {"minimum_lifecycle_macro_f1": 0.80, "minimum_correct_action_percentage_point_gain": 0.10},
    "H5": {"minimum_auroc": 0.70},
    "H6": {"minimum_relative_drift_reduction": 0.25, "minimum_correct_action_percentage_point_gain": 0.10},
    "H7": {"minimum_entity_binding_f1": 0.75, "minimum_dependency_edge_f1": 0.65},
    "H8": {"minimum_precision": 0.80, "minimum_recall": 0.70, "maximum_false_pause_rate": 0.10},
    "H9": {"maximum_full_transcript_accuracy_gap": 0.05, "minimum_context_token_reduction": 0.70},
    "H10": {"minimum_relative_rework_or_waste_reduction": 0.30, "benefit_must_exceed_coordination_cost": True},
    "minimum_locked_cases": 30,
    "minimum_repeats": 3,
    "maximum_repeats_before_boundary_review": 7,
    "primary_comparison": "structured_state_plus_minimal_retrieval_vs_strongest_simple_baseline",
    "default_without_completed_replays": "INSUFFICIENT_EVIDENCE",
}

SCREENING = {
    "version": "1",
    "allowed_decisions": ["STOP", "PIVOT", "PROCEED_TO_CONFIRMATION"],
    "forbidden_decision": "GO",
    "S0": {
        "maximum_eligible_sessions": 100,
        "target_candidate_decision_points": {"minimum": 20, "maximum": 30},
        "maximum_user_review_cases": 12,
        "stop_if_confirmed_type_abc_below": 5,
        "stop_if_no_observable_engineering_consequence": True,
        "stop_if_comparable_decision_points_below": 10,
    },
    "S1": {
        "target_cases": 15,
        "conditions": ["native", "goal_reinjection", "simple_checkpoint", "structured_state"],
        "target_short_calls": 60,
        "minimum_additional_critical_corrections_over_simple_baseline": 2,
        "pivot_if_simple_baseline_fraction_of_structured": {"minimum": 0.80, "maximum": 0.90},
    },
    "S2": {
        "positive_cases": 15,
        "hard_negative_cases": 15,
        "minimum_precision": 0.80,
        "minimum_recall": 0.70,
        "maximum_false_pause_rate": 0.10,
    },
    "S3": {"maximum_bounded_continuations": 5, "requires_material_action_difference": True},
}

SCREENING_SAMPLING_AMENDMENT = {
    "version": "2",
    "applies_to": "screening_v1.S0 sampling only",
    "gate_changes": "none",
    "reason": "Operator clarified that measured multi-hour Goal duration must take priority over transcript-size proxies.",
    "preferred_goal_minimum_seconds": 7200,
    "maximum_selected_lineage_sessions": 100,
    "independence_units": {
        "goal_root": "An independently timed Goal from the read-only thread_goals catalog.",
        "lineage_session": "A root or descendant rollout associated through session_meta parent_thread_id; descendants are not independently multi-hour Goals.",
    },
    "selection_order": [
        "round_robin_across_eligible_goal_roots",
        "root_rollout_before_descendants_within_each_goal",
        "most_recent_proxy_eligible_rollouts_only_after_goal_lineage",
    ],
    "opportunity_population": {
        "unit": "goal_root_plus_real_compaction_boundary",
        "keyword_rules": "ranking_only_not_population_definition",
        "required_artifact": "opportunity_population.jsonl",
        "prefix_truncation": "fail_closed",
    },
    "stratified_review": {
        "maximum_cases": 12,
        "targets": {"high_signal": 6, "recall_probe": 3, "healthy_hard_negative": 3},
        "answers": ["YES", "NO", "UNCERTAIN"],
        "required_reviewer_types": ["HUMAN_CONFIRMED", "MACHINE_PRELABEL"],
        "machine_prelabels_are_terminal_evidence": False,
        "positive_probe_requires_candidate_expansion": True,
    },
    "pivot_evidence": "Requires 1-4 confirmed classified failures, all in one explicit scenario, plus cases from at least three Goal roots or a separately recorded high-value rationale; repository concentration is not sufficient.",
    "duration_semantics": "goal_time_used_seconds is an observed Codex Goal selection attribute, not a human-equivalent task duration or METR time horizon.",
    "privacy": "Do not select or persist Goal objective text. Added lineage metadata uses a hashed Goal identity; the existing session_id remains solely for frozen source binding.",
}

PROTOCOL_TEXT = """# Coordy Protocol v1

Frozen before inspecting any locked-test result.

## Highest-priority low-cost screening override

Execution begins with Screening S0, not the full confirmatory pipeline. Screening may output only `STOP`, `PIVOT`, or `PROCEED_TO_CONFIRMATION`; it must never output `GO`. The detailed H1-H10 thresholds below remain frozen for later confirmatory validation and are not claims that those experiments have run.

## Questions

1. Does persistent structured state reduce consequential single-agent drift after compaction?
2. Does the same mechanism detect external changes that invalidate another session's active plan?
3. Do measured benefits exceed state, retrieval, alert, and interruption costs?

Temporal State Consistency and Cross-Agent Coordination receive separate `GO`, `PIVOT`, `STOP`, or `INSUFFICIENT_EVIDENCE` decisions.

## Failure taxonomy

- Type A: context loss changes a later decision without a relevant external change.
- Type B: an external change invalidates a once-valid plan and the executor continues from stale assumptions.
- Type C: both external invalidation and context loss are necessary causes.
- Type D: ordinary reasoning or implementation failure despite complete correct state.
- Type U: evidence is incomplete; excluded from confirmatory effect estimates.

Context loss alone is not a failure. It must have a traceable engineering consequence.

## Invariants

1. Sources are read-only and hashed; live SQLite requires an official export or consistent backup before ingestion.
2. Unknown schemas, timestamp conflicts, and incomplete causal chains fail closed.
3. Candidate signals are not labels.
4. Replay input is restricted to events and repository state visible at the registered cutoff.
5. Retrospective outcomes never enter contemporaneous replay inputs.
6. Development and locked test cases are separated by session, task cluster, and repository where possible.
7. Native, strongest simple baseline, structured state, and structured state plus minimal retrieval receive equal model and tool budgets.
8. Goal Reinjection, Better Compaction, Periodic Checkpoint, Generic Memory, and cutoff-only Full Transcript are serious baselines.
9. `INSUFFICIENT_EVIDENCE` is mandatory before confirmatory replay and engineering-value measurement.
10. Raw transcript content and credentials are never written to reports.

## Primary analysis

The primary comparison is Structured State plus Minimal Retrieval versus the strongest simple baseline selected on the development set. Report paired effect sizes, 95% confidence intervals, per-case distributions, failure-type breakdowns, and clustered uncertainty where multiple cases share a session.

## Source-material status

The named report `多人协作智能体：现有技术缺口分析与创业结论.md` was not present when this protocol was frozen. Execution continues, and the report is not treated as experimental ground truth.
"""


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def initialize(workspace: Path) -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    protocol = workspace / "protocol"
    protocol.mkdir(parents=True, exist_ok=True)
    (protocol / "protocol_v1.md").write_text(PROTOCOL_TEXT, encoding="utf-8")
    _write_json(protocol / "screening_v1.json", SCREENING)
    _write_json(protocol / "screening_sampling_amendment_v2.json", SCREENING_SAMPLING_AMENDMENT)
    _write_json(protocol / "hypotheses_v1.json", HYPOTHESES)
    _write_json(protocol / "metrics_v1.json", METRICS)
    _write_json(protocol / "decision_thresholds_v1.json", THRESHOLDS)
    git_version = subprocess.run(["git", "--version"], capture_output=True, text=True, check=False).stdout.strip() if shutil.which("git") else None
    capability = {
        "coordy_version": __version__,
        "operating_system": {"system": platform.system(), "release": platform.release(), "machine": platform.machine()},
        "python": {"available": True, "version": platform.python_version()},
        "git": {"available": shutil.which("git") is not None, "version": git_version},
        "shell": {"available": bool(os.environ.get("SHELL")), "path": os.environ.get("SHELL")},
        "local_file_read": True,
        "local_file_write": True,
        "isolated_model_calls": {"available": False, "status": "not_verified_by_local_harness"},
        "fixed_temperature": {"available": False, "status": "not_verified_by_local_harness"},
        "fixed_seed": {"available": False, "status": "not_verified_by_local_harness"},
        "token_usage_recording": {"available": False, "status": "not_verified_by_local_harness"},
        "default_decision": "INSUFFICIENT_EVIDENCE",
    }
    _write_json(workspace / "data/manifests/capability_manifest.json", capability)


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
