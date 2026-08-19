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
    matches!(
        status,
        "pending" | "claimed" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted"
    )
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

pub fn ensure_attempt_for_graph_run(world: &mut World, run_id: &str) -> Option<String> {
    if let Some(existing) = world
        .node_attempts
        .iter()
        .find(|attempt| attempt.run_id.as_deref() == Some(run_id))
    {
        return Some(existing.id.clone());
    }
    let run = world.run(run_id)?.clone();
    if !matches!(run.trigger.as_str(), "graph" | "graph_execute")
        || !node_on_declared_graph(world, &run.workspace_id, &run.task_id)
    {
        return None;
    }
    let snapshot = crate::graph::state_from_world(world, &run.workspace_id);
    let fingerprint = crate::graph::input_fingerprint(&snapshot, &run.task_id);
    let graph_run_id = open_graph_run(world, &run.workspace_id);
    let attempt_id = claim_node_attempt(
        world,
        &graph_run_id,
        &run.workspace_id,
        &run.task_id,
        &fingerprint,
        RunRole::Executor,
    )?;
    bind_attempt_run(world, &attempt_id, run_id);
    Some(attempt_id)
}

pub fn finish_attempt_start_error(world: &mut World, attempt_id: &str, run_count_before: usize) {
    let failed_run_id = world
        .runs
        .iter()
        .skip(run_count_before)
        .find(|run| run.status == "failed")
        .map(|run| run.id.clone());
    if let Some(attempt) = world
        .node_attempts
        .iter_mut()
        .find(|attempt| attempt.id == attempt_id)
    {
        if let Some(run_id) = failed_run_id {
            attempt.run_id = Some(run_id);
            attempt.lease_status = "failed".into();
        } else {
            attempt.lease_status = "paused".into();
        }
    }
}

pub fn finish_explicit_retry_start_error(
    world: &mut World,
    attempt_id: &str,
    run_count_before: usize,
) {
    let failed_run_id = world
        .runs
        .iter()
        .skip(run_count_before)
        .find(|run| run.status == "failed")
        .map(|run| run.id.clone());
    if let Some(run_id) = failed_run_id {
        if let Some(attempt) = world
            .node_attempts
            .iter_mut()
            .find(|attempt| attempt.id == attempt_id)
        {
            attempt.run_id = Some(run_id);
            attempt.lease_status = "failed".into();
        }
    } else {
        world
            .node_attempts
            .retain(|attempt| attempt.id != attempt_id);
    }
}

pub fn cancel_attempt_for_run(world: &mut World, run_id: &str) -> Option<String> {
    let attempt = world
        .node_attempts
        .iter_mut()
        .find(|attempt| attempt.run_id.as_deref() == Some(run_id))?;
    if !matches!(attempt.lease_status.as_str(), "claimed" | "running") {
        return None;
    }
    attempt.lease_status = "cancelled".into();
    Some(attempt.node_id.clone())
}

pub fn claim_explicit_retry(
    world: &mut World,
    prior_run_id: &str,
) -> Option<(String, String, String)> {
    let prior_index = world.node_attempts.iter().position(|attempt| {
        attempt.run_id.as_deref() == Some(prior_run_id)
            && matches!(
                attempt.lease_status.as_str(),
                "failed" | "cancelled" | "interrupted"
            )
    })?;
    let prior = world.node_attempts[prior_index].clone();
    let newest_index = world.node_attempts.iter().rposition(|attempt| {
        attempt.workspace_id == prior.workspace_id
            && attempt.node_id == prior.node_id
            && attempt.input_fingerprint == prior.input_fingerprint
    })?;
    if newest_index != prior_index {
        return None;
    }
    let id = ids::new("gatt");
    world.node_attempts.push(NodeAttempt {
        id: id.clone(),
        graph_run_id: prior.graph_run_id,
        workspace_id: prior.workspace_id,
        node_id: prior.node_id.clone(),
        role: prior.role,
        input_fingerprint: prior.input_fingerprint.clone(),
        lease_status: "claimed".into(),
        run_id: None,
    });
    Some((id, prior.node_id, prior.input_fingerprint))
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

pub fn pause_attempt_for_run(world: &mut World, run_id: &str) -> Option<String> {
    let attempt = world
        .node_attempts
        .iter_mut()
        .find(|attempt| attempt.run_id.as_deref() == Some(run_id))?;
    if !matches!(attempt.lease_status.as_str(), "claimed" | "running") {
        return None;
    }
    attempt.lease_status = "paused".into();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interrupted_attempt_blocks_automatic_claim_but_allows_explicit_retry() {
        let mut world = World::default();
        world.node_attempts.push(NodeAttempt {
            id: "attempt-old".into(),
            graph_run_id: "graph-run".into(),
            workspace_id: "workspace".into(),
            node_id: "task".into(),
            role: RunRole::Executor,
            input_fingerprint: "fingerprint".into(),
            lease_status: "interrupted".into(),
            run_id: Some("run-old".into()),
        });

        assert!(claim_node_attempt(
            &mut world,
            "graph-run",
            "workspace",
            "task",
            "fingerprint",
            RunRole::Executor,
        )
        .is_none());

        let retry = claim_explicit_retry(&mut world, "run-old")
            .expect("explicit retry should create a fresh attempt");
        assert_eq!(retry.1, "task");
        assert!(world.node_attempts.iter().any(|attempt| {
            attempt.id == retry.0 && attempt.run_id.is_none() && attempt.lease_status == "claimed"
        }));
    }
}
