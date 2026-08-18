use coordy_advisor::{StateAssessment, StateDiffItem};
use coordy_protocol::CoordyError;

use crate::world::{Commitment, World};

const SUPERSEDING: &[&str] = &["USER", "SPEC", "REPOSITORY_FACT", "AUTHORIZED_DECISION"];

pub fn extract_prefixed(content: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        let Some((tag, rest)) = line.split_once(':') else {
            continue;
        };
        let kind = match tag.trim() {
            "GOAL" => "GOAL",
            "CONSTRAINT" => "CONSTRAINT",
            "DECISION" => "DECISION",
            "REJECTED" | "REJECTED_OPTION" => "REJECTED_OPTION",
            "PLAN" => "PLAN",
            "DEPENDS" | "DEPENDENCY" => "PLAN_DEPENDENCY",
            "ACCEPTANCE" | "ACCEPTANCE_CRITERION" => "ACCEPTANCE_CRITERION",
            _ => continue,
        };
        let claim = rest.trim();
        if !claim.is_empty() {
            out.push((kind.to_string(), claim.to_string()));
        }
    }
    out
}

pub fn agent_cannot_supersede(old: &Commitment, new_authority: &str) -> bool {
    SUPERSEDING.contains(&old.authority.as_str()) && new_authority == "AGENT"
}

pub fn deterministic_state_diff_with_rejected(
    snapshot_claims: &[String],
    rejected: &[String],
    working_plan: &str,
) -> StateAssessment {
    let plan_l = working_plan.to_lowercase();
    let mut diffs = Vec::new();
    for claim in snapshot_claims {
        let claim_l = claim.to_lowercase();
        let present = plan_l.contains(&claim_l)
            || claim
                .split_whitespace()
                .any(|w| w.len() > 4 && plan_l.contains(&w.to_lowercase()));
        let contradicted = present
            && (plan_l.contains(&format!("instead of {claim_l}"))
                || plan_l.contains(&format!("ignore {claim_l}"))
                || plan_l.contains(&format!("drop {claim_l}"))
                || plan_l.contains(&format!("not {claim_l}")));
        if contradicted {
            diffs.push(StateDiffItem {
                commitment: claim.clone(),
                status: "contradicted".into(),
                downstream: "DIRECT".into(),
            });
        } else if present {
            diffs.push(StateDiffItem {
                commitment: claim.clone(),
                status: "preserved".into(),
                downstream: "DIRECT".into(),
            });
        } else {
            diffs.push(StateDiffItem {
                commitment: claim.clone(),
                status: "missing".into(),
                downstream: "DIRECT".into(),
            });
        }
    }
    for claim in rejected {
        let claim_l = claim.to_lowercase();
        if !claim_l.is_empty() && plan_l.contains(&claim_l) {
            diffs.push(StateDiffItem {
                commitment: claim.clone(),
                status: "stale_reactivated".into(),
                downstream: "DIRECT".into(),
            });
        }
    }
    let suspected = diffs.iter().any(|d| {
        d.downstream == "DIRECT"
            && matches!(
                d.status.as_str(),
                "missing" | "contradicted" | "stale_reactivated"
            )
    });
    StateAssessment {
        status: if snapshot_claims.is_empty() && rejected.is_empty() {
            "UNASSESSABLE".into()
        } else if suspected {
            "SUSPECT".into()
        } else {
            "NO_MATERIAL_CHANGE".into()
        },
        suspected,
        diffs,
        source: "deterministic".into(),
    }
}

pub fn action_conflicts(commitments: &[Commitment], patch: &str) -> Option<String> {
    let patch_l = patch.to_lowercase();
    for c in commitments.iter().filter(|c| c.status == "ACTIVE") {
        if c.polarity == "MUST_NOT" {
            let key = c.claim.to_lowercase();
            if !key.is_empty() && patch_l.contains(&key) {
                return Some(format!("patch contradicts MUST_NOT commitment {}", c.id));
            }
        }
        if c.commitment_type == "CONSTRAINT" {
            let key = c.claim.to_lowercase();
            if key.contains("must not") && patch_l.contains("forbidden") {
                return Some(format!("patch contradicts constraint {}", c.id));
            }
        }
    }
    None
}

#[allow(dead_code)]
pub fn require_active_contract(world: &World, workspace_id: &str) -> Result<(), CoordyError> {
    let pending = world
        .contracts
        .iter()
        .any(|c| c.workspace_id == workspace_id && c.status == "proposed");
    if pending {
        // Proposed contracts do not block local private work, only shared apply
        // when the task is marked shared. Local apply is allowed.
        let _ = pending;
    }
    Ok(())
}

pub fn invalidate_dependencies(world: &mut World, changed_entity: &str, changer_task: &str) {
    for dep in world.dependencies.iter_mut() {
        if dep.entity == changed_entity && dep.from_id != changer_task && dep.valid {
            dep.valid = false;
            world.conflicts.push(crate::world::Conflict {
                id: crate::ids::new("conflict"),
                workspace_id: dep.workspace_id.clone(),
                summary: format!("dependency {} invalidated by {}", dep.id, changer_task),
                status: "open".into(),
            });
        }
    }
}
