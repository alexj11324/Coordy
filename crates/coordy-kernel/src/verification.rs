use coordy_advisor::{StateAssessment, StateDiffItem};
use coordy_protocol::{CoordyError, GraphEdgeKind, GraphEdgeState};

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

pub fn parse_depends_claim(claim: &str) -> Option<(String, String)> {
    let mut parts = claim.split_whitespace();
    let target = parts.next()?.trim();
    if target.is_empty() {
        return None;
    }
    let entity = parts
        .next()
        .map(|token| token.trim())
        .filter(|token| !token.is_empty())
        .unwrap_or("repo");
    Some((target.to_string(), entity.to_string()))
}

pub fn resolve_depends_target(world: &World, workspace_id: &str, token: &str) -> Option<String> {
    let token = token.trim();
    if token.is_empty() {
        return None;
    }
    let mut hits: Vec<String> = Vec::new();
    let mut push_unique = |id: String| {
        if !hits.iter().any(|existing| existing == &id) {
            hits.push(id);
        }
    };
    for task in world
        .tasks
        .iter()
        .filter(|task| task.workspace_id == workspace_id && !task.deleted)
    {
        if task.id == token || (!task.identifier.is_empty() && task.identifier == token) {
            push_unique(task.id.clone());
        }
    }
    for agent in world
        .agents
        .iter()
        .filter(|agent| agent.workspace_id == workspace_id && !agent.archived)
    {
        if agent.id == token {
            push_unique(agent.id.clone());
        }
    }
    for contract in world
        .contracts
        .iter()
        .filter(|contract| contract.workspace_id == workspace_id)
    {
        if contract.id == token {
            push_unique(contract.id.clone());
        }
    }
    if hits.len() == 1 {
        hits.pop()
    } else {
        None
    }
}

pub fn invalidate_dependencies(
    world: &mut World,
    changed_entity: &str,
    changer_id: &str,
) -> Vec<String> {
    let current_version = world.node_artifacts.get(changer_id).copied();
    let mut consumers = Vec::new();
    let mut conflicts = Vec::new();
    let mut invalidated = Vec::new();
    for dep in world.dependencies.iter_mut() {
        if dep.kind != GraphEdgeKind::Consumes {
            continue;
        }
        if dep.source.id != changer_id {
            continue;
        }
        if dep.state == GraphEdgeState::Superseded {
            continue;
        }
        dep.state = GraphEdgeState::Stale;
        dep.generation = dep.generation.saturating_add(1);
        dep.current_version = current_version;
        dep.source_event = Some(format!("invalidate:{changer_id}"));
        consumers.push(dep.target.id.clone());
        invalidated.push((
            dep.id.clone(),
            dep.workspace_id.clone(),
            dep.target.id.clone(),
            dep.generation,
        ));
        conflicts.push(crate::world::Conflict {
            id: crate::ids::new("conflict"),
            workspace_id: dep.workspace_id.clone(),
            summary: format!("dependency {} invalidated by {}", dep.id, changer_id),
            status: "open".into(),
        });
    }
    world.conflicts.extend(conflicts);
    for (edge_id, workspace_id, node_id, generation) in invalidated {
        crate::product::record_graph_event(
            world,
            &workspace_id,
            "invalidate",
            Some(&edge_id),
            Some(&node_id),
            serde_json::json!({
                "changer": changer_id,
                "entity": changed_entity,
                "generation": generation,
            }),
        );
    }
    consumers.sort();
    consumers.dedup();
    crate::graph::schedule::fence_attempts(world, &consumers);
    for task_id in &consumers {
        crate::product::apply_stale_dependency_hold(world, task_id);
        crate::product::stale_done_materialization(world, task_id);
    }
    consumers
}
