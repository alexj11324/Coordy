use coordy_protocol::{GraphEdgeKind, GraphEdgeState, RunRole};

use crate::ids;
use crate::world::{GraphRun, NodeAttempt, World};

pub fn open_graph_run(world: &mut World, workspace_id: &str) -> String {
    if let Some(existing) = world
        .graph_runs
        .iter()
        .find(|run| run.workspace_id == workspace_id && run.status == "open")
    {
        return existing.id.clone();
    }
    let id = ids::new("grun");
    world.graph_runs.push(GraphRun {
        id: id.clone(),
        workspace_id: workspace_id.to_string(),
        revision: world.graph_revision,
        status: "open".into(),
    });
    id
}

fn attempt_blocks_claim(status: &str) -> bool {
    matches!(status, "pending" | "claimed" | "running" | "succeeded")
}

pub fn node_on_declared_graph(world: &World, workspace_id: &str, node_id: &str) -> bool {
    world.dependencies.iter().any(|edge| {
        edge.workspace_id == workspace_id
            && edge.state != GraphEdgeState::Superseded
            && matches!(
                edge.kind,
                GraphEdgeKind::Consumes | GraphEdgeKind::Precedence
            )
            && (edge.source.id == node_id || edge.target.id == node_id)
    })
}

pub fn claim_node_attempt(
    world: &mut World,
    graph_run_id: &str,
    workspace_id: &str,
    node_id: &str,
    input_fingerprint: &str,
    role: RunRole,
) -> Option<String> {
    if world.node_attempts.iter().any(|attempt| {
        attempt.node_id == node_id
            && attempt.input_fingerprint == input_fingerprint
            && attempt_blocks_claim(&attempt.lease_status)
            && (attempt.graph_run_id == graph_run_id || attempt.workspace_id == workspace_id)
    }) {
        return None;
    }
    let id = ids::new("gatt");
    world.node_attempts.push(NodeAttempt {
        id: id.clone(),
        graph_run_id: graph_run_id.to_string(),
        workspace_id: workspace_id.to_string(),
        node_id: node_id.to_string(),
        role,
        input_fingerprint: input_fingerprint.to_string(),
        lease_status: "claimed".into(),
        run_id: None,
    });
    Some(id)
}

pub fn bind_attempt_run(world: &mut World, attempt_id: &str, run_id: &str) {
    if let Some(attempt) = world
        .node_attempts
        .iter_mut()
        .find(|attempt| attempt.id == attempt_id)
    {
        attempt.run_id = Some(run_id.to_string());
        attempt.lease_status = "running".into();
    }
}

pub fn complete_attempt_for_run(world: &mut World, run_id: &str, ok: bool) -> Option<String> {
    let attempt = world
        .node_attempts
        .iter_mut()
        .find(|attempt| attempt.run_id.as_deref() == Some(run_id))?;
    if matches!(attempt.lease_status.as_str(), "succeeded" | "failed") {
        return None;
    }
    attempt.lease_status = if ok { "succeeded" } else { "failed" }.into();
    Some(attempt.node_id.clone())
}

pub fn fence_attempts(world: &mut World, node_ids: &[String]) {
    for attempt in world.node_attempts.iter_mut() {
        if node_ids.iter().any(|id| id == &attempt.node_id)
            && attempt_blocks_claim(&attempt.lease_status)
            && attempt.lease_status != "succeeded"
        {
            attempt.lease_status = "paused".into();
        }
    }
}

pub fn trigger_for_role(role: &RunRole) -> &'static str {
    match role {
        RunRole::Executor => "graph_execute",
        RunRole::Validator => "graph_validate",
        RunRole::ConductorReview => "graph_review",
        RunRole::HumanApproval => "graph_resume",
    }
}
