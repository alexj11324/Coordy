//! Pure graph evaluator. No world lock, no harness spawn.

pub mod schedule;

pub const GRAPH_ENGINEERING_SKILL: &str = "# 图工程\n\
\n\
- 因果方向：source 是上游，target 是下游。\n\
- 确认失效 Consumes 必须带 expected_generation；确认本身不会开工。\n\
- 调度器只执行评估器 ready set。A→B 两边都指派时只启动上游 A。\n\
- 执行者 run 写 REAFFIRM: 无效；验证走 ConductorReview 或人工 ValidationDecision。\n";

use std::collections::{HashMap, HashSet};

use coordy_protocol::{
    BlockedNodeView, GraphEdgeKind, GraphEdgeState, GraphEvaluationView, NodeKind, NodeRef,
};

use crate::world::{GraphEdge, GraphEvent, NodeMaterialization, World};

#[derive(Clone, Debug, Default)]
pub struct GraphState {
    pub workspace_id: String,
    pub revision: u64,
    pub nodes: HashMap<String, EvalNode>,
    pub edges: HashMap<String, GraphEdge>,
    pub materializations: HashMap<String, NodeMaterialization>,
    pub artifacts: HashMap<String, u64>,
    pub successes: HashSet<(String, String)>,
    pub inflight: HashSet<String>,
}

#[derive(Clone, Debug)]
pub struct EvalNode {
    pub id: String,
    pub kind: NodeKind,
    pub workspace_id: String,
    pub done: bool,
}

#[derive(Clone, Debug)]
pub enum GraphLogEvent {
    Declare {
        edge: GraphEdge,
    },
    Invalidate {
        changer: String,
        entity: String,
    },
    Reaffirm {
        edge_id: String,
        expected_generation: u64,
    },
    ArtifactBumped {
        node_id: String,
        revision: u64,
    },
    TaskSucceeded {
        node_id: String,
    },
    AttemptCompleted {
        node_id: String,
        input_fingerprint: String,
        ok: bool,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GraphDefinitionError {
    pub diagnostics: Vec<String>,
}

pub fn validate_graph_definition(
    nodes: &[EvalNode],
    edges: &[GraphEdge],
) -> Result<(), GraphDefinitionError> {
    let mut diagnostics = Vec::new();
    let workspace = nodes.first().map(|node| node.workspace_id.as_str());
    let known: HashSet<&str> = nodes.iter().map(|node| node.id.as_str()).collect();
    for node in nodes {
        if let Some(ws) = workspace {
            if node.workspace_id != ws {
                diagnostics.push(format!("{}: 跨工作区", node.id));
            }
        }
    }
    for edge in edges {
        if !known.contains(edge.source.id.as_str()) {
            diagnostics.push(format!("{}: 悬空 source {}", edge.id, edge.source.id));
        }
        if !known.contains(edge.target.id.as_str()) {
            diagnostics.push(format!("{}: 悬空 target {}", edge.id, edge.target.id));
        }
        if edge.source.id == edge.target.id {
            diagnostics.push(format!("{}: 自环", edge.id));
        }
        if let Some(ws) = workspace {
            if edge.workspace_id != ws {
                diagnostics.push(format!("{}: 跨工作区", edge.id));
            }
        }
        match edge.kind {
            GraphEdgeKind::Produces
            | GraphEdgeKind::RequiresApproval
            | GraphEdgeKind::Authority => {
                diagnostics.push(format!("{}: 尚未支持该依赖类型", edge.id));
            }
            _ => {}
        }
    }
    if cycle_exists(edges) {
        diagnostics.push("依赖不能形成循环".into());
    }
    if diagnostics.is_empty() {
        Ok(())
    } else {
        Err(GraphDefinitionError { diagnostics })
    }
}

fn cycle_exists(edges: &[GraphEdge]) -> bool {
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in edges {
        if edge.state == GraphEdgeState::Superseded {
            continue;
        }
        if matches!(
            edge.kind,
            GraphEdgeKind::Precedence | GraphEdgeKind::Consumes
        ) {
            adj.entry(edge.source.id.as_str())
                .or_default()
                .push(edge.target.id.as_str());
        }
    }
    fn dfs(
        node: &str,
        adj: &HashMap<&str, Vec<&str>>,
        stack: &mut HashSet<String>,
        seen: &mut HashSet<String>,
    ) -> bool {
        if !stack.insert(node.to_string()) {
            return true;
        }
        if seen.insert(node.to_string()) {
            if let Some(next) = adj.get(node) {
                for child in next {
                    if dfs(child, adj, stack, seen) {
                        return true;
                    }
                }
            }
        }
        stack.remove(node);
        false
    }
    let mut seen = HashSet::new();
    let mut stack = HashSet::new();
    adj.keys()
        .any(|node| dfs(node, &adj, &mut stack, &mut seen))
}

pub fn input_fingerprint(state: &GraphState, node_id: &str) -> String {
    let mut parts: Vec<String> = state
        .edges
        .values()
        .filter(|edge| {
            edge.target.id == node_id
                && edge.state != GraphEdgeState::Superseded
                && matches!(
                    edge.kind,
                    GraphEdgeKind::Precedence | GraphEdgeKind::Consumes
                )
        })
        .map(|edge| {
            format!(
                "{}:{}:{}:{}",
                edge.id,
                edge.source.id,
                edge.current_version.unwrap_or(0),
                edge.generation
            )
        })
        .collect();
    parts.sort();
    if parts.is_empty() {
        "root".into()
    } else {
        parts.join("|")
    }
}

fn upstream_succeeded(state: &GraphState, node_id: &str) -> bool {
    if state.nodes.get(node_id).is_some_and(|node| node.done) {
        return true;
    }
    state.successes.iter().any(|(id, _fp)| id == node_id)
}

pub fn evaluate_ready_set(state: &GraphState) -> GraphEvaluationView {
    let mut ready_nodes = Vec::new();
    let mut blocked_nodes = Vec::new();
    let mut stale_nodes = Vec::new();
    let mut required_validations = Vec::new();
    let mut diagnostics = Vec::new();

    let mut task_ids: Vec<String> = state
        .nodes
        .values()
        .filter(|node| node.kind == NodeKind::Task)
        .map(|node| node.id.clone())
        .collect();
    task_ids.sort();

    for node_id in task_ids {
        let fp = input_fingerprint(state, &node_id);
        let done = state.nodes.get(&node_id).is_some_and(|node| node.done);
        let stale_mat = state
            .materializations
            .get(&node_id)
            .is_some_and(|row| row.state == GraphEdgeState::Stale);
        if stale_mat {
            stale_nodes.push(node_id.clone());
            if done {
                diagnostics.push(format!("{node_id}: done materialization is stale"));
            }
        }
        if state.successes.contains(&(node_id.clone(), fp.clone())) {
            continue;
        }
        if state.inflight.contains(&node_id) {
            blocked_nodes.push(BlockedNodeView {
                node_id,
                reasons: vec!["in-flight attempt".into()],
            });
            continue;
        }
        let mut reasons = Vec::new();
        for edge in state.edges.values() {
            if edge.target.id != node_id || edge.state == GraphEdgeState::Superseded {
                continue;
            }
            match edge.kind {
                GraphEdgeKind::Precedence => {
                    if !upstream_succeeded(state, &edge.source.id) {
                        reasons.push(format!("waiting on precedence {}", edge.source.id));
                    }
                }
                GraphEdgeKind::Consumes => {
                    if edge.state.blocks_consumer() {
                        reasons.push(format!("consumes {} not active", edge.source.id));
                        required_validations.push(node_id.clone());
                    } else if edge.observed_version != edge.current_version {
                        reasons.push(format!("consumes {} version mismatch", edge.source.id));
                        required_validations.push(node_id.clone());
                    }
                    if !upstream_succeeded(state, &edge.source.id) {
                        reasons.push(format!("waiting on producer {}", edge.source.id));
                    }
                }
                _ => {}
            }
        }
        if reasons.is_empty() {
            ready_nodes.push(node_id);
        } else {
            blocked_nodes.push(BlockedNodeView { node_id, reasons });
        }
    }

    required_validations.sort();
    required_validations.dedup();
    GraphEvaluationView {
        graph_revision: state.revision,
        ready_nodes,
        blocked_nodes,
        stale_nodes,
        required_validations,
        diagnostics,
    }
}

pub fn compute_invalidation_closure(state: &GraphState, event: &GraphLogEvent) -> Vec<String> {
    let changer = match event {
        GraphLogEvent::ArtifactBumped { node_id, .. } => node_id.as_str(),
        GraphLogEvent::Invalidate { changer, .. } => changer.as_str(),
        _ => return Vec::new(),
    };
    let entity = match event {
        GraphLogEvent::Invalidate { entity, .. } => Some(entity.as_str()),
        _ => None,
    };
    let mut ids: Vec<String> = state
        .edges
        .values()
        .filter(|edge| {
            edge.kind == GraphEdgeKind::Consumes
                && edge.source.id == changer
                && (entity.is_none() || entity == Some(edge.entity.as_str()))
                && (edge.state.is_active() || edge.state == GraphEdgeState::PendingValidation)
        })
        .map(|edge| edge.id.clone())
        .collect();
    ids.sort();
    ids
}

fn mark_consumes_stale(state: &mut GraphState, changer: &str, entity: Option<&str>) {
    let revision = state.artifacts.get(changer).copied();
    for edge in state.edges.values_mut() {
        if edge.kind != GraphEdgeKind::Consumes {
            continue;
        }
        if edge.source.id != changer {
            continue;
        }
        if let Some(entity) = entity {
            if edge.entity != entity {
                continue;
            }
        }
        if !edge.state.is_active() && edge.state != GraphEdgeState::PendingValidation {
            continue;
        }
        edge.state = GraphEdgeState::Stale;
        edge.generation = edge.generation.saturating_add(1);
        edge.current_version = revision;
        let target = edge.target.id.clone();
        if state.nodes.get(&target).is_some_and(|node| node.done) {
            let mat = NodeMaterialization {
                workspace_id: state.workspace_id.clone(),
                node: NodeRef::task(&target),
                state: GraphEdgeState::Stale,
                artifact_revision: state.artifacts.get(&target).copied().unwrap_or(0),
                updated_at: String::new(),
            };
            state.materializations.insert(target, mat);
        }
    }
    state.revision = state.revision.saturating_add(1);
}

pub fn apply_event(state: &mut GraphState, event: &GraphLogEvent) {
    match event {
        GraphLogEvent::Declare { edge } => {
            state.workspace_id = edge.workspace_id.clone();
            state
                .nodes
                .entry(edge.source.id.clone())
                .or_insert_with(|| EvalNode {
                    id: edge.source.id.clone(),
                    kind: edge.source.kind.clone(),
                    workspace_id: edge.workspace_id.clone(),
                    done: false,
                });
            state
                .nodes
                .entry(edge.target.id.clone())
                .or_insert_with(|| EvalNode {
                    id: edge.target.id.clone(),
                    kind: edge.target.kind.clone(),
                    workspace_id: edge.workspace_id.clone(),
                    done: false,
                });
            state.edges.insert(edge.id.clone(), edge.clone());
            state.revision = state.revision.saturating_add(1);
        }
        GraphLogEvent::ArtifactBumped { node_id, revision } => {
            state.artifacts.insert(node_id.clone(), *revision);
            mark_consumes_stale(state, node_id, None);
        }
        GraphLogEvent::Invalidate { changer, entity } => {
            mark_consumes_stale(state, changer, Some(entity));
        }
        GraphLogEvent::Reaffirm {
            edge_id,
            expected_generation,
        } => {
            if let Some(edge) = state.edges.get_mut(edge_id) {
                if edge.generation == *expected_generation {
                    edge.state = GraphEdgeState::Active;
                    edge.observed_version = edge.current_version;
                }
            }
            state.revision = state.revision.saturating_add(1);
        }
        GraphLogEvent::TaskSucceeded { node_id } => {
            let fp = input_fingerprint(state, node_id);
            state.successes.insert((node_id.clone(), fp));
            if let Some(node) = state.nodes.get_mut(node_id) {
                node.done = true;
            } else {
                state.nodes.insert(
                    node_id.clone(),
                    EvalNode {
                        id: node_id.clone(),
                        kind: NodeKind::Task,
                        workspace_id: state.workspace_id.clone(),
                        done: true,
                    },
                );
            }
            state.inflight.remove(node_id);
            state.revision = state.revision.saturating_add(1);
        }
        GraphLogEvent::AttemptCompleted {
            node_id,
            input_fingerprint,
            ok,
        } => {
            state.inflight.remove(node_id);
            if *ok {
                state
                    .successes
                    .insert((node_id.clone(), input_fingerprint.clone()));
            }
            state.revision = state.revision.saturating_add(1);
        }
    }
}

pub fn simulate_graph(initial: GraphState, events: &[GraphLogEvent]) -> GraphState {
    let mut state = initial;
    for event in events {
        apply_event(&mut state, event);
    }
    state
}

pub fn replay_graph(events: &[GraphLogEvent]) -> GraphState {
    simulate_graph(GraphState::default(), events)
}

pub fn log_event_from_record(record: &GraphEvent) -> Option<GraphLogEvent> {
    match record.kind.as_str() {
        "declare" => {
            let source = record.payload.get("source")?.as_str()?.to_string();
            let target = record.payload.get("target")?.as_str()?.to_string();
            let source_kind = match record.payload.get("source_kind") {
                Some(value) => serde_json::from_value(value.clone()).ok()?,
                None => NodeKind::Task,
            };
            let target_kind = match record.payload.get("target_kind") {
                Some(value) => serde_json::from_value(value.clone()).ok()?,
                None => NodeKind::Task,
            };
            let kind = match record.payload.get("kind") {
                Some(value) => serde_json::from_value(value.clone()).ok()?,
                None => GraphEdgeKind::Consumes,
            };
            let observed_version = match record.payload.get("observed_version") {
                Some(value) => value.as_u64()?,
                None => 0,
            };
            let current_version = match record.payload.get("current_version") {
                Some(value) => value.as_u64()?,
                None => observed_version,
            };
            Some(GraphLogEvent::Declare {
                edge: GraphEdge {
                    id: record.edge_id.clone().unwrap_or_else(|| record.id.clone()),
                    workspace_id: record.workspace_id.clone(),
                    source: NodeRef {
                        kind: source_kind,
                        id: source,
                    },
                    target: NodeRef {
                        kind: target_kind,
                        id: target,
                    },
                    kind,
                    entity: record
                        .payload
                        .get("entity")
                        .and_then(|v| v.as_str())
                        .unwrap_or("repo")
                        .to_string(),
                    state: GraphEdgeState::Active,
                    generation: 1,
                    origin_run_id: record
                        .payload
                        .get("origin_run_id")
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                    actor_id: None,
                    reason: None,
                    source_event: Some("declare".into()),
                    created_at: record.at.clone(),
                    selector_path: None,
                    observed_version: Some(observed_version),
                    current_version: Some(current_version),
                },
            })
        }
        "invalidate" => Some(GraphLogEvent::Invalidate {
            changer: record
                .payload
                .get("changer")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            entity: record
                .payload
                .get("entity")
                .and_then(|v| v.as_str())
                .unwrap_or("repo")
                .to_string(),
        }),
        "reaffirm" => Some(GraphLogEvent::Reaffirm {
            edge_id: record.edge_id.clone()?,
            expected_generation: record
                .payload
                .get("generation")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
        }),
        "artifact_bumped" => Some(GraphLogEvent::ArtifactBumped {
            node_id: record.node_id.clone()?,
            revision: record
                .payload
                .get("revision")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
        }),
        "task_succeeded" => Some(GraphLogEvent::TaskSucceeded {
            node_id: record.node_id.clone()?,
        }),
        _ => None,
    }
}

pub fn state_from_world(world: &World, workspace_id: &str) -> GraphState {
    let mut state = GraphState {
        workspace_id: workspace_id.to_string(),
        revision: world.graph_revision,
        ..GraphState::default()
    };
    for task in world
        .tasks
        .iter()
        .filter(|task| task.workspace_id == workspace_id && !task.deleted)
    {
        state.nodes.insert(
            task.id.clone(),
            EvalNode {
                id: task.id.clone(),
                kind: NodeKind::Task,
                workspace_id: task.workspace_id.clone(),
                done: task.status == "done",
            },
        );
    }
    for edge in world
        .dependencies
        .iter()
        .filter(|edge| edge.workspace_id == workspace_id)
    {
        state.edges.insert(edge.id.clone(), edge.clone());
    }
    for blocker in world
        .issue_blockers
        .iter()
        .filter(|edge| edge.workspace_id == workspace_id)
    {
        let id = format!("blocker:{}:{}", blocker.blocker_id, blocker.task_id);
        state.edges.insert(
            id.clone(),
            GraphEdge {
                id,
                workspace_id: workspace_id.to_string(),
                source: NodeRef::task(&blocker.blocker_id),
                target: NodeRef::task(&blocker.task_id),
                kind: GraphEdgeKind::Precedence,
                entity: "issue".into(),
                state: GraphEdgeState::Active,
                generation: 0,
                origin_run_id: None,
                actor_id: None,
                reason: None,
                source_event: None,
                created_at: String::new(),
                selector_path: None,
                observed_version: None,
                current_version: None,
            },
        );
    }
    for row in world
        .materializations
        .iter()
        .filter(|row| row.workspace_id == workspace_id)
    {
        state
            .materializations
            .insert(row.node.id.clone(), row.clone());
    }
    state.artifacts = world.node_artifacts.clone();
    for attempt in world
        .node_attempts
        .iter()
        .filter(|attempt| attempt.workspace_id == workspace_id)
    {
        if matches!(
            attempt.lease_status.as_str(),
            "pending" | "claimed" | "running"
        ) {
            state.inflight.insert(attempt.node_id.clone());
        }
    }
    let done_ids: Vec<String> = state
        .nodes
        .values()
        .filter(|node| node.done)
        .map(|node| node.id.clone())
        .collect();
    for node_id in done_ids {
        let stale = state
            .materializations
            .get(&node_id)
            .is_some_and(|row| row.state == GraphEdgeState::Stale);
        if stale {
            continue;
        }
        let fp = input_fingerprint(&state, &node_id);
        state.successes.insert((node_id, fp));
    }
    for record in world
        .graph_events
        .iter()
        .filter(|event| event.workspace_id == workspace_id)
    {
        if let Some(GraphLogEvent::TaskSucceeded { node_id }) = log_event_from_record(record) {
            let fp = record
                .payload
                .get("input_fingerprint")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| input_fingerprint(&state, &node_id));
            state.successes.insert((node_id, fp));
        }
    }
    state
}

pub fn evaluate_world(world: &World, workspace_id: &str) -> GraphEvaluationView {
    evaluate_ready_set(&state_from_world(world, workspace_id))
}

#[allow(clippy::too_many_arguments)]
fn edge(
    id: &str,
    source: &str,
    target: &str,
    kind: GraphEdgeKind,
    state: GraphEdgeState,
    generation: u64,
    observed: Option<u64>,
    current: Option<u64>,
) -> GraphEdge {
    GraphEdge {
        id: id.into(),
        workspace_id: "ws".into(),
        source: NodeRef::task(source),
        target: NodeRef::task(target),
        kind,
        entity: "repo".into(),
        state,
        generation,
        origin_run_id: None,
        actor_id: None,
        reason: None,
        source_event: None,
        created_at: String::new(),
        selector_path: None,
        observed_version: observed,
        current_version: current,
    }
}

fn task_node(id: &str) -> EvalNode {
    EvalNode {
        id: id.into(),
        kind: NodeKind::Task,
        workspace_id: "ws".into(),
        done: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn declare_prec(source: &str, target: &str) -> GraphLogEvent {
        GraphLogEvent::Declare {
            edge: edge(
                &format!("p-{source}-{target}"),
                source,
                target,
                GraphEdgeKind::Precedence,
                GraphEdgeState::Active,
                1,
                None,
                None,
            ),
        }
    }

    fn declare_cons(source: &str, target: &str, version: u64) -> GraphLogEvent {
        GraphLogEvent::Declare {
            edge: edge(
                &format!("c-{source}-{target}"),
                source,
                target,
                GraphEdgeKind::Consumes,
                GraphEdgeState::Active,
                1,
                Some(version),
                Some(version),
            ),
        }
    }

    #[test]
    fn ready_set_only_opens_upstream_of_a_to_b() {
        let state = replay_graph(&[declare_prec("A", "B"), declare_cons("A", "B", 0)]);
        let eval = evaluate_ready_set(&state);
        assert_eq!(eval.ready_nodes, vec!["A".to_string()]);
        assert!(eval.blocked_nodes.iter().any(|row| row.node_id == "B"));
    }

    #[test]
    fn b_becomes_ready_once_after_a_succeeds_at_v1() {
        let state = replay_graph(&[
            declare_prec("A", "B"),
            declare_cons("A", "B", 1),
            GraphLogEvent::TaskSucceeded {
                node_id: "A".into(),
            },
        ]);
        let eval = evaluate_ready_set(&state);
        assert_eq!(eval.ready_nodes, vec!["B".to_string()]);
        let again = simulate_graph(
            state,
            &[GraphLogEvent::TaskSucceeded {
                node_id: "B".into(),
            }],
        );
        let after_b = evaluate_ready_set(&again);
        assert!(after_b.ready_nodes.is_empty());
        let rerun_a = simulate_graph(
            again,
            &[GraphLogEvent::TaskSucceeded {
                node_id: "A".into(),
            }],
        );
        let eval = evaluate_ready_set(&rerun_a);
        assert!(
            !eval.ready_nodes.contains(&"B".to_string()),
            "same v1 fingerprint must not re-ready B"
        );
    }

    #[test]
    fn artifact_v2_stales_b_and_readies_once() {
        let state = replay_graph(&[
            declare_prec("A", "B"),
            declare_cons("A", "B", 1),
            GraphLogEvent::TaskSucceeded {
                node_id: "A".into(),
            },
            GraphLogEvent::TaskSucceeded {
                node_id: "B".into(),
            },
            GraphLogEvent::ArtifactBumped {
                node_id: "A".into(),
                revision: 2,
            },
        ]);
        let eval = evaluate_ready_set(&state);
        assert!(eval.stale_nodes.contains(&"B".to_string()));
        assert!(eval.required_validations.contains(&"B".to_string()));
        assert!(!eval.ready_nodes.contains(&"B".to_string()));
        let reaffirmed = simulate_graph(
            state,
            &[GraphLogEvent::Reaffirm {
                edge_id: "c-A-B".into(),
                expected_generation: 2,
            }],
        );
        let eval = evaluate_ready_set(&reaffirmed);
        assert_eq!(eval.ready_nodes.iter().filter(|id| *id == "B").count(), 1);
    }

    #[test]
    fn join_waits_for_both_upstreams() {
        let only_a = replay_graph(&[
            declare_prec("A", "B"),
            declare_prec("C", "B"),
            GraphLogEvent::TaskSucceeded {
                node_id: "A".into(),
            },
        ]);
        let eval = evaluate_ready_set(&only_a);
        assert!(!eval.ready_nodes.contains(&"B".to_string()));
        let both = simulate_graph(
            only_a,
            &[GraphLogEvent::TaskSucceeded {
                node_id: "C".into(),
            }],
        );
        let eval = evaluate_ready_set(&both);
        assert!(eval.ready_nodes.contains(&"B".to_string()));
    }

    #[test]
    fn done_task_stays_done_when_producer_changes() {
        let mut initial = replay_graph(&[declare_cons("A", "B", 1)]);
        if let Some(node) = initial.nodes.get_mut("B") {
            node.done = true;
        }
        let state = simulate_graph(
            initial,
            &[GraphLogEvent::ArtifactBumped {
                node_id: "A".into(),
                revision: 2,
            }],
        );
        assert!(state.nodes.get("B").is_some_and(|node| node.done));
        let eval = evaluate_ready_set(&state);
        assert!(eval.stale_nodes.contains(&"B".to_string()));
        assert!(!eval.ready_nodes.contains(&"B".to_string()));
    }

    #[test]
    fn stale_generation_reaffirm_does_not_activate() {
        let state = replay_graph(&[
            declare_cons("A", "B", 1),
            GraphLogEvent::ArtifactBumped {
                node_id: "A".into(),
                revision: 2,
            },
            GraphLogEvent::Reaffirm {
                edge_id: "c-A-B".into(),
                expected_generation: 1,
            },
        ]);
        let edge = state.edges.get("c-A-B").expect("edge");
        assert_eq!(edge.state, GraphEdgeState::Stale);
        assert_eq!(edge.generation, 2);
        let eval = evaluate_ready_set(&state);
        assert!(eval.required_validations.contains(&"B".to_string()));
        assert!(!eval.ready_nodes.contains(&"B".to_string()));
    }

    #[test]
    fn validate_rejects_dangling_and_cross_workspace() {
        let nodes = vec![task_node("A")];
        let dangling = [edge(
            "e1",
            "A",
            "missing",
            GraphEdgeKind::Consumes,
            GraphEdgeState::Active,
            1,
            Some(0),
            Some(0),
        )];
        let err = validate_graph_definition(&nodes, &dangling).unwrap_err();
        assert!(err.diagnostics.iter().any(|d| d.contains("悬空")));

        let mut foreign = task_node("B");
        foreign.workspace_id = "other".into();
        let err = validate_graph_definition(&[task_node("A"), foreign], &[]).unwrap_err();
        assert!(err.diagnostics.iter().any(|d| d.contains("跨工作区")));
    }

    #[test]
    fn replay_is_deterministic() {
        let events = vec![
            declare_prec("A", "B"),
            declare_cons("A", "B", 1),
            GraphLogEvent::TaskSucceeded {
                node_id: "A".into(),
            },
        ];
        let first = evaluate_ready_set(&replay_graph(&events));
        let second = evaluate_ready_set(&replay_graph(&events));
        assert_eq!(first.ready_nodes, second.ready_nodes);
    }

    #[test]
    fn persisted_declare_replays_typed_edge_and_versions() {
        let record = GraphEvent {
            id: "event-1".into(),
            workspace_id: "ws".into(),
            kind: "declare".into(),
            at: "2026-08-19T00:00:00Z".into(),
            edge_id: Some("edge-1".into()),
            node_id: Some("task-1".into()),
            payload: serde_json::json!({
                "source": "agent-1",
                "target": "task-1",
                "source_kind": "agent",
                "target_kind": "task",
                "kind": "assigned_to",
                "entity": "assignment",
                "observed_version": 7,
                "current_version": 9,
            }),
        };

        let GraphLogEvent::Declare { edge } = log_event_from_record(&record).expect("declare")
        else {
            panic!("expected declare event");
        };
        assert_eq!(edge.source.kind, NodeKind::Agent);
        assert_eq!(edge.target.kind, NodeKind::Task);
        assert_eq!(edge.kind, GraphEdgeKind::AssignedTo);
        assert_eq!(edge.observed_version, Some(7));
        assert_eq!(edge.current_version, Some(9));
    }

    #[test]
    fn persisted_declare_rejects_malformed_typed_fields() {
        for payload in [
            serde_json::json!({ "source": "a", "target": "b", "source_kind": "bogus" }),
            serde_json::json!({ "source": "a", "target": "b", "kind": "bogus" }),
            serde_json::json!({ "source": "a", "target": "b", "observed_version": "7" }),
            serde_json::json!({ "source": "a", "target": "b", "current_version": -1 }),
        ] {
            let record = GraphEvent {
                id: "event-bad".into(),
                workspace_id: "ws".into(),
                kind: "declare".into(),
                at: "2026-08-19T00:00:00Z".into(),
                edge_id: None,
                node_id: None,
                payload,
            };
            assert!(log_event_from_record(&record).is_none());
        }
    }

    #[test]
    fn concurrent_success_attempts_count_once() {
        let mut state = replay_graph(&[declare_prec("A", "B")]);
        let fp = input_fingerprint(&state, "A");
        apply_event(
            &mut state,
            &GraphLogEvent::AttemptCompleted {
                node_id: "A".into(),
                input_fingerprint: fp.clone(),
                ok: true,
            },
        );
        apply_event(
            &mut state,
            &GraphLogEvent::AttemptCompleted {
                node_id: "A".into(),
                input_fingerprint: fp.clone(),
                ok: true,
            },
        );
        assert_eq!(
            state
                .successes
                .iter()
                .filter(|(id, print)| id == "A" && *print == fp)
                .count(),
            1
        );
    }

    #[test]
    fn shuffled_success_events_keep_unique_fingerprint() {
        let mut rng = 7u64;
        for _ in 0..32 {
            rng = rng.wrapping_mul(1664525).wrapping_add(1013904223);
            let mut events = vec![
                declare_prec("A", "B"),
                GraphLogEvent::AttemptCompleted {
                    node_id: "A".into(),
                    input_fingerprint: "root".into(),
                    ok: true,
                },
                GraphLogEvent::AttemptCompleted {
                    node_id: "A".into(),
                    input_fingerprint: "root".into(),
                    ok: true,
                },
            ];
            if rng % 2 == 0 {
                events.swap(1, 2);
            }
            let state = replay_graph(&events);
            assert!(
                state
                    .successes
                    .iter()
                    .filter(|(id, fp)| id == "A" && fp == "root")
                    .count()
                    <= 1
            );
        }
    }

    #[test]
    fn graph_engineering_skill_matches_schema_and_does_not_promise_dual_start() {
        assert!(GRAPH_ENGINEERING_SKILL.contains("source 是上游"));
        assert!(GRAPH_ENGINEERING_SKILL.contains("target 是下游"));
        assert!(GRAPH_ENGINEERING_SKILL.contains("expected_generation"));
        assert!(GRAPH_ENGINEERING_SKILL.contains("不会开工"));
        assert!(GRAPH_ENGINEERING_SKILL.contains("只启动上游 A"));
        assert!(!GRAPH_ENGINEERING_SKILL.contains("同时开工"));
        assert!(!GRAPH_ENGINEERING_SKILL.contains("两边指派就双开"));
    }
}
