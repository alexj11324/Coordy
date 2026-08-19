use coordy_advisor::DeterministicAdvisor;
use coordy_kernel::{
    parse_sync_projection, sync_batch, sync_omits_private_memory, Kernel, NoopPorts, RecordingPorts,
};
use coordy_protocol::{
    Actor, AuthenticatedCommand, AuthorizedQuery, Command, GithubPullRequestItem, GithubSync,
    GraphEdgeKind, GraphEdgeState, HarnessEvent, NodeKind, Query, RunRole, RunSource, View,
    STALE_DEPENDENCY_REASON,
};
use std::sync::Arc;

fn daemon() -> Actor {
    Actor::Daemon
}

fn cmd(actor: Actor, command: Command) -> AuthenticatedCommand {
    AuthenticatedCommand { actor, command }
}

fn q(actor: Actor, query: Query) -> AuthorizedQuery {
    AuthorizedQuery { actor, query }
}

struct Harness {
    kernel: Kernel,
    workspace_id: String,
    alice: String,
    bob: String,
    a1: String,
    a2: String,
}

fn setup() -> Harness {
    setup_kernel(Kernel::default_in_process())
}

fn setup_kernel(kernel: Kernel) -> Harness {
    let ws = kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreateWorkspace {
                name: "demo".into(),
            },
        ))
        .unwrap();
    let workspace_id = ws.ids["workspace_id"].as_str().unwrap().to_string();
    let alice = kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreatePrincipal {
                workspace_id: workspace_id.clone(),
                name: "Alice".into(),
            },
        ))
        .unwrap()
        .ids["principal_id"]
        .as_str()
        .unwrap()
        .to_string();
    let bob = kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreatePrincipal {
                workspace_id: workspace_id.clone(),
                name: "Bob".into(),
            },
        ))
        .unwrap()
        .ids["principal_id"]
        .as_str()
        .unwrap()
        .to_string();
    let a1 = kernel
        .submit_sync(cmd(
            Actor::Principal { id: alice.clone() },
            Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: alice.clone(),
                name: "A1".into(),
                harness: "jsonl".into(),
            },
        ))
        .unwrap()
        .ids["agent_id"]
        .as_str()
        .unwrap()
        .to_string();
    let a2 = kernel
        .submit_sync(cmd(
            Actor::Principal { id: alice.clone() },
            Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: alice.clone(),
                name: "A2".into(),
                harness: "jsonl".into(),
            },
        ))
        .unwrap()
        .ids["agent_id"]
        .as_str()
        .unwrap()
        .to_string();
    let _bob_agent = kernel
        .submit_sync(cmd(
            Actor::Principal { id: bob.clone() },
            Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: bob.clone(),
                name: "B1".into(),
                harness: "jsonl".into(),
            },
        ))
        .unwrap()
        .ids["agent_id"]
        .as_str()
        .unwrap()
        .to_string();
    Harness {
        kernel,
        workspace_id,
        alice,
        bob,
        a1,
        a2,
    }
}

#[test]
fn private_memory_isolated() {
    let h = setup();
    let mem = h
        .kernel
        .submit_sync(cmd(
            Actor::Agent {
                id: h.a1.clone(),
                principal_id: h.alice.clone(),
            },
            Command::AppendMemory {
                workspace_id: h.workspace_id.clone(),
                visibility: "agent_private".into(),
                body: "A1 secret".into(),
                owner_actor_id: Some(h.a1.clone()),
            },
        ))
        .unwrap();
    let mem_id = mem.ids["memory_id"].as_str().unwrap();
    let view = h
        .kernel
        .view_sync(q(
            Actor::Agent {
                id: h.a2.clone(),
                principal_id: h.alice.clone(),
            },
            Query::Memory {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    match view {
        View::Memory { items } => {
            assert!(!items
                .iter()
                .any(|m| m.id == mem_id || m.body.contains("A1 secret")));
        }
        _ => panic!("expected memory view"),
    }
}

#[test]
fn sibling_agent_cannot_read_private() {
    private_memory_isolated();
}

#[test]
fn unauthorized_memory_never_reaches_context() {
    let h = setup();
    h.kernel
        .submit_sync(cmd(
            Actor::Agent {
                id: h.a1.clone(),
                principal_id: h.alice.clone(),
            },
            Command::AppendMemory {
                workspace_id: h.workspace_id.clone(),
                visibility: "agent_private".into(),
                body: "classified".into(),
                owner_actor_id: Some(h.a1.clone()),
            },
        ))
        .unwrap();
    let ctx = h
        .kernel
        .view_sync(q(
            daemon(),
            Query::AgentContext {
                agent_id: h.a2.clone(),
            },
        ))
        .unwrap();
    match ctx {
        View::AgentContext { context } => {
            assert!(!context.memory.iter().any(|m| m.body.contains("classified")));
        }
        _ => panic!("expected context"),
    }
}

#[test]
fn sibling_cannot_materialize_other_agent_context() {
    let h = setup();
    h.kernel
        .submit_sync(cmd(
            Actor::Agent {
                id: h.a1.clone(),
                principal_id: h.alice.clone(),
            },
            Command::AppendMemory {
                workspace_id: h.workspace_id.clone(),
                visibility: "agent_private".into(),
                body: "classified".into(),
                owner_actor_id: Some(h.a1.clone()),
            },
        ))
        .unwrap();
    let err = h
        .kernel
        .view_sync(q(
            Actor::Agent {
                id: h.a2.clone(),
                principal_id: h.alice.clone(),
            },
            Query::AgentContext {
                agent_id: h.a1.clone(),
            },
        ))
        .unwrap_err();
    assert_eq!(err.code, "denied");
}

#[test]
fn foreign_principal_cannot_materialize_agent_context() {
    let h = setup();
    let err = h
        .kernel
        .view_sync(q(
            Actor::Principal { id: h.bob.clone() },
            Query::AgentContext {
                agent_id: h.a1.clone(),
            },
        ))
        .unwrap_err();
    assert_eq!(err.code, "denied");
}

#[test]
fn owner_can_materialize_owned_agent_context() {
    let h = setup();
    h.kernel
        .submit_sync(cmd(
            Actor::Agent {
                id: h.a1.clone(),
                principal_id: h.alice.clone(),
            },
            Command::AppendMemory {
                workspace_id: h.workspace_id.clone(),
                visibility: "agent_private".into(),
                body: "owned secret".into(),
                owner_actor_id: Some(h.a1.clone()),
            },
        ))
        .unwrap();
    let ctx = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::AgentContext {
                agent_id: h.a1.clone(),
            },
        ))
        .unwrap();
    match ctx {
        View::AgentContext { context } => {
            assert!(context
                .memory
                .iter()
                .any(|m| m.body.contains("owned secret")));
        }
        _ => panic!("expected context"),
    }
}

#[test]
fn publish_requires_authority() {
    let h = setup();
    let mem = h
        .kernel
        .submit_sync(cmd(
            Actor::Agent {
                id: h.a1.clone(),
                principal_id: h.alice.clone(),
            },
            Command::AppendMemory {
                workspace_id: h.workspace_id.clone(),
                visibility: "agent_private".into(),
                body: "alice private".into(),
                owner_actor_id: Some(h.a1.clone()),
            },
        ))
        .unwrap();
    let mem_id = mem.ids["memory_id"].as_str().unwrap().to_string();
    let err = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal { id: h.bob.clone() },
            Command::PublishMemory { memory_id: mem_id },
        ))
        .unwrap_err();
    assert_eq!(err.code, "denied");
}

#[test]
fn cross_principal_share_requires_acceptance() {
    let h = setup();
    let mem = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::AppendMemory {
                workspace_id: h.workspace_id.clone(),
                visibility: "principal".into(),
                body: "alice principal note".into(),
                owner_actor_id: Some(h.alice.clone()),
            },
        ))
        .unwrap();
    let mem_id = mem.ids["memory_id"].as_str().unwrap().to_string();
    let share = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::ShareMemory {
                memory_id: mem_id,
                to_principal_id: h.bob.clone(),
            },
        ))
        .unwrap();
    let share_id = share.ids["memory_id"].as_str().unwrap().to_string();
    let view = h
        .kernel
        .view_sync(q(
            Actor::Principal { id: h.bob.clone() },
            Query::Memory {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    match view {
        View::Memory { items } => {
            let item = items.iter().find(|m| m.id == share_id).unwrap();
            assert_eq!(item.status, "proposed_share");
        }
        _ => panic!("memory"),
    }
    h.kernel
        .submit_sync(cmd(
            Actor::Principal { id: h.bob.clone() },
            Command::AcceptShare {
                memory_id: share_id.clone(),
            },
        ))
        .unwrap();
}

#[test]
fn cross_principal_command_denied() {
    let h = setup();
    let task = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal { id: h.bob.clone() },
            Command::CreateTask {
                workspace_id: h.workspace_id.clone(),
                title: "bob work".into(),
                description: String::new(),
            },
        ))
        .unwrap();
    let task_id = task.ids["task_id"].as_str().unwrap().to_string();
    let bob_agents = match h
        .kernel
        .view_sync(q(
            Actor::Principal { id: h.bob.clone() },
            Query::Agents {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap()
    {
        View::Agents { items } => items,
        _ => panic!("agents"),
    };
    let bob_agent = bob_agents.iter().find(|a| a.principal_id == h.bob).unwrap();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal { id: h.bob.clone() },
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id: bob_agent.id.clone(),
            },
        ))
        .unwrap();
    let err = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::AssignTask {
                task_id,
                agent_id: bob_agent.id.clone(),
            },
        ))
        .unwrap_err();
    assert_eq!(err.code, "denied");
}

#[test]
fn delegation_cannot_escalate() {
    let h = setup();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::Grant {
                workspace_id: h.workspace_id.clone(),
                grantee_id: h.a1.clone(),
                resource: format!("agent:{}", h.a1),
                action: "read".into(),
            },
        ))
        .unwrap();
    let err = h
        .kernel
        .submit_sync(cmd(
            Actor::Agent {
                id: h.a1.clone(),
                principal_id: h.alice.clone(),
            },
            Command::Delegate {
                workspace_id: h.workspace_id.clone(),
                from_actor_id: h.a1.clone(),
                to_actor_id: h.a2.clone(),
                resource: format!("workspace:{}", h.workspace_id),
                action: "*".into(),
            },
        ))
        .unwrap_err();
    assert_eq!(err.code, "denied");
}

#[test]
fn revoked_grant_is_denied() {
    let h = setup();
    let grant = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::Grant {
                workspace_id: h.workspace_id.clone(),
                grantee_id: h.a1.clone(),
                resource: format!("agent:{}", h.a2),
                action: "command".into(),
            },
        ))
        .unwrap();
    let grant_id = grant.ids["grant_id"].as_str().unwrap().to_string();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::RevokeGrant { grant_id },
        ))
        .unwrap();
    let err = h.kernel.submit_sync(cmd(
        Actor::Agent {
            id: h.a1.clone(),
            principal_id: h.alice.clone(),
        },
        Command::AssignTask {
            task_id: "missing".into(),
            agent_id: h.a2.clone(),
        },
    ));
    assert!(err.is_err());
}

#[test]
fn cannot_grant_command_on_foreign_agent() {
    let h = setup();
    let bob_agent = h
        .kernel
        .export_world()
        .agents
        .iter()
        .find(|agent| agent.principal_id == h.bob)
        .expect("bob agent")
        .id
        .clone();
    let err = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::Grant {
                workspace_id: h.workspace_id.clone(),
                grantee_id: h.a1.clone(),
                resource: format!("agent:{bob_agent}"),
                action: "command".into(),
            },
        ))
        .unwrap_err();
    assert_eq!(err.code, "denied");
}

#[test]
fn cannot_grant_in_foreign_workspace() {
    let h = setup();
    let other = h
        .kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreateWorkspace {
                name: "other".into(),
            },
        ))
        .unwrap();
    let other_ws = other.ids["workspace_id"].as_str().unwrap().to_string();
    let err = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::Grant {
                workspace_id: other_ws.clone(),
                grantee_id: h.a1.clone(),
                resource: format!("workspace:{other_ws}"),
                action: "write".into(),
            },
        ))
        .unwrap_err();
    assert_eq!(err.code, "denied");
}

#[test]
fn shared_resource_needs_joint_approval() {
    let h = setup();
    let proposed = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::ProposeContract {
                workspace_id: h.workspace_id.clone(),
                title: "shared api".into(),
                body: "do not break the contract".into(),
                participant_ids: vec![h.alice.clone(), h.bob.clone()],
            },
        ))
        .unwrap();
    let contract_id = proposed.ids["contract_id"].as_str().unwrap().to_string();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::ApproveContract {
                contract_id: contract_id.clone(),
            },
        ))
        .unwrap();
    let view = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Contracts {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    match view {
        View::Contracts { items } => {
            assert_eq!(items[0].status, "proposed");
        }
        _ => panic!("contracts"),
    }
    h.kernel
        .submit_sync(cmd(
            Actor::Principal { id: h.bob.clone() },
            Command::ApproveContract { contract_id },
        ))
        .unwrap();
}

#[test]
fn compaction_drift_pauses_and_action_gate_blocks() {
    let h = setup();
    let task = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::CreateTask {
                workspace_id: h.workspace_id.clone(),
                title: "long run".into(),
                description: String::new(),
            },
        ))
        .unwrap();
    let task_id = task.ids["task_id"].as_str().unwrap().to_string();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id: h.a1.clone(),
            },
        ))
        .unwrap();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::UpsertCommitment {
                workspace_id: h.workspace_id.clone(),
                task_id: Some(task_id.clone()),
                commitment_type: "CONSTRAINT".into(),
                claim: "never-deploy-without-approval".into(),
                polarity: "MUST_NOT".into(),
                authority: "USER".into(),
                scope: task_id.clone(),
            },
        ))
        .unwrap();
    let outcome = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal { id: h.alice.clone() },
            Command::StartRun {
                task_id: task_id.clone(),
                source: RunSource::Fixture {
                    events: vec![
                        HarnessEvent::Message {
                            role: "user".into(),
                            content: "GOAL: preserve-release-gate\nCONSTRAINT: never-deploy-without-approval".into(),
                        },
                        HarnessEvent::Compaction {
                            summary: "working on stuff".into(),
                        },
                        HarnessEvent::Message {
                            role: "assistant".into(),
                            content: "PLAN: ship directly to production".into(),
                        },
                    ],
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap();
    let run_id = outcome.ids["run_id"].as_str().unwrap().to_string();
    let inbox = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Inbox {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    match inbox {
        View::Inbox { items } => {
            assert!(items
                .iter()
                .any(|i| i.kind == "pause" || i.kind == "replan"));
        }
        _ => panic!("inbox"),
    }
    let blocked = h
        .kernel
        .submit_sync(cmd(
            Actor::Agent {
                id: h.a1.clone(),
                principal_id: h.alice.clone(),
            },
            Command::ApplyPatch {
                task_id,
                patch: "never-deploy-without-approval leaked".into(),
            },
        ))
        .unwrap();
    assert!(blocked.blocked);
    let _ = run_id;
}

#[test]
fn private_memory_not_synced() {
    let h = setup();
    h.kernel
        .submit_sync(cmd(
            Actor::Agent {
                id: h.a1.clone(),
                principal_id: h.alice.clone(),
            },
            Command::AppendMemory {
                workspace_id: h.workspace_id.clone(),
                visibility: "agent_private".into(),
                body: "do-not-upload".into(),
                owner_actor_id: Some(h.a1.clone()),
            },
        ))
        .unwrap();
    let world = h.kernel.export_world();
    let batch = sync_batch(&world);
    let encoded = serde_json::to_string(&batch).unwrap();
    assert!(!encoded.contains("do-not-upload"));
    assert!(sync_omits_private_memory(&world));
}

#[test]
fn projection_rejects_principal_memory() {
    let err = parse_sync_projection(&serde_json::json!({
        "published_memory": [{
            "visibility": "principal",
            "status": "shared",
            "body": "secret"
        }]
    }))
    .unwrap_err();
    assert_eq!(err.code, "denied");
}

#[test]
fn projection_accepts_shared_memory() {
    let batch = parse_sync_projection(&serde_json::json!({
        "contracts": [],
        "published_memory": [{
            "visibility": "shared",
            "status": "shared",
            "body": "ok"
        }],
        "tasks": [],
        "conflicts": []
    }))
    .unwrap();
    assert_eq!(batch["published_memory"][0]["body"], "ok");
}

#[test]
fn jsonl_fixture_file_pauses_on_drift() {
    let h = setup();
    let task = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::CreateTask {
                workspace_id: h.workspace_id.clone(),
                title: "jsonl".into(),
                description: String::new(),
            },
        ))
        .unwrap();
    let task_id = task.ids["task_id"].as_str().unwrap().to_string();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id: h.a1.clone(),
            },
        ))
        .unwrap();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::UpsertCommitment {
                workspace_id: h.workspace_id.clone(),
                task_id: Some(task_id.clone()),
                commitment_type: "CONSTRAINT".into(),
                claim: "never-deploy-without-approval".into(),
                polarity: "MUST_NOT".into(),
                authority: "USER".into(),
                scope: task_id.clone(),
            },
        ))
        .unwrap();
    let path = format!(
        "{}/../../tests/fixtures/compaction-drift.jsonl",
        env!("CARGO_MANIFEST_DIR")
    );
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::StartRun {
                task_id,
                source: RunSource::Jsonl { path },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap();
    let inbox = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Inbox {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    match inbox {
        View::Inbox { items } => {
            assert!(items
                .iter()
                .any(|i| i.kind == "pause" || i.kind == "replan"));
        }
        _ => panic!("inbox"),
    }
}

#[test]
fn stale_reactivated_plan_pauses() {
    let h = setup();
    let task = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::CreateTask {
                workspace_id: h.workspace_id.clone(),
                title: "rejected-return".into(),
                description: String::new(),
            },
        ))
        .unwrap();
    let task_id = task.ids["task_id"].as_str().unwrap().to_string();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id: h.a1.clone(),
            },
        ))
        .unwrap();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::StartRun {
                task_id,
                source: RunSource::Fixture {
                    events: vec![
                        HarnessEvent::Message {
                            role: "user".into(),
                            content: "GOAL: keep-local\nREJECTED: ship-to-prod".into(),
                        },
                        HarnessEvent::Compaction {
                            summary: "compact".into(),
                        },
                        HarnessEvent::Message {
                            role: "assistant".into(),
                            content: "PLAN: ship-to-prod".into(),
                        },
                    ],
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap();
    let inbox = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Inbox {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    match inbox {
        View::Inbox { items } => {
            assert!(items.iter().any(|i| i.kind == "pause"));
        }
        _ => panic!("inbox"),
    }
}

#[test]
fn declare_dependency_invalidated_on_apply() {
    let h = setup();
    let task = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::CreateTask {
                workspace_id: h.workspace_id.clone(),
                title: "dep-src".into(),
                description: String::new(),
            },
        ))
        .unwrap();
    let task_id = task.ids["task_id"].as_str().unwrap().to_string();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id: h.a1.clone(),
            },
        ))
        .unwrap();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::BindRepository {
                workspace_id: h.workspace_id.clone(),
                path: "/tmp/coordy-demo-repo".into(),
            },
        ))
        .unwrap();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::CreateWorktree {
                task_id: task_id.clone(),
            },
        ))
        .unwrap();
    let consumer = issue_title(&h, "dep-consumer");
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            declare_cmd(&h.workspace_id, &consumer, &task_id, "repo"),
        ))
        .unwrap();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::ApplyPatch {
                task_id,
                patch: "safe change".into(),
            },
        ))
        .unwrap();
    let deps = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Dependencies {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    match deps {
        View::Dependencies { items } => {
            assert!(items.iter().any(|d| !d.valid));
        }
        _ => panic!("deps"),
    }
}

fn alice_actor(h: &Harness) -> Actor {
    Actor::Principal {
        id: h.alice.clone(),
    }
}

fn assign_a1(h: &Harness, task_id: &str) {
    h.kernel
        .submit_sync(cmd(
            alice_actor(h),
            Command::AssignTask {
                task_id: task_id.into(),
                agent_id: h.a1.clone(),
            },
        ))
        .unwrap();
}

fn bind_demo_repo(h: &Harness) {
    h.kernel
        .submit_sync(cmd(
            alice_actor(h),
            Command::BindRepository {
                workspace_id: h.workspace_id.clone(),
                path: "/tmp/coordy-demo-repo".into(),
            },
        ))
        .unwrap();
}

fn create_worktree(h: &Harness, task_id: &str) {
    h.kernel
        .submit_sync(cmd(
            alice_actor(h),
            Command::CreateWorktree {
                task_id: task_id.into(),
            },
        ))
        .unwrap();
}

fn declare_cmd(workspace_id: &str, from_id: &str, to_id: &str, entity: &str) -> Command {
    Command::DeclareDependency {
        workspace_id: workspace_id.into(),
        source: None,
        target: None,
        from_id: from_id.into(),
        to_id: to_id.into(),
        kind: GraphEdgeKind::Consumes,
        entity: entity.into(),
        reason: None,
        origin_run_id: None,
        selector_path: None,
    }
}

fn declare_dep(h: &Harness, from_id: &str, to_id: &str, entity: &str) -> String {
    h.kernel
        .submit_sync(cmd(
            alice_actor(h),
            declare_cmd(&h.workspace_id, from_id, to_id, entity),
        ))
        .unwrap()
        .ids["dependency_id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn set_conductor(h: &Harness, agent_id: &str) {
    h.kernel
        .submit_sync(cmd(
            alice_actor(h),
            Command::UpdateWorkspace {
                workspace_id: h.workspace_id.clone(),
                name: None,
                icon: None,
                description: None,
                context: None,
                slug: None,
                issue_prefix: None,
                conductor_agent_id: Some(agent_id.into()),
            },
        ))
        .unwrap();
}

fn ingest_assistant(h: &Harness, run_id: &str, content: &str) {
    h.kernel
        .submit_sync(cmd(
            daemon(),
            Command::IngestHarnessEvent {
                run_id: run_id.into(),
                event: HarnessEvent::Message {
                    role: "assistant".into(),
                    content: content.into(),
                },
            },
        ))
        .unwrap();
}

fn ingest_session_ok(h: &Harness, run_id: &str) {
    h.kernel
        .submit_sync(cmd(
            daemon(),
            Command::IngestHarnessEvent {
                run_id: run_id.into(),
                event: HarnessEvent::Tool {
                    name: coordy_protocol::HARNESS_SESSION_TOOL.into(),
                    input: String::new(),
                    output: "ok".into(),
                    exit_code: Some(0),
                },
            },
        ))
        .unwrap();
}

fn reaffirm_dep(h: &Harness, dependency_id: &str) {
    let generation = alice_deps(h)
        .into_iter()
        .find(|dep| dep.id == dependency_id)
        .expect("dependency")
        .generation;
    h.kernel
        .submit_sync(cmd(
            alice_actor(h),
            Command::ReaffirmDependency {
                dependency_id: dependency_id.into(),
                expected_generation: generation,
            },
        ))
        .unwrap();
}

fn start_fixture(h: &Harness, task_id: &str, events: Vec<HarnessEvent>) -> String {
    h.kernel
        .submit_sync(cmd(
            alice_actor(h),
            Command::StartRun {
                task_id: task_id.into(),
                source: RunSource::Fixture { events },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap()
        .ids["run_id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn alice_deps(h: &Harness) -> Vec<coordy_protocol::DependencyView> {
    match h
        .kernel
        .view_sync(q(
            alice_actor(h),
            Query::Dependencies {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap()
    {
        View::Dependencies { items } => items,
        other => panic!("expected dependencies, got {other:?}"),
    }
}

fn alice_runs(h: &Harness) -> Vec<coordy_protocol::RunView> {
    match h
        .kernel
        .view_sync(q(
            alice_actor(h),
            Query::Runs {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap()
    {
        View::Runs { items } => items,
        other => panic!("expected runs, got {other:?}"),
    }
}

fn alice_inbox(h: &Harness) -> Vec<coordy_protocol::InboxView> {
    match h
        .kernel
        .view_sync(q(
            alice_actor(h),
            Query::Inbox {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap()
    {
        View::Inbox { items } => items,
        other => panic!("expected inbox, got {other:?}"),
    }
}

fn alice_commitments(h: &Harness) -> Vec<coordy_protocol::CommitmentView> {
    match h
        .kernel
        .view_sync(q(
            alice_actor(h),
            Query::Commitments {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap()
    {
        View::Commitments { items } => items,
        other => panic!("expected commitments, got {other:?}"),
    }
}

#[test]
fn stale_dependency_gates_start_and_retry_until_reaffirm() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    assign_a1(&h, &consumer);
    bind_demo_repo(&h);
    create_worktree(&h, &producer);
    let dep_id = declare_dep(&h, &consumer, &producer, "repo");
    let first_run = start_fixture(&h, &consumer, vec![]);
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer,
                patch: "safe change".into(),
            },
        ))
        .unwrap();
    let waiting = board_task(&alice_board(&h), &consumer);
    assert_eq!(
        waiting.blocked_reason.as_deref(),
        Some(STALE_DEPENDENCY_REASON)
    );
    assert!(alice_deps(&h)
        .iter()
        .any(|dep| dep.id == dep_id && !dep.valid));

    let start_err = h
        .kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::StartRun {
                task_id: consumer.clone(),
                source: RunSource::Fixture { events: vec![] },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap_err();
    assert_eq!(start_err.code, "invalid");
    assert!(start_err.message.contains(STALE_DEPENDENCY_REASON));

    let retry_err = h
        .kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::RetryRun {
                run_id: first_run.clone(),
            },
        ))
        .unwrap_err();
    assert_eq!(retry_err.code, "invalid");
    assert!(retry_err.message.contains(STALE_DEPENDENCY_REASON));

    reaffirm_dep(&h, &dep_id);
    let after = board_task(&alice_board(&h), &consumer);
    assert!(after.blocked_reason.is_none());
    assert_eq!(
        alice_runs(&h)
            .iter()
            .filter(|run| run.task_id == consumer)
            .count(),
        1,
        "reaffirm must not auto-start a run"
    );
    start_fixture(&h, &consumer, vec![]);
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::RetryRun { run_id: first_run },
        ))
        .unwrap();
}

#[test]
fn apply_patch_pauses_downstream_running_run_and_posts_replan() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    assign_a1(&h, &consumer);
    bind_demo_repo(&h);
    create_worktree(&h, &producer);
    declare_dep(&h, &consumer, &producer, "repo");
    let run_id = h
        .kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::StartRun {
                task_id: consumer.clone(),
                source: RunSource::Acp {
                    prompt: "implement ui".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap()
        .ids["run_id"]
        .as_str()
        .unwrap()
        .to_string();
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer,
                patch: "safe change".into(),
            },
        ))
        .unwrap();
    let run = alice_runs(&h)
        .into_iter()
        .find(|item| item.id == run_id)
        .expect("downstream run");
    assert_eq!(run.status, "paused");
    assert!(alice_inbox(&h).iter().any(|item| item.kind == "replan"));
}

#[test]
fn depends_prefix_records_edge_only_when_id_resolves() {
    let h = setup();
    let upstream = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    assign_a1(&h, &consumer);
    start_fixture(
        &h,
        &consumer,
        vec![
            HarnessEvent::Message {
                role: "assistant".into(),
                content: "DEPENDS: 那个登录 API".into(),
            },
            HarnessEvent::Message {
                role: "assistant".into(),
                content: format!("DEPENDS: {upstream}"),
            },
        ],
    );
    let deps = alice_deps(&h);
    assert_eq!(deps.len(), 1);
    assert_eq!(deps[0].from_id, consumer);
    assert_eq!(deps[0].to_id, upstream);
    assert_eq!(deps[0].source.id, upstream);
    assert_eq!(deps[0].target.id, consumer);
    assert_eq!(deps[0].kind, GraphEdgeKind::Consumes);
    assert!(deps[0].origin_run_id.is_some());
    assert_eq!(deps[0].entity, "repo");
    assert!(deps[0].valid);
    let claims: Vec<_> = alice_commitments(&h)
        .into_iter()
        .filter(|c| c.commitment_type == "PLAN_DEPENDENCY")
        .map(|c| c.claim)
        .collect();
    assert!(claims.iter().any(|claim| claim.contains("那个登录")));
    assert!(claims.iter().any(|claim| claim.contains(&upstream)));
}

#[test]
fn declare_dependency_rejects_task_cycles() {
    let h = setup();
    let first = issue_title(&h, "a");
    let second = issue_title(&h, "b");
    declare_dep(&h, &second, &first, "repo");
    let err = h
        .kernel
        .submit_sync(cmd(
            alice_actor(&h),
            declare_cmd(&h.workspace_id, &first, &second, "repo"),
        ))
        .unwrap_err();
    assert_eq!(err.code, "invalid");
    assert!(err.message.contains("循环"));
}

#[test]
fn declare_dependency_rejects_dangling_and_cross_workspace() {
    let h = setup();
    let local = issue_title(&h, "local");
    let dangling = h
        .kernel
        .submit_sync(cmd(
            alice_actor(&h),
            declare_cmd(&h.workspace_id, "missing-task", &local, "repo"),
        ))
        .unwrap_err();
    assert_eq!(dangling.code, "invalid");
    assert!(dangling.message.contains("不存在"));

    let other_ws = h
        .kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreateWorkspace {
                name: "other".into(),
            },
        ))
        .unwrap()
        .ids["workspace_id"]
        .as_str()
        .unwrap()
        .to_string();
    let other_principal = h
        .kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreatePrincipal {
                workspace_id: other_ws.clone(),
                name: "Other".into(),
            },
        ))
        .unwrap()
        .ids["principal_id"]
        .as_str()
        .unwrap()
        .to_string();
    let foreign = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: other_principal,
            },
            Command::CreateTask {
                workspace_id: other_ws,
                title: "foreign".into(),
                description: String::new(),
            },
        ))
        .unwrap()
        .ids["task_id"]
        .as_str()
        .unwrap()
        .to_string();
    let cross = h
        .kernel
        .submit_sync(cmd(
            alice_actor(&h),
            declare_cmd(&h.workspace_id, &foreign, &local, "repo"),
        ))
        .unwrap_err();
    assert_eq!(cross.code, "invalid");
    assert!(cross.message.contains("跨工作区"));
}

#[test]
fn declare_dependency_rejects_mixed_precedence_consumes_cycle() {
    let h = setup();
    let first = issue_title(&h, "a");
    let second = issue_title(&h, "b");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::AddIssueBlocker {
                task_id: second.clone(),
                blocker_id: first.clone(),
            },
        ))
        .unwrap();
    let err = h
        .kernel
        .submit_sync(cmd(
            alice_actor(&h),
            declare_cmd(&h.workspace_id, &first, &second, "repo"),
        ))
        .unwrap_err();
    assert_eq!(err.code, "invalid");
    assert!(err.message.contains("循环"));
}

#[test]
fn invalidate_only_consumes_from_changed_source() {
    let h = setup();
    let producer_a = issue_title(&h, "api-a");
    let consumer_b = issue_title(&h, "ui-b");
    let producer_c = issue_title(&h, "api-c");
    let consumer_d = issue_title(&h, "ui-d");
    let hit = declare_dep(&h, &consumer_b, &producer_a, "repo");
    let other = declare_dep(&h, &consumer_d, &producer_c, "repo");
    bind_demo_repo(&h);
    create_worktree(&h, &producer_a);
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer_a,
                patch: "safe change".into(),
            },
        ))
        .unwrap();
    let deps = alice_deps(&h);
    let hit_edge = deps.iter().find(|dep| dep.id == hit).expect("hit");
    let other_edge = deps.iter().find(|dep| dep.id == other).expect("other");
    assert!(!hit_edge.valid);
    assert_eq!(hit_edge.state, GraphEdgeState::Stale);
    assert!(other_edge.valid);
    assert_eq!(other_edge.state, GraphEdgeState::Active);
}

#[test]
fn every_source_change_advances_a_stale_dependency_generation() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    let dep_id = declare_dep(&h, &consumer, &producer, "api");
    bind_demo_repo(&h);
    create_worktree(&h, &producer);

    for patch in ["first change", "second change"] {
        h.kernel
            .submit_sync(cmd(
                alice_actor(&h),
                Command::ApplyPatch {
                    task_id: producer.clone(),
                    patch: patch.into(),
                },
            ))
            .unwrap();
    }

    let dep = alice_deps(&h)
        .into_iter()
        .find(|dep| dep.id == dep_id)
        .expect("dependency");
    assert_eq!(dep.state, GraphEdgeState::Stale);
    assert_eq!(dep.generation, 3);
    assert_eq!(dep.current_version, Some(2));
}

#[test]
fn legacy_dependency_endpoint_rejects_archived_agent() {
    let h = setup();
    let consumer = issue_title(&h, "ui");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ArchiveAgent {
                agent_id: h.a1.clone(),
            },
        ))
        .unwrap();

    let err = h
        .kernel
        .submit_sync(cmd(
            alice_actor(&h),
            declare_cmd(&h.workspace_id, &consumer, &h.a1, "repo"),
        ))
        .unwrap_err();
    assert_eq!(err.code, "invalid");
    assert!(err.message.contains("不存在"));
}

#[test]
fn public_dependency_cannot_claim_an_unrelated_same_workspace_run() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    let unrelated = issue_title(&h, "unrelated");
    assign_a1(&h, &unrelated);
    let unrelated_run = start_fixture(&h, &unrelated, vec![]);
    let mut command = declare_cmd(&h.workspace_id, &consumer, &producer, "repo");
    let Command::DeclareDependency { origin_run_id, .. } = &mut command else {
        unreachable!();
    };
    *origin_run_id = Some(unrelated_run);

    let err = h
        .kernel
        .submit_sync(cmd(alice_actor(&h), command))
        .unwrap_err();
    assert_eq!(err.code, "invalid");
    assert!(err.message.contains("origin run"));
    assert!(alice_deps(&h).is_empty());
}

#[test]
fn done_consumer_stays_done_when_materialization_goes_stale() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    declare_dep(&h, &consumer, &producer, "repo");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::SetTaskStatus {
                task_id: consumer.clone(),
                status: "done".into(),
            },
        ))
        .unwrap();
    bind_demo_repo(&h);
    create_worktree(&h, &producer);
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer,
                patch: "safe change".into(),
            },
        ))
        .unwrap();
    let task = board_task(&alice_board(&h), &consumer);
    assert_eq!(task.status, "done");
    assert!(task.blocked_reason.is_none());
    match h
        .kernel
        .view_sync(q(
            alice_actor(&h),
            Query::GraphSnapshot {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap()
    {
        View::GraphSnapshot {
            materializations,
            edges,
            health,
            ..
        } => {
            assert!(health.consistent);
            assert_eq!(health.lag, 0);
            assert!(materializations
                .iter()
                .any(|row| { row.node.id == consumer && row.state == GraphEdgeState::Stale }));
            assert!(edges.iter().any(|edge| {
                edge.target.id == consumer
                    && edge.kind == GraphEdgeKind::Consumes
                    && edge.state == GraphEdgeState::Stale
            }));
        }
        other => panic!("expected graph snapshot, got {other:?}"),
    }
}

#[test]
fn reaffirm_rejects_stale_generation_and_does_not_start_run() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    assign_a1(&h, &consumer);
    let dep_id = declare_dep(&h, &consumer, &producer, "repo");
    let original = alice_deps(&h)
        .into_iter()
        .find(|dep| dep.id == dep_id)
        .expect("dep")
        .generation;
    bind_demo_repo(&h);
    create_worktree(&h, &producer);
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer,
                patch: "safe change".into(),
            },
        ))
        .unwrap();
    let err = h
        .kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ReaffirmDependency {
                dependency_id: dep_id.clone(),
                expected_generation: original,
            },
        ))
        .unwrap_err();
    assert_eq!(err.code, "invalid");
    assert!(err.message.contains("generation"));
    reaffirm_dep(&h, &dep_id);
    assert_eq!(
        alice_runs(&h)
            .iter()
            .filter(|run| run.task_id == consumer)
            .count(),
        0,
        "reaffirm must not auto-start a run"
    );
}

#[test]
fn graph_snapshot_unifies_source_to_target_arrows() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    assign_a1(&h, &consumer);
    declare_dep(&h, &consumer, &producer, "repo");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::AddIssueBlocker {
                task_id: consumer.clone(),
                blocker_id: producer.clone(),
            },
        ))
        .unwrap();
    match h
        .kernel
        .view_sync(q(
            alice_actor(&h),
            Query::GraphSnapshot {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap()
    {
        View::GraphSnapshot { nodes, edges, .. } => {
            assert!(nodes
                .iter()
                .any(|node| node.id == producer && node.kind == NodeKind::Task));
            assert!(edges.iter().any(|edge| {
                edge.kind == GraphEdgeKind::Consumes
                    && edge.source.id == producer
                    && edge.target.id == consumer
            }));
            assert!(edges.iter().any(|edge| {
                edge.kind == GraphEdgeKind::Precedence
                    && edge.source.id == producer
                    && edge.target.id == consumer
            }));
            assert!(edges.iter().any(|edge| {
                edge.kind == GraphEdgeKind::AssignedTo && edge.target.id == consumer
            }));
        }
        other => panic!("expected graph snapshot, got {other:?}"),
    }
}

#[test]
fn graph_evaluation_ready_set_only_includes_upstream() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    declare_dep(&h, &consumer, &producer, "repo");
    match h
        .kernel
        .view_sync(q(
            alice_actor(&h),
            Query::GraphEvaluation {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap()
    {
        View::GraphEvaluation(eval) => {
            assert!(eval.ready_nodes.contains(&producer));
            assert!(!eval.ready_nodes.contains(&consumer));
            assert!(eval.blocked_nodes.iter().any(|row| row.node_id == consumer));
        }
        other => panic!("expected graph evaluation, got {other:?}"),
    }
}

fn complete_session(h: &Harness, run_id: &str) {
    h.kernel
        .submit_sync(cmd(
            Actor::Daemon,
            Command::IngestHarnessEvent {
                run_id: run_id.into(),
                event: HarnessEvent::Tool {
                    name: coordy_protocol::HARNESS_SESSION_TOOL.into(),
                    input: "acp".into(),
                    output: "end_turn".into(),
                    exit_code: Some(0),
                },
            },
        ))
        .unwrap();
}

fn graph_execute_runs(h: &Harness) -> Vec<coordy_protocol::RunView> {
    alice_runs(h)
        .into_iter()
        .filter(|run| run.trigger == "graph_execute")
        .collect()
}

#[test]
fn graph_scheduler_starts_only_ready_upstream_when_both_assigned() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    declare_dep(&h, &consumer, &producer, "repo");
    assign_a1(&h, &producer);
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::AssignTask {
                task_id: consumer.clone(),
                agent_id: h.a2.clone(),
            },
        ))
        .unwrap();
    let started = graph_execute_runs(&h);
    assert_eq!(started.len(), 1);
    assert_eq!(started[0].task_id, producer);
    assert_eq!(started[0].role, RunRole::Executor);
    assert!(!started.iter().any(|run| run.task_id == consumer));
    let world = h.kernel.export_world();
    assert_eq!(
        world
            .node_attempts
            .iter()
            .filter(|attempt| attempt.node_id == producer)
            .count(),
        1
    );
    assert!(!world
        .node_attempts
        .iter()
        .any(|attempt| attempt.node_id == consumer));
}

#[test]
fn graph_scheduler_opens_downstream_once_after_upstream_session() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    declare_dep(&h, &consumer, &producer, "repo");
    assign_a1(&h, &producer);
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::AssignTask {
                task_id: consumer.clone(),
                agent_id: h.a2.clone(),
            },
        ))
        .unwrap();
    let producer_run = graph_execute_runs(&h)
        .into_iter()
        .find(|run| run.task_id == producer)
        .expect("producer run");
    complete_session(&h, &producer_run.id);
    let consumer_runs: Vec<_> = graph_execute_runs(&h)
        .into_iter()
        .filter(|run| run.task_id == consumer)
        .collect();
    assert_eq!(consumer_runs.len(), 1);
    assert_eq!(consumer_runs[0].role, RunRole::Executor);
    let world = h.kernel.export_world();
    assert_eq!(
        world
            .node_attempts
            .iter()
            .filter(|attempt| attempt.node_id == consumer)
            .count(),
        1
    );
}

#[test]
fn graph_scheduler_does_not_leave_running_run_after_spawn_failure() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    declare_dep(&h, &consumer, &producer, "repo");
    let failing = Harness {
        kernel: Kernel::with_world(
            h.kernel.export_world(),
            Arc::new(NoopPorts),
            Arc::new(DeterministicAdvisor),
        ),
        workspace_id: h.workspace_id.clone(),
        alice: h.alice.clone(),
        bob: h.bob.clone(),
        a1: h.a1.clone(),
        a2: h.a2.clone(),
    };

    assign_a1(&failing, &producer);
    let first = graph_execute_runs(&failing);
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].status, "failed");
    assert!(failing
        .kernel
        .export_world()
        .node_attempts
        .iter()
        .any(|attempt| {
            attempt.run_id.as_deref() == Some(first[0].id.as_str())
                && attempt.lease_status == "failed"
        }));

    failing
        .kernel
        .submit_sync(cmd(
            alice_actor(&failing),
            Command::RetryRun {
                run_id: first[0].id.clone(),
            },
        ))
        .unwrap_err();
    let second = graph_execute_runs(&failing);
    let all_runs: Vec<_> = alice_runs(&failing)
        .into_iter()
        .filter(|run| run.task_id == producer)
        .collect();
    assert_eq!(second.len(), 1, "retry uses the explicit retry trigger");
    assert_eq!(all_runs.len(), 2, "a failed spawn must remain retryable");
    assert!(second.iter().all(|run| run.status == "failed"));
    assert!(all_runs.iter().all(|run| run.status == "failed"));
    let retry_run = all_runs
        .iter()
        .find(|run| run.trigger == "retry")
        .expect("failed retry run remains auditable");
    assert!(failing
        .kernel
        .export_world()
        .node_attempts
        .iter()
        .any(|attempt| {
            attempt.run_id.as_deref() == Some(retry_run.id.as_str())
                && attempt.lease_status == "failed"
        }));
    let duplicate = failing.kernel.submit_sync(cmd(
        alice_actor(&failing),
        Command::RetryRun {
            run_id: first[0].id.clone(),
        },
    ));
    assert_eq!(duplicate.unwrap_err().code, "invalid");
    assert_eq!(
        alice_runs(&failing)
            .iter()
            .filter(|run| run.task_id == producer)
            .count(),
        2,
        "retrying an older attempt must fail before spawning"
    );
}

#[test]
fn graph_scheduler_skips_ready_node_without_executor() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    declare_dep(&h, &consumer, &producer, "repo");
    assign_a1(&h, &producer);
    let producer_run = graph_execute_runs(&h)
        .into_iter()
        .find(|run| run.task_id == producer)
        .expect("producer run");
    complete_session(&h, &producer_run.id);
    assert!(!graph_execute_runs(&h)
        .iter()
        .any(|run| run.task_id == consumer));
    assert!(!h
        .kernel
        .export_world()
        .node_attempts
        .iter()
        .any(|attempt| attempt.node_id == consumer));
}

#[test]
fn graph_scheduler_replay_from_world_does_not_add_attempts() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    declare_dep(&h, &consumer, &producer, "repo");
    assign_a1(&h, &producer);
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::AssignTask {
                task_id: consumer.clone(),
                agent_id: h.a2.clone(),
            },
        ))
        .unwrap();
    let before = h.kernel.export_world();
    let attempt_count = before.node_attempts.len();
    h.kernel.replace_world(before.clone());
    assign_a1(&h, &producer);
    let after = h.kernel.export_world();
    assert_eq!(after.node_attempts.len(), attempt_count);
    assert_eq!(
        after
            .runs
            .iter()
            .filter(|run| run.trigger == "graph_execute")
            .count(),
        before
            .runs
            .iter()
            .filter(|run| run.trigger == "graph_execute")
            .count()
    );
}

#[test]
fn graph_scheduler_writes_executor_role_even_when_agent_is_named_conductor() {
    let h = setup();
    let conductor_id = h
        .kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::CreateAgent {
                workspace_id: h.workspace_id.clone(),
                principal_id: h.alice.clone(),
                name: "conductor".into(),
                harness: "jsonl".into(),
            },
        ))
        .unwrap()
        .ids["agent_id"]
        .as_str()
        .unwrap()
        .to_string();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    declare_dep(&h, &consumer, &producer, "repo");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::AssignTask {
                task_id: producer.clone(),
                agent_id: conductor_id.clone(),
            },
        ))
        .unwrap();
    let world = h.kernel.export_world();
    let attempt = world
        .node_attempts
        .iter()
        .find(|attempt| attempt.node_id == producer)
        .expect("attempt");
    assert_eq!(attempt.role, RunRole::Executor);
    let run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == producer)
        .expect("run");
    assert_eq!(run.role, RunRole::Executor);
    assert_eq!(run.trigger, "graph_execute");
    assert_eq!(run.agent_id, conductor_id);
}

#[test]
fn conductor_scheduler_waits_for_upstream_and_records_node_attempts() {
    let h = setup();
    set_conductor(&h, &h.a2);
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    declare_dep(&h, &consumer, &producer, "repo");
    assign_a1(&h, &producer);
    assign_a1(&h, &consumer);

    let runs = alice_runs(&h);
    let producer_run = runs
        .iter()
        .find(|run| run.task_id == producer && run.status == "running")
        .expect("producer run");
    assert_eq!(producer_run.trigger, "graph");
    assert!(!runs
        .iter()
        .any(|run| run.task_id == consumer && run.status == "running"));
    let world = h.kernel.export_world();
    assert_eq!(
        world
            .node_attempts
            .iter()
            .filter(|attempt| attempt.node_id == producer)
            .count(),
        1
    );
    assert!(!world
        .node_attempts
        .iter()
        .any(|attempt| attempt.node_id == consumer));

    ingest_session_ok(&h, &producer_run.id);
    let world = h.kernel.export_world();
    assert!(alice_runs(&h)
        .iter()
        .any(|run| run.task_id == consumer && run.status == "running"));
    assert_eq!(
        world
            .node_attempts
            .iter()
            .filter(|attempt| attempt.node_id == consumer)
            .count(),
        1
    );
}

#[test]
fn public_start_run_spawn_failure_releases_agent_capacity() {
    let h = setup();
    let task_id = issue_title(&h, "manual run");
    assign_a1(&h, &task_id);
    let failing = Harness {
        kernel: Kernel::with_world(
            h.kernel.export_world(),
            Arc::new(NoopPorts),
            Arc::new(DeterministicAdvisor),
        ),
        workspace_id: h.workspace_id.clone(),
        alice: h.alice.clone(),
        bob: h.bob.clone(),
        a1: h.a1.clone(),
        a2: h.a2.clone(),
    };

    let start = || {
        failing.kernel.submit_sync(cmd(
            alice_actor(&failing),
            Command::StartRun {
                task_id: task_id.clone(),
                source: RunSource::Acp {
                    prompt: "run".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: "issue".into(),
            },
        ))
    };
    assert!(start().is_err());
    let first = alice_runs(&failing)
        .into_iter()
        .find(|run| run.task_id == task_id)
        .expect("failed run is retained for audit");
    assert_eq!(first.status, "failed");
    assert_eq!(first.queue_status, "failed");

    assert!(start().is_err());
    let runs: Vec<_> = alice_runs(&failing)
        .into_iter()
        .filter(|run| run.task_id == task_id)
        .collect();
    assert_eq!(runs.len(), 2, "a failed spawn must not consume capacity");
    assert!(runs.iter().all(|run| run.status == "failed"));
}

#[test]
fn failed_graph_attempt_waits_for_explicit_retry_and_binds_the_retry() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    declare_dep(&h, &consumer, &producer, "repo");
    assign_a1(&h, &producer);
    assign_a1(&h, &consumer);
    let producer_run = graph_execute_runs(&h)
        .into_iter()
        .find(|run| run.task_id == producer)
        .expect("producer run");

    h.kernel
        .submit_sync(cmd(
            daemon(),
            Command::IngestHarnessEvent {
                run_id: producer_run.id.clone(),
                event: HarnessEvent::Tool {
                    name: coordy_protocol::HARNESS_SESSION_TOOL.into(),
                    input: "acp".into(),
                    output: "failed".into(),
                    exit_code: Some(1),
                },
            },
        ))
        .unwrap();
    let after_failure = alice_runs(&h);
    assert_eq!(
        after_failure
            .iter()
            .filter(|run| run.task_id == producer)
            .count(),
        1,
        "a failed fingerprint must not restart automatically"
    );
    assert!(!after_failure
        .iter()
        .any(|run| run.task_id == consumer && run.status == "running"));
    let world = h.kernel.export_world();
    let failed_attempt = world
        .node_attempts
        .iter()
        .find(|attempt| attempt.run_id.as_deref() == Some(producer_run.id.as_str()))
        .expect("failed attempt remains auditable");
    assert_eq!(failed_attempt.lease_status, "failed");

    let retry = h
        .kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::RetryRun {
                run_id: producer_run.id.clone(),
            },
        ))
        .unwrap();
    let retry_id = retry.ids["run_id"].as_str().unwrap().to_string();
    let world = h.kernel.export_world();
    let retry_attempt = world
        .node_attempts
        .iter()
        .find(|attempt| attempt.run_id.as_deref() == Some(retry_id.as_str()))
        .expect("retry attempt is bound");
    assert_eq!(retry_attempt.lease_status, "running");
    for duplicate_id in [&producer_run.id, &retry_id] {
        let duplicate = h.kernel.submit_sync(cmd(
            alice_actor(&h),
            Command::RetryRun {
                run_id: duplicate_id.clone(),
            },
        ));
        assert_eq!(duplicate.unwrap_err().code, "invalid");
    }
    assert_eq!(
        alice_runs(&h)
            .iter()
            .filter(|run| run.task_id == producer)
            .count(),
        2,
        "double retry must fail before spawning another run"
    );

    ingest_session_ok(&h, &retry_id);
    let runs = alice_runs(&h);
    assert_eq!(
        runs.iter()
            .filter(|run| run.task_id == producer && run.trigger == "graph_execute")
            .count(),
        1,
        "retry success must not launch a duplicate graph execution"
    );
    assert!(runs
        .iter()
        .any(|run| run.task_id == consumer && run.status == "running"));
    let world = h.kernel.export_world();
    assert!(world.node_attempts.iter().any(|attempt| {
        attempt.run_id.as_deref() == Some(retry_id.as_str()) && attempt.lease_status == "succeeded"
    }));
}

#[test]
fn running_graph_attempt_cannot_be_retried() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    declare_dep(&h, &consumer, &producer, "repo");
    assign_a1(&h, &producer);
    let run = graph_execute_runs(&h)
        .into_iter()
        .find(|run| run.task_id == producer)
        .expect("running graph run");

    let retry = h.kernel.submit_sync(cmd(
        alice_actor(&h),
        Command::RetryRun {
            run_id: run.id.clone(),
        },
    ));
    assert_eq!(retry.unwrap_err().code, "invalid");
    assert_eq!(
        alice_runs(&h)
            .iter()
            .filter(|candidate| candidate.task_id == producer)
            .count(),
        1
    );
    assert_eq!(
        h.kernel
            .export_world()
            .node_attempts
            .iter()
            .filter(|attempt| attempt.node_id == producer)
            .count(),
        1
    );
}

#[test]
fn cancelled_graph_attempt_waits_for_explicit_retry() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    declare_dep(&h, &consumer, &producer, "repo");
    assign_a1(&h, &producer);
    assign_a1(&h, &consumer);
    let producer_run = graph_execute_runs(&h)
        .into_iter()
        .find(|run| run.task_id == producer)
        .expect("producer run");

    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::CancelRun {
                run_id: producer_run.id.clone(),
            },
        ))
        .unwrap();
    let world = h.kernel.export_world();
    assert!(world.node_attempts.iter().any(|attempt| {
        attempt.run_id.as_deref() == Some(producer_run.id.as_str())
            && attempt.lease_status == "cancelled"
    }));
    assert_eq!(
        alice_runs(&h)
            .iter()
            .filter(|run| run.task_id == producer)
            .count(),
        1
    );
    assert!(!alice_runs(&h)
        .iter()
        .any(|run| run.task_id == consumer && run.status == "running"));

    let retry = h
        .kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::RetryRun {
                run_id: producer_run.id,
            },
        ))
        .unwrap();
    let retry_id = retry.ids["run_id"].as_str().unwrap();
    assert!(h.kernel.export_world().node_attempts.iter().any(|attempt| {
        attempt.run_id.as_deref() == Some(retry_id) && attempt.lease_status == "running"
    }));
}

#[test]
fn start_run_automation_and_squad_still_run_without_graph_edges() {
    let (kernel, ports, workspace_id, principal_id, agent_id) = live_fixture();
    let task_id = create_open_task(&kernel, &principal_id, &workspace_id, "独立事项");
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id: agent_id.clone(),
            },
        ))
        .unwrap();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::StartRun {
                task_id,
                source: RunSource::Acp {
                    prompt: "no graph".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap();

    let automation_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateAutomation {
                workspace_id: workspace_id.clone(),
                name: "触发自动化".into(),
                runbook: "跑一次".into(),
                assignee_agent_id: Some(agent_id.clone()),
                schedule: "every:30m".into(),
                create_issue: true,
            },
        ))
        .unwrap()
        .ids["automation_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::TriggerAutomation { automation_id },
        ))
        .unwrap();

    let leader = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: principal_id.clone(),
                name: "领队".into(),
                harness: "claude".into(),
            },
        ))
        .unwrap()
        .ids["agent_id"]
        .as_str()
        .unwrap()
        .to_string();
    let squad_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateSquad {
                workspace_id: workspace_id.clone(),
                name: "无图小队".into(),
                leader_agent_id: leader,
            },
        ))
        .unwrap()
        .ids["squad_id"]
        .as_str()
        .unwrap()
        .to_string();
    let squad_task = create_open_task(&kernel, &principal_id, &workspace_id, "小队事项");
    kernel
        .submit_sync(cmd(
            Actor::Principal { id: principal_id },
            Command::AssignIssue {
                task_id: squad_task,
                agent_id: None,
                principal_id: None,
                squad_id: Some(squad_id),
                project_id: None,
                parent_id: None,
                stage: None,
            },
        ))
        .unwrap();
    let spawns = ports.spawns.lock().unwrap();
    assert!(spawns.iter().any(|row| row.2.contains("no graph")));
    assert!(spawns.iter().any(|row| row.2.contains("跑一次")));
    assert!(spawns.iter().any(|row| row.2.contains("无图小队")));
}

#[test]
fn approve_contract_invalidates_contract_dependencies() {
    let h = setup();
    let consumer = issue_title(&h, "implement");
    let proposed = h
        .kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ProposeContract {
                workspace_id: h.workspace_id.clone(),
                title: "shared api".into(),
                body: "do not break the contract".into(),
                participant_ids: vec![h.alice.clone(), h.bob.clone()],
            },
        ))
        .unwrap();
    let contract_id = proposed.ids["contract_id"].as_str().unwrap().to_string();
    declare_dep(&h, &consumer, &contract_id, "contract");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApproveContract {
                contract_id: contract_id.clone(),
            },
        ))
        .unwrap();
    assert!(alice_deps(&h).iter().all(|dep| dep.valid));
    h.kernel
        .submit_sync(cmd(
            Actor::Principal { id: h.bob.clone() },
            Command::ApproveContract { contract_id },
        ))
        .unwrap();
    assert!(alice_deps(&h)
        .iter()
        .any(|dep| !dep.valid && dep.from_id == consumer));
    assert_eq!(
        board_task(&alice_board(&h), &consumer)
            .blocked_reason
            .as_deref(),
        Some(STALE_DEPENDENCY_REASON)
    );
}

#[test]
fn settings_llm_toggle_keeps_deterministic_gate() {
    let h = setup();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::SetSettings {
                workspace_id: h.workspace_id.clone(),
                llm_advisor_enabled: false,
            },
        ))
        .unwrap();
    let settings = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Settings {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    match settings {
        View::Settings {
            llm_advisor_enabled,
            ..
        } => assert!(!llm_advisor_enabled),
        _ => panic!("settings"),
    }
}

#[test]
fn health_view_works() {
    let k = Kernel::default_in_process();
    let view = k.view_sync(q(daemon(), Query::Health)).unwrap();
    match view {
        View::Health(h) => assert_eq!(h.status, "ok"),
        _ => panic!("health"),
    }
}

#[test]
fn register_computer_upserts_same_workspace_name() {
    let h = setup();
    let first = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::RegisterComputer {
                workspace_id: h.workspace_id.clone(),
                name: "本机 (linux)".into(),
                kind: "desktop".into(),
                concurrency_limit: 20,
            },
        ))
        .unwrap();
    let second = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::RegisterComputer {
                workspace_id: h.workspace_id.clone(),
                name: "本机 (linux)".into(),
                kind: "desktop".into(),
                concurrency_limit: 8,
            },
        ))
        .unwrap();
    assert_eq!(first.ids["computer_id"], second.ids["computer_id"]);
    let view = h
        .kernel
        .view_sync(q(
            daemon(),
            Query::Computers {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    match view {
        View::Computers { items } => {
            assert_eq!(items.len(), 1);
            assert_eq!(items[0].concurrency_limit, 8);
        }
        _ => panic!("computers"),
    }
}

#[test]
fn update_principal_renames_self_only() {
    let h = setup();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::UpdatePrincipal {
                principal_id: h.alice.clone(),
                name: "艾丽丝".into(),
            },
        ))
        .unwrap();
    let view = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Account,
        ))
        .unwrap();
    match view {
        View::Account { account } => assert_eq!(account.name, "艾丽丝"),
        _ => panic!("account"),
    }
    assert!(h
        .kernel
        .submit_sync(cmd(
            Actor::Principal { id: h.bob.clone() },
            Command::UpdatePrincipal {
                principal_id: h.alice.clone(),
                name: "黑客".into(),
            },
        ))
        .is_err());
}

#[test]
fn start_run_acp_spawns_against_bound_repo() {
    let ports = std::sync::Arc::new(RecordingPorts::default());
    let kernel = Kernel::new(ports.clone(), std::sync::Arc::new(DeterministicAdvisor));
    let workspace_id = kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreateWorkspace { name: "acp".into() },
        ))
        .unwrap()
        .ids["workspace_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            daemon(),
            Command::BindRepository {
                workspace_id: workspace_id.clone(),
                path: "/tmp/coordy-acp-repo".into(),
            },
        ))
        .unwrap();
    let principal_id = kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreatePrincipal {
                workspace_id: workspace_id.clone(),
                name: "Owner".into(),
            },
        ))
        .unwrap()
        .ids["principal_id"]
        .as_str()
        .unwrap()
        .to_string();
    let agent_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: principal_id.clone(),
                name: "ACP".into(),
                harness: "claude-acp".into(),
            },
        ))
        .unwrap()
        .ids["agent_id"]
        .as_str()
        .unwrap()
        .to_string();
    let task_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateTask {
                workspace_id,
                title: "talk".into(),
                description: String::new(),
            },
        ))
        .unwrap()
        .ids["task_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id,
            },
        ))
        .unwrap();
    let outcome = kernel
        .submit_sync(cmd(
            Actor::Principal { id: principal_id },
            Command::StartRun {
                task_id,
                source: RunSource::Acp {
                    prompt: "hello acp".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap();
    assert!(!outcome.blocked);
    let spawns = ports.spawns.lock().unwrap();
    assert_eq!(spawns.len(), 1);
    assert_eq!(spawns[0].0, "claude-acp");
    assert_eq!(spawns[0].1, "/tmp/coordy-acp-repo");
    assert_eq!(spawns[0].2, "hello acp");
    assert_eq!(spawns[0].4, "");
    assert_eq!(spawns[0].5, "");
    assert_eq!(spawns[0].6, "");
}

#[test]
fn acp_session_tool_returns_task_for_review() {
    let ports = std::sync::Arc::new(RecordingPorts::default());
    let kernel = Kernel::new(ports, std::sync::Arc::new(DeterministicAdvisor));
    let workspace_id = kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreateWorkspace {
                name: "review".into(),
            },
        ))
        .unwrap()
        .ids["workspace_id"]
        .as_str()
        .unwrap()
        .to_string();
    let principal_id = kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreatePrincipal {
                workspace_id: workspace_id.clone(),
                name: "Owner".into(),
            },
        ))
        .unwrap()
        .ids["principal_id"]
        .as_str()
        .unwrap()
        .to_string();
    let agent_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: principal_id.clone(),
                name: "ACP".into(),
                harness: "claude-acp".into(),
            },
        ))
        .unwrap()
        .ids["agent_id"]
        .as_str()
        .unwrap()
        .to_string();
    let task_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateTask {
                workspace_id: workspace_id.clone(),
                title: "talk".into(),
                description: String::new(),
            },
        ))
        .unwrap()
        .ids["task_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id,
            },
        ))
        .unwrap();
    let run_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::StartRun {
                task_id: task_id.clone(),
                source: RunSource::Acp {
                    prompt: "hello acp".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap()
        .ids["run_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            Actor::Daemon,
            Command::IngestHarnessEvent {
                run_id: run_id.clone(),
                event: HarnessEvent::Tool {
                    name: coordy_protocol::HARNESS_SESSION_TOOL.into(),
                    input: "claude-acp".into(),
                    output: "end_turn".into(),
                    exit_code: Some(0),
                },
            },
        ))
        .unwrap();
    let View::Run { run, .. } = kernel
        .view_sync(q(
            Actor::Principal { id: principal_id },
            Query::Run { run_id },
        ))
        .unwrap()
    else {
        panic!("run view");
    };
    assert_eq!(run.status, "completed");
    let View::Board { tasks } = kernel
        .view_sync(q(Actor::Daemon, Query::Board { workspace_id }))
        .unwrap()
    else {
        panic!("board");
    };
    assert_eq!(tasks[0].id, task_id);
    assert_eq!(tasks[0].status, "open");
}

#[test]
fn principal_can_edit_issue_and_set_status() {
    let h = setup();
    let task_id = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::CreateTask {
                workspace_id: h.workspace_id.clone(),
                title: "ship".into(),
                description: "first note".into(),
            },
        ))
        .unwrap()
        .ids["task_id"]
        .as_str()
        .unwrap()
        .to_string();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::UpdateTask {
                task_id: task_id.clone(),
                title: Some("ship it".into()),
                description: None,
                priority: None,
                start_date: None,
                due_date: None,
                labels: None,
                custom_fields: None,
                sort_key: None,
            },
        ))
        .unwrap();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::SetTaskStatus {
                task_id: task_id.clone(),
                status: "done".into(),
            },
        ))
        .unwrap();
    let View::Board { tasks } = h
        .kernel
        .view_sync(q(
            Actor::Principal { id: h.alice },
            Query::Board {
                workspace_id: h.workspace_id,
            },
        ))
        .unwrap()
    else {
        panic!("board");
    };
    assert_eq!(tasks[0].id, task_id);
    assert_eq!(tasks[0].title, "ship it");
    assert_eq!(tasks[0].description, "first note");
    assert_eq!(tasks[0].status, "done");
}

#[test]
fn agent_cannot_set_task_status() {
    let h = setup();
    let task_id = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::CreateTask {
                workspace_id: h.workspace_id.clone(),
                title: "gate".into(),
                description: String::new(),
            },
        ))
        .unwrap()
        .ids["task_id"]
        .as_str()
        .unwrap()
        .to_string();
    let err = h
        .kernel
        .submit_sync(cmd(
            Actor::Agent {
                id: h.a1.clone(),
                principal_id: h.alice.clone(),
            },
            Command::SetTaskStatus {
                task_id,
                status: "done".into(),
            },
        ))
        .unwrap_err();
    assert_eq!(err.code, "denied");
}

#[test]
fn cancel_run_stops_active_round_and_ignores_later_session_tool() {
    let ports = std::sync::Arc::new(RecordingPorts::default());
    let kernel = Kernel::new(ports.clone(), std::sync::Arc::new(DeterministicAdvisor));
    let workspace_id = kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreateWorkspace {
                name: "cancel".into(),
            },
        ))
        .unwrap()
        .ids["workspace_id"]
        .as_str()
        .unwrap()
        .to_string();
    let principal_id = kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreatePrincipal {
                workspace_id: workspace_id.clone(),
                name: "Owner".into(),
            },
        ))
        .unwrap()
        .ids["principal_id"]
        .as_str()
        .unwrap()
        .to_string();
    let agent_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: principal_id.clone(),
                name: "ACP".into(),
                harness: "claude-acp".into(),
            },
        ))
        .unwrap()
        .ids["agent_id"]
        .as_str()
        .unwrap()
        .to_string();
    let task_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateTask {
                workspace_id: workspace_id.clone(),
                title: "talk".into(),
                description: String::new(),
            },
        ))
        .unwrap()
        .ids["task_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id,
            },
        ))
        .unwrap();
    let run_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::StartRun {
                task_id: task_id.clone(),
                source: RunSource::Acp {
                    prompt: "hello acp".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap()
        .ids["run_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CancelRun {
                run_id: run_id.clone(),
            },
        ))
        .unwrap();
    assert_eq!(
        ports.cancelled.lock().unwrap().as_slice(),
        &[run_id.clone()]
    );
    let late = kernel.submit_sync(cmd(
        Actor::Daemon,
        Command::IngestHarnessEvent {
            run_id: run_id.clone(),
            event: HarnessEvent::Tool {
                name: coordy_protocol::HARNESS_SESSION_TOOL.into(),
                input: "claude-acp".into(),
                output: "end_turn".into(),
                exit_code: Some(0),
            },
        },
    ));
    assert_eq!(late.unwrap_err().code, "invalid");
    let View::Run { run, events } = kernel
        .view_sync(q(
            Actor::Principal { id: principal_id },
            Query::Run { run_id },
        ))
        .unwrap()
    else {
        panic!("run view");
    };
    assert_eq!(run.status, "cancelled");
    assert!(events
        .iter()
        .any(|event| event.payload.contains("运行已停止")));
    let View::Board { tasks } = kernel
        .view_sync(q(Actor::Daemon, Query::Board { workspace_id }))
        .unwrap()
    else {
        panic!("board");
    };
    assert_eq!(tasks[0].id, task_id);
    assert_eq!(tasks[0].status, "open");
}

#[test]
fn archive_hides_unnamed_placeholder_agents() {
    let h = setup();
    let agent_id = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::CreateAgent {
                workspace_id: h.workspace_id.clone(),
                principal_id: h.alice.clone(),
                name: "助手".into(),
                harness: "acp".into(),
            },
        ))
        .unwrap()
        .ids["agent_id"]
        .as_str()
        .unwrap()
        .to_string();
    let before = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Agents {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    let View::Agents { items } = before else {
        panic!("agents");
    };
    assert!(items.iter().any(|agent| agent.id == agent_id));
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::ArchiveAgent {
                agent_id: agent_id.clone(),
            },
        ))
        .unwrap();
    let View::Agents { items } = h
        .kernel
        .view_sync(q(
            Actor::Principal { id: h.alice },
            Query::Agents {
                workspace_id: h.workspace_id,
            },
        ))
        .unwrap()
    else {
        panic!("agents");
    };
    assert!(!items.iter().any(|agent| agent.id == agent_id));
}

#[test]
fn agent_name_must_be_unique_in_workspace() {
    let h = setup();
    let err = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::CreateAgent {
                workspace_id: h.workspace_id.clone(),
                principal_id: h.alice.clone(),
                name: "A1".into(),
                harness: "jsonl".into(),
            },
        ))
        .unwrap_err();
    assert_eq!(err.code, "invalid");
}

#[test]
fn update_agent_stores_description_and_instructions() {
    let h = setup();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::UpdateAgent {
                agent_id: h.a1.clone(),
                name: Some("前端审查".into()),
                description: Some("审查前端 Pull Request".into()),
                instructions: Some("只在评论里写结论，不要改代码。".into()),
                harness: Some("claude-acp".into()),
                avatar: None,
                model: None,
                thinking: None,
                speed: None,
                access: None,
                access_member_ids: None,
                concurrency_limit: None,
                cli_args: None,
                mcp_servers: None,
                tool_access: None,
            },
        ))
        .unwrap();
    let View::Agents { items } = h
        .kernel
        .view_sync(q(
            Actor::Principal { id: h.alice },
            Query::Agents {
                workspace_id: h.workspace_id,
            },
        ))
        .unwrap()
    else {
        panic!("agents");
    };
    let agent = items.iter().find(|item| item.id == h.a1).unwrap();
    assert_eq!(agent.name, "前端审查");
    assert_eq!(agent.description, "审查前端 Pull Request");
    assert_eq!(agent.instructions, "只在评论里写结论，不要改代码。");
    assert_eq!(agent.harness, "claude-acp");
}

#[test]
fn start_run_prepends_agent_instructions() {
    let ports = std::sync::Arc::new(RecordingPorts::default());
    let kernel = Kernel::new(ports.clone(), std::sync::Arc::new(DeterministicAdvisor));
    let workspace_id = kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreateWorkspace { name: "acp".into() },
        ))
        .unwrap()
        .ids["workspace_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            daemon(),
            Command::BindRepository {
                workspace_id: workspace_id.clone(),
                path: "/tmp/coordy-acp-repo".into(),
            },
        ))
        .unwrap();
    let principal_id = kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreatePrincipal {
                workspace_id: workspace_id.clone(),
                name: "Owner".into(),
            },
        ))
        .unwrap()
        .ids["principal_id"]
        .as_str()
        .unwrap()
        .to_string();
    let agent_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: principal_id.clone(),
                name: "审查员".into(),
                harness: "claude-acp".into(),
            },
        ))
        .unwrap()
        .ids["agent_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::UpdateAgent {
                agent_id: agent_id.clone(),
                name: None,
                description: None,
                instructions: Some("先读测试。".into()),
                harness: None,
                avatar: None,
                model: None,
                thinking: None,
                speed: None,
                access: None,
                access_member_ids: None,
                concurrency_limit: None,
                cli_args: None,
                mcp_servers: None,
                tool_access: None,
            },
        ))
        .unwrap();
    let task_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateTask {
                workspace_id,
                title: "talk".into(),
                description: String::new(),
            },
        ))
        .unwrap()
        .ids["task_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id,
            },
        ))
        .unwrap();
    kernel
        .submit_sync(cmd(
            Actor::Principal { id: principal_id },
            Command::StartRun {
                task_id,
                source: RunSource::Acp {
                    prompt: "hello acp".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap();
    let spawns = ports.spawns.lock().unwrap();
    assert_eq!(spawns[0].2, "先读测试。\n\nhello acp");
}

#[test]
fn start_run_passes_agent_model_thinking_and_speed_to_spawn() {
    let ports = std::sync::Arc::new(RecordingPorts::default());
    let kernel = Kernel::new(ports.clone(), std::sync::Arc::new(DeterministicAdvisor));
    let workspace_id = kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreateWorkspace { name: "acp".into() },
        ))
        .unwrap()
        .ids["workspace_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            daemon(),
            Command::BindRepository {
                workspace_id: workspace_id.clone(),
                path: "/tmp/coordy-acp-repo".into(),
            },
        ))
        .unwrap();
    let principal_id = kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreatePrincipal {
                workspace_id: workspace_id.clone(),
                name: "Owner".into(),
            },
        ))
        .unwrap()
        .ids["principal_id"]
        .as_str()
        .unwrap()
        .to_string();
    let agent_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: principal_id.clone(),
                name: "审查员".into(),
                harness: "codex".into(),
            },
        ))
        .unwrap()
        .ids["agent_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::UpdateAgent {
                agent_id: agent_id.clone(),
                name: None,
                description: None,
                instructions: None,
                harness: None,
                avatar: None,
                model: Some("gpt-5.6-sol".into()),
                thinking: Some("high".into()),
                speed: Some("fast".into()),
                access: None,
                access_member_ids: None,
                concurrency_limit: None,
                cli_args: None,
                mcp_servers: None,
                tool_access: None,
            },
        ))
        .unwrap();
    let task_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateTask {
                workspace_id,
                title: "talk".into(),
                description: String::new(),
            },
        ))
        .unwrap()
        .ids["task_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id,
            },
        ))
        .unwrap();
    kernel
        .submit_sync(cmd(
            Actor::Principal { id: principal_id },
            Command::StartRun {
                task_id,
                source: RunSource::Acp {
                    prompt: "hello acp".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap();
    let spawns = ports.spawns.lock().unwrap();
    assert_eq!(spawns[0].0, "codex");
    assert_eq!(spawns[0].4, "gpt-5.6-sol");
    assert_eq!(spawns[0].5, "high");
    assert_eq!(spawns[0].6, "fast");
}

fn live_fixture() -> (
    Kernel,
    std::sync::Arc<RecordingPorts>,
    String,
    String,
    String,
) {
    let ports = std::sync::Arc::new(RecordingPorts::default());
    let kernel = Kernel::new(ports.clone(), std::sync::Arc::new(DeterministicAdvisor));
    let workspace_id = kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreateWorkspace {
                name: "live".into(),
            },
        ))
        .unwrap()
        .ids["workspace_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            daemon(),
            Command::BindRepository {
                workspace_id: workspace_id.clone(),
                path: "/tmp/coordy-live-repo".into(),
            },
        ))
        .unwrap();
    let principal_id = kernel
        .submit_sync(cmd(
            daemon(),
            Command::CreatePrincipal {
                workspace_id: workspace_id.clone(),
                name: "Owner".into(),
            },
        ))
        .unwrap()
        .ids["principal_id"]
        .as_str()
        .unwrap()
        .to_string();
    let agent_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: principal_id.clone(),
                name: "执行者".into(),
                harness: "claude".into(),
            },
        ))
        .unwrap()
        .ids["agent_id"]
        .as_str()
        .unwrap()
        .to_string();
    (kernel, ports, workspace_id, principal_id, agent_id)
}

fn create_open_task(
    kernel: &Kernel,
    principal_id: &str,
    workspace_id: &str,
    title: &str,
) -> String {
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.to_string(),
            },
            Command::CreateTask {
                workspace_id: workspace_id.into(),
                title: title.into(),
                description: "事项正文".into(),
            },
        ))
        .unwrap()
        .ids["task_id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn update_agent_cli_and_limit(
    kernel: &Kernel,
    principal_id: &str,
    agent_id: &str,
    cli_args: Option<String>,
    concurrency_limit: Option<u32>,
) {
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.to_string(),
            },
            Command::UpdateAgent {
                agent_id: agent_id.into(),
                name: None,
                description: None,
                instructions: None,
                harness: None,
                avatar: None,
                model: None,
                thinking: None,
                speed: None,
                access: None,
                access_member_ids: None,
                concurrency_limit,
                cli_args,
                mcp_servers: None,
                tool_access: None,
            },
        ))
        .unwrap();
}

#[test]
fn mention_run_spawns_without_changing_assignee() {
    let (kernel, ports, workspace_id, principal_id, agent_id) = live_fixture();
    let other = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: principal_id.clone(),
                name: "被提及".into(),
                harness: "claude".into(),
            },
        ))
        .unwrap()
        .ids["agent_id"]
        .as_str()
        .unwrap()
        .to_string();
    let task_id = create_open_task(&kernel, &principal_id, &workspace_id, "提及");
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id: agent_id.clone(),
            },
        ))
        .unwrap();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::StartMentionRun {
                task_id: task_id.clone(),
                agent_id: other.clone(),
                prompt: "@智能体 看这里".into(),
            },
        ))
        .unwrap();
    let View::Board { tasks } = kernel
        .view_sync(q(
            Actor::Principal { id: principal_id },
            Query::Board { workspace_id },
        ))
        .unwrap()
    else {
        panic!("board");
    };
    let task = tasks.iter().find(|item| item.id == task_id).unwrap();
    assert_eq!(task.assignee_agent_id.as_deref(), Some(agent_id.as_str()));
    let spawns = ports.spawns.lock().unwrap();
    assert_eq!(spawns.len(), 1);
    assert!(spawns[0].2.contains("@智能体 看这里"));
}

#[test]
fn retry_run_spawns_again_with_original_prompt() {
    let (kernel, ports, workspace_id, principal_id, agent_id) = live_fixture();
    let task_id = create_open_task(&kernel, &principal_id, &workspace_id, "重试");
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id: agent_id.clone(),
            },
        ))
        .unwrap();
    let started = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::StartRun {
                task_id,
                source: RunSource::Acp {
                    prompt: "original prompt".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap();
    let run_id = started.ids["run_id"].as_str().unwrap().to_string();
    kernel
        .submit_sync(cmd(
            Actor::Principal { id: principal_id },
            Command::RetryRun { run_id },
        ))
        .unwrap();
    let spawns = ports.spawns.lock().unwrap();
    assert_eq!(spawns.len(), 2);
    assert_eq!(spawns[0].2, spawns[1].2);
    assert!(spawns[0].2.contains("original prompt"));
}

#[test]
fn squad_assignment_spawns_leader() {
    let (kernel, ports, workspace_id, principal_id, leader_id) = live_fixture();
    let member_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: principal_id.clone(),
                name: "队员".into(),
                harness: "claude".into(),
            },
        ))
        .unwrap()
        .ids["agent_id"]
        .as_str()
        .unwrap()
        .to_string();
    let squad_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateSquad {
                workspace_id: workspace_id.clone(),
                name: "前端组".into(),
                leader_agent_id: leader_id,
            },
        ))
        .unwrap()
        .ids["squad_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::SetSquadMembers {
                squad_id: squad_id.clone(),
                agent_ids: vec![member_id],
            },
        ))
        .unwrap();
    let task_id = create_open_task(&kernel, &principal_id, &workspace_id, "小队事项");
    kernel
        .submit_sync(cmd(
            Actor::Principal { id: principal_id },
            Command::AssignIssue {
                task_id,
                agent_id: None,
                principal_id: None,
                squad_id: Some(squad_id),
                project_id: None,
                parent_id: None,
                stage: None,
            },
        ))
        .unwrap();
    let spawns = ports.spawns.lock().unwrap();
    assert_eq!(spawns.len(), 1);
    assert!(spawns[0].2.contains("前端组"));
    assert!(spawns[0].2.contains("队员"));
    assert!(spawns[0].2.contains("事项正文"));
}

#[test]
fn trigger_automation_creates_task_and_spawns_assignee() {
    let (kernel, ports, workspace_id, principal_id, agent_id) = live_fixture();
    let automation_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateAutomation {
                workspace_id: workspace_id.clone(),
                name: "每日检查".into(),
                runbook: "检查未完成事项".into(),
                assignee_agent_id: Some(agent_id),
                schedule: "every:30m".into(),
                create_issue: true,
            },
        ))
        .unwrap()
        .ids["automation_id"]
        .as_str()
        .unwrap()
        .to_string();
    let outcome = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::TriggerAutomation { automation_id },
        ))
        .unwrap();
    let task_id = outcome.ids["task_id"].as_str().unwrap();
    let View::Board { tasks } = kernel
        .view_sync(q(
            Actor::Principal { id: principal_id },
            Query::Board { workspace_id },
        ))
        .unwrap()
    else {
        panic!("board");
    };
    assert!(tasks
        .iter()
        .any(|task| task.id == task_id && task.title == "每日检查"));
    let spawns = ports.spawns.lock().unwrap();
    assert_eq!(spawns.len(), 1);
    assert!(spawns[0].2.contains("检查未完成事项"));
}

#[test]
fn bound_skill_is_injected_into_later_start_run() {
    let (kernel, ports, workspace_id, principal_id, agent_id) = live_fixture();
    let skill_id = kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateSkill {
                workspace_id: workspace_id.clone(),
                name: "审查规范".into(),
                body: "只看 TypeScript".into(),
            },
        ))
        .unwrap()
        .ids["skill_id"]
        .as_str()
        .unwrap()
        .to_string();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::SetAgentSkills {
                agent_id: agent_id.clone(),
                skill_ids: vec![skill_id],
            },
        ))
        .unwrap();
    let task_id = create_open_task(&kernel, &principal_id, &workspace_id, "skill");
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id,
            },
        ))
        .unwrap();
    kernel
        .submit_sync(cmd(
            Actor::Principal { id: principal_id },
            Command::StartRun {
                task_id,
                source: RunSource::Acp {
                    prompt: "开始".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap();
    let spawns = ports.spawns.lock().unwrap();
    assert!(spawns[0].2.contains("审查规范"));
    assert!(spawns[0].2.contains("只看 TypeScript"));
    assert!(spawns[0].2.contains("开始"));
}

#[test]
fn start_run_rejects_when_concurrency_limit_reached() {
    let (kernel, _ports, workspace_id, principal_id, agent_id) = live_fixture();
    update_agent_cli_and_limit(&kernel, &principal_id, &agent_id, None, Some(1));
    let first = create_open_task(&kernel, &principal_id, &workspace_id, "one");
    let second = create_open_task(&kernel, &principal_id, &workspace_id, "two");
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: first.clone(),
                agent_id: agent_id.clone(),
            },
        ))
        .unwrap();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: second.clone(),
                agent_id: agent_id.clone(),
            },
        ))
        .unwrap();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::StartRun {
                task_id: first,
                source: RunSource::Acp {
                    prompt: "first".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap();
    let err = kernel
        .submit_sync(cmd(
            Actor::Principal { id: principal_id },
            Command::StartRun {
                task_id: second,
                source: RunSource::Acp {
                    prompt: "second".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap_err();
    assert_eq!(err.code, "invalid");
    assert!(err.message.contains("concurrency"));
}

#[test]
fn start_run_passes_cli_args_to_spawn() {
    let (kernel, ports, workspace_id, principal_id, agent_id) = live_fixture();
    update_agent_cli_and_limit(
        &kernel,
        &principal_id,
        &agent_id,
        Some("--foo bar".into()),
        None,
    );
    let task_id = create_open_task(&kernel, &principal_id, &workspace_id, "cli");
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id,
            },
        ))
        .unwrap();
    kernel
        .submit_sync(cmd(
            Actor::Principal { id: principal_id },
            Command::StartRun {
                task_id,
                source: RunSource::Acp {
                    prompt: "go".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap();
    let spawns = ports.spawns.lock().unwrap();
    assert_eq!(spawns[0].7, "--foo bar");
}

#[test]
fn tool_access_defaults_to_auto_and_full_access_reaches_spawn() {
    let (kernel, ports, workspace_id, principal_id, agent_id) = live_fixture();
    let View::Agents { items } = kernel
        .view_sync(q(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Query::Agents {
                workspace_id: workspace_id.clone(),
            },
        ))
        .unwrap()
    else {
        panic!("agents");
    };
    assert_eq!(
        items
            .iter()
            .find(|item| item.id == agent_id)
            .map(|item| item.tool_access.as_str()),
        Some("auto")
    );

    let first = create_open_task(&kernel, &principal_id, &workspace_id, "auto-run");
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: first.clone(),
                agent_id: agent_id.clone(),
            },
        ))
        .unwrap();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::StartRun {
                task_id: first,
                source: RunSource::Acp {
                    prompt: "auto".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap();
    assert_eq!(ports.spawns.lock().unwrap()[0].8, "auto");

    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::UpdateAgent {
                agent_id: agent_id.clone(),
                name: None,
                description: None,
                instructions: None,
                harness: None,
                avatar: None,
                model: None,
                thinking: None,
                speed: None,
                access: None,
                access_member_ids: None,
                concurrency_limit: None,
                cli_args: None,
                tool_access: Some("full_access".into()),
                mcp_servers: None,
            },
        ))
        .unwrap();
    let second = create_open_task(&kernel, &principal_id, &workspace_id, "full-run");
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: second.clone(),
                agent_id: agent_id.clone(),
            },
        ))
        .unwrap();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::StartRun {
                task_id: second,
                source: RunSource::Acp {
                    prompt: "full".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap();
    assert_eq!(ports.spawns.lock().unwrap()[1].8, "full_access");

    let err = kernel
        .submit_sync(cmd(
            Actor::Principal { id: principal_id },
            Command::UpdateAgent {
                agent_id,
                name: None,
                description: None,
                instructions: None,
                harness: None,
                avatar: None,
                model: None,
                thinking: None,
                speed: None,
                access: None,
                access_member_ids: None,
                concurrency_limit: None,
                cli_args: None,
                tool_access: Some("yolo".into()),
                mcp_servers: None,
            },
        ))
        .unwrap_err();
    assert_eq!(err.code, "invalid");
    assert!(err.message.contains("tool_access"));
}

#[test]
fn invalid_agent_fields_do_not_partially_update_agent() {
    let (kernel, _ports, workspace_id, principal_id, agent_id) = live_fixture();

    let invalid_update = |name: Option<&str>,
                          harness: Option<&str>,
                          access: Option<&str>,
                          tool_access: Option<&str>| {
        Command::UpdateAgent {
            agent_id: agent_id.clone(),
            name: name.map(str::to_string),
            description: Some("也不应保存".into()),
            instructions: None,
            harness: harness.map(str::to_string),
            avatar: None,
            model: None,
            thinking: None,
            speed: None,
            access: access.map(str::to_string),
            access_member_ids: None,
            concurrency_limit: None,
            cli_args: None,
            tool_access: tool_access.map(str::to_string),
            mcp_servers: None,
        }
    };
    for command in [
        invalid_update(Some(""), None, None, None),
        invalid_update(Some("不应保存"), Some("  "), None, None),
        invalid_update(Some("不应保存"), None, Some("public"), None),
        invalid_update(Some("不应保存"), None, None, Some("yolo")),
    ] {
        let err = kernel
            .submit_sync(cmd(
                Actor::Principal {
                    id: principal_id.clone(),
                },
                command,
            ))
            .unwrap_err();
        assert_eq!(err.code, "invalid");
    }

    let View::Agents { items } = kernel
        .view_sync(q(
            Actor::Principal { id: principal_id },
            Query::Agents { workspace_id },
        ))
        .unwrap()
    else {
        panic!("agents");
    };
    let agent = items.iter().find(|item| item.id == agent_id).unwrap();
    assert_eq!(agent.name, "执行者");
    assert!(agent.description.is_empty());
    assert_eq!(agent.harness, "claude");
    assert_eq!(agent.access, "owner");
    assert_eq!(agent.tool_access, "auto");
}

#[test]
fn sweep_automations_arms_then_fires_after_interval() {
    let (kernel, ports, workspace_id, principal_id, agent_id) = live_fixture();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::CreateAutomation {
                workspace_id: workspace_id.clone(),
                name: "间隔任务".into(),
                runbook: "sweep body".into(),
                assignee_agent_id: Some(agent_id),
                schedule: "every:1m".into(),
                create_issue: true,
            },
        ))
        .unwrap();
    kernel
        .submit_sync(cmd(daemon(), Command::SweepAutomations { now_ms: 1_000 }))
        .unwrap();
    let View::Board { tasks } = kernel
        .view_sync(q(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Query::Board {
                workspace_id: workspace_id.clone(),
            },
        ))
        .unwrap()
    else {
        panic!("board");
    };
    assert!(!tasks.iter().any(|task| task.title == "间隔任务"));
    assert!(ports.spawns.lock().unwrap().is_empty());
    kernel
        .submit_sync(cmd(daemon(), Command::SweepAutomations { now_ms: 61_000 }))
        .unwrap();
    let View::Board { tasks } = kernel
        .view_sync(q(
            Actor::Principal { id: principal_id },
            Query::Board { workspace_id },
        ))
        .unwrap()
    else {
        panic!("board");
    };
    assert!(tasks.iter().any(|task| task.title == "间隔任务"));
    assert_eq!(ports.spawns.lock().unwrap().len(), 1);
}

fn issue_title(h: &Harness, title: &str) -> String {
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::CreateTask {
                workspace_id: h.workspace_id.clone(),
                title: title.into(),
                description: String::new(),
            },
        ))
        .unwrap()
        .ids["task_id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn board_task(tasks: &[coordy_protocol::TaskView], id: &str) -> coordy_protocol::TaskView {
    tasks
        .iter()
        .find(|task| task.id == id)
        .expect("task")
        .clone()
}

fn alice_board(h: &Harness) -> Vec<coordy_protocol::TaskView> {
    match h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Board {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap()
    {
        View::Board { tasks } => tasks,
        other => panic!("expected board, got {other:?}"),
    }
}

#[test]
fn issue_blocker_holds_start_and_releases_when_done() {
    let h = setup();
    let blocker = issue_title(&h, "design");
    let waiting = issue_title(&h, "implement");
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::AssignTask {
                task_id: waiting.clone(),
                agent_id: h.a1.clone(),
            },
        ))
        .unwrap();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::AddIssueBlocker {
                task_id: waiting.clone(),
                blocker_id: blocker.clone(),
            },
        ))
        .unwrap();
    let tasks = alice_board(&h);
    let waiting_view = board_task(&tasks, &waiting);
    assert_eq!(waiting_view.status, "blocked");
    assert_eq!(
        waiting_view.blocked_reason.as_deref(),
        Some(coordy_protocol::ISSUE_BLOCKER_REASON)
    );
    assert_eq!(waiting_view.blocker_ids, vec![blocker.clone()]);
    assert_eq!(waiting_view.unresolved_blocker_ids, vec![blocker.clone()]);
    assert_eq!(
        board_task(&tasks, &blocker).blocking_ids,
        vec![waiting.clone()]
    );

    let start_err = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::StartRun {
                task_id: waiting.clone(),
                source: RunSource::Fixture { events: vec![] },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        ))
        .unwrap_err();
    assert_eq!(start_err.code, "invalid");
    assert!(start_err.message.contains("前置事项尚未完成"));

    let done_err = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::SetTaskStatus {
                task_id: waiting.clone(),
                status: "done".into(),
            },
        ))
        .unwrap_err();
    assert_eq!(done_err.code, "invalid");

    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::SetTaskStatus {
                task_id: blocker.clone(),
                status: "done".into(),
            },
        ))
        .unwrap();
    let tasks = alice_board(&h);
    let waiting_view = board_task(&tasks, &waiting);
    assert_eq!(waiting_view.status, "open");
    assert!(waiting_view.blocked_reason.is_none());
    assert!(waiting_view.unresolved_blocker_ids.is_empty());
    assert_eq!(waiting_view.blocker_ids, vec![blocker.clone()]);

    let View::Runs { items: runs } = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Runs {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap()
    else {
        panic!("runs");
    };
    assert!(
        runs.iter()
            .any(|run| run.task_id == waiting && run.trigger == "blocker"),
        "assigned waiting task should start when its blocker is done"
    );
}

#[test]
fn issue_blocker_rejects_cycles_and_keeps_manual_block() {
    let h = setup();
    let a = issue_title(&h, "a");
    let b = issue_title(&h, "b");
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::AddIssueBlocker {
                task_id: b.clone(),
                blocker_id: a.clone(),
            },
        ))
        .unwrap();
    let cycle = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::AddIssueBlocker {
                task_id: a.clone(),
                blocker_id: b,
            },
        ))
        .unwrap_err();
    assert!(cycle.message.contains("循环"));
    let self_block = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::AddIssueBlocker {
                task_id: a.clone(),
                blocker_id: a,
            },
        ))
        .unwrap_err();
    assert!(self_block.message.contains("自己"));

    let waiting = issue_title(&h, "manual");
    let blocker = issue_title(&h, "still-open");
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::AssignTask {
                task_id: waiting.clone(),
                agent_id: h.a1.clone(),
            },
        ))
        .unwrap();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::SetTaskStatus {
                task_id: waiting.clone(),
                status: "blocked".into(),
            },
        ))
        .unwrap();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::AddIssueBlocker {
                task_id: waiting.clone(),
                blocker_id: blocker.clone(),
            },
        ))
        .unwrap();
    let view = board_task(&alice_board(&h), &waiting);
    assert_eq!(view.status, "blocked");
    assert_eq!(view.blocked_reason.as_deref(), Some("marked blocked"));
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::SetTaskStatus {
                task_id: blocker,
                status: "done".into(),
            },
        ))
        .unwrap();
    let view = board_task(&alice_board(&h), &waiting);
    assert_eq!(view.status, "blocked");
    assert_eq!(view.blocked_reason.as_deref(), Some("marked blocked"));
    let View::Runs { items: runs } = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Runs {
                workspace_id: h.workspace_id,
            },
        ))
        .unwrap()
    else {
        panic!("runs");
    };
    assert!(
        !runs
            .iter()
            .any(|run| run.task_id == waiting && run.trigger == "blocker"),
        "hand-marked blocked tasks must not auto-start"
    );
}

#[test]
fn cancelling_or_removing_blocker_releases_auto_hold() {
    let h = setup();
    let blocker = issue_title(&h, "wait-on");
    let waiting = issue_title(&h, "held");
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::AddIssueBlocker {
                task_id: waiting.clone(),
                blocker_id: blocker.clone(),
            },
        ))
        .unwrap();
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::SetTaskStatus {
                task_id: blocker.clone(),
                status: "cancelled".into(),
            },
        ))
        .unwrap();
    assert_eq!(board_task(&alice_board(&h), &waiting).status, "open");

    let other = issue_title(&h, "other");
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::AddIssueBlocker {
                task_id: waiting.clone(),
                blocker_id: other.clone(),
            },
        ))
        .unwrap();
    assert_eq!(board_task(&alice_board(&h), &waiting).status, "blocked");
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::RemoveIssueBlocker {
                task_id: waiting.clone(),
                blocker_id: other,
            },
        ))
        .unwrap();
    assert_eq!(board_task(&alice_board(&h), &waiting).status, "open");
}

#[test]
fn finishing_blocker_starts_assigned_waiting_task() {
    let (kernel, ports, workspace_id, principal_id, agent_id) = live_fixture();
    let blocker = create_open_task(&kernel, &principal_id, &workspace_id, "design");
    let waiting = create_open_task(&kernel, &principal_id, &workspace_id, "implement");
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: waiting.clone(),
                agent_id: agent_id.clone(),
            },
        ))
        .unwrap();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AddIssueBlocker {
                task_id: waiting.clone(),
                blocker_id: blocker.clone(),
            },
        ))
        .unwrap();
    assert!(ports.spawns.lock().unwrap().is_empty());
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::SetTaskStatus {
                task_id: blocker,
                status: "done".into(),
            },
        ))
        .unwrap();
    let spawns = ports.spawns.lock().unwrap();
    assert_eq!(spawns.len(), 1);
    assert!(spawns[0].2.contains("事项正文"));
    let View::Runs { items: runs } = kernel
        .view_sync(q(
            Actor::Principal { id: principal_id },
            Query::Runs { workspace_id },
        ))
        .unwrap()
    else {
        panic!("runs");
    };
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].task_id, waiting);
    assert_eq!(runs[0].trigger, "blocker");
}

#[test]
fn finishing_one_of_two_blockers_does_not_start() {
    let (kernel, ports, workspace_id, principal_id, agent_id) = live_fixture();
    let first = create_open_task(&kernel, &principal_id, &workspace_id, "a");
    let second = create_open_task(&kernel, &principal_id, &workspace_id, "b");
    let waiting = create_open_task(&kernel, &principal_id, &workspace_id, "c");
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AssignTask {
                task_id: waiting.clone(),
                agent_id,
            },
        ))
        .unwrap();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AddIssueBlocker {
                task_id: waiting.clone(),
                blocker_id: first.clone(),
            },
        ))
        .unwrap();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::AddIssueBlocker {
                task_id: waiting,
                blocker_id: second.clone(),
            },
        ))
        .unwrap();
    kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: principal_id.clone(),
            },
            Command::SetTaskStatus {
                task_id: first,
                status: "done".into(),
            },
        ))
        .unwrap();
    assert!(ports.spawns.lock().unwrap().is_empty());
    kernel
        .submit_sync(cmd(
            Actor::Principal { id: principal_id },
            Command::SetTaskStatus {
                task_id: second,
                status: "done".into(),
            },
        ))
        .unwrap();
    assert_eq!(ports.spawns.lock().unwrap().len(), 1);
}

#[test]
fn apply_patch_invalidates_only_edges_pointing_at_changer() {
    let h = setup();
    let producer_a = issue_title(&h, "api-a");
    let producer_b = issue_title(&h, "api-b");
    let consumer_a = issue_title(&h, "ui-a");
    let consumer_b = issue_title(&h, "ui-b");
    assign_a1(&h, &producer_a);
    bind_demo_repo(&h);
    create_worktree(&h, &producer_a);
    let dep_a = declare_dep(&h, &consumer_a, &producer_a, "repo");
    let dep_b = declare_dep(&h, &consumer_b, &producer_b, "repo");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer_a,
                patch: "safe change".into(),
            },
        ))
        .unwrap();
    let deps = alice_deps(&h);
    assert!(
        deps.iter().any(|dep| dep.id == dep_a && !dep.valid),
        "edge pointing at the patched producer must go stale"
    );
    assert!(
        deps.iter().any(|dep| dep.id == dep_b && dep.valid),
        "unrelated repo edge must stay valid"
    );
}

#[test]
fn assign_without_conductor_does_not_auto_start() {
    let h = setup();
    let task = issue_title(&h, "solo");
    assign_a1(&h, &task);
    assert!(
        alice_runs(&h).is_empty(),
        "no conductor means assign must not StartRun"
    );
}

#[test]
fn conductor_auto_starts_assigned_green_task() {
    let h = setup();
    set_conductor(&h, &h.a2);
    let ws = h
        .kernel
        .view_sync(q(
            alice_actor(&h),
            Query::Workspace {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    match ws {
        View::Workspace(view) => {
            assert_eq!(view.conductor_agent_id.as_deref(), Some(h.a2.as_str()));
        }
        other => panic!("expected workspace, got {other:?}"),
    }
    let task = issue_title(&h, "ready");
    assign_a1(&h, &task);
    let runs = alice_runs(&h);
    assert!(
        runs.iter()
            .any(|run| run.task_id == task && run.agent_id == h.a1 && run.trigger == "graph"),
        "conductor mode must StartRun the assignee with trigger graph"
    );
}

#[test]
fn failed_automatic_spawn_does_not_leave_a_running_run() {
    let kernel = Kernel::new(
        std::sync::Arc::new(NoopPorts),
        std::sync::Arc::new(DeterministicAdvisor),
    );
    let h = setup_kernel(kernel);
    set_conductor(&h, &h.a2);
    let task = issue_title(&h, "spawn failure");

    assign_a1(&h, &task);

    let run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == task && run.trigger == "graph")
        .expect("failed graph dispatch must remain auditable");
    assert_eq!(run.status, "failed");
    assert_eq!(run.queue_status, "failed");
}

#[test]
fn conductor_starts_waiting_task_when_blocker_finishes() {
    let h = setup();
    set_conductor(&h, &h.a2);
    let blocker = issue_title(&h, "design");
    let waiting = issue_title(&h, "implement");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::AddIssueBlocker {
                task_id: waiting.clone(),
                blocker_id: blocker.clone(),
            },
        ))
        .unwrap();
    assign_a1(&h, &blocker);
    assign_a1(&h, &waiting);
    assert!(
        !alice_runs(&h)
            .iter()
            .any(|run| run.task_id == waiting && run.trigger == "graph"),
        "blocked waiting task must not auto-start"
    );
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::SetTaskStatus {
                task_id: blocker,
                status: "done".into(),
            },
        ))
        .unwrap();
    let runs = alice_runs(&h);
    assert!(
        runs.iter()
            .any(|run| run.task_id == waiting && run.trigger == "graph" && run.agent_id == h.a1),
        "conductor mode starts the waiting assignee with graph, not blocker"
    );
    assert!(
        !runs
            .iter()
            .any(|run| run.task_id == waiting && run.trigger == "blocker"),
        "conductor mode must not also open a blocker-triggered run"
    );
}

#[test]
fn conductor_reviews_stale_edge_then_reaffirm_starts_executor() {
    let h = setup();
    set_conductor(&h, &h.a2);
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    assign_a1(&h, &producer);
    assign_a1(&h, &consumer);
    bind_demo_repo(&h);
    create_worktree(&h, &producer);
    let dep_id = declare_dep(&h, &consumer, &producer, "repo");
    let producer_run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == producer && run.trigger == "graph")
        .expect("producer run")
        .id;
    let executor_before = alice_runs(&h)
        .into_iter()
        .filter(|run| run.task_id == consumer && run.agent_id == h.a1)
        .count();
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer,
                patch: "safe change".into(),
            },
        ))
        .unwrap();
    let after_patch = alice_runs(&h);
    assert!(
        after_patch.iter().any(|run| {
            run.task_id == consumer && run.agent_id == h.a2 && run.trigger == "graph_review"
        }),
        "stale downstream must StartRun the conductor"
    );
    assert_eq!(
        after_patch
            .iter()
            .filter(|run| run.task_id == consumer
                && run.agent_id == h.a1
                && run.status == "running")
            .count(),
        0,
        "executor must not auto-start while the edge is stale"
    );
    let conductor_run = after_patch
        .iter()
        .find(|run| {
            run.task_id == consumer && run.agent_id == h.a2 && run.trigger == "graph_review"
        })
        .expect("conductor run")
        .id
        .clone();
    ingest_assistant(&h, &conductor_run, &format!("REAFFIRM: {dep_id}"));
    assert!(alice_deps(&h)
        .iter()
        .any(|dep| dep.id == dep_id && dep.valid));
    let after_reaffirm = alice_runs(&h);
    assert_eq!(
        after_reaffirm
            .iter()
            .filter(|run| run.task_id == consumer && run.agent_id == h.a1)
            .count(),
        executor_before,
        "REAFFIRM cannot bypass an unfinished producer"
    );
    ingest_session_ok(&h, &producer_run);
    let after_success = alice_runs(&h);
    assert!(
        after_success
            .iter()
            .filter(|run| run.task_id == consumer && run.agent_id == h.a1)
            .count()
            > executor_before
    );
    let executor_run = after_success
        .iter()
        .find(|run| {
            run.task_id == consumer
                && run.agent_id == h.a1
                && run.trigger == "graph"
                && run.status == "running"
        })
        .expect("executor run");
    let View::Run { events, .. } = h
        .kernel
        .view_sync(q(
            alice_actor(&h),
            Query::Run {
                run_id: executor_run.id.clone(),
            },
        ))
        .unwrap()
    else {
        panic!("run detail");
    };
    assert!(events.iter().any(|event| event.payload.contains("user:")));
}

#[test]
fn executor_agent_cannot_reaffirm_but_principal_and_conductor_can() {
    let h = setup();
    set_conductor(&h, &h.a2);
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    assign_a1(&h, &producer);
    bind_demo_repo(&h);
    create_worktree(&h, &producer);
    let dep_id = declare_dep(&h, &consumer, &producer, "repo");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer,
                patch: "safe change".into(),
            },
        ))
        .unwrap();
    let generation = alice_deps(&h)
        .into_iter()
        .find(|dep| dep.id == dep_id)
        .expect("dependency")
        .generation;
    let denied = h
        .kernel
        .submit_sync(cmd(
            Actor::Agent {
                id: h.a1.clone(),
                principal_id: h.alice.clone(),
            },
            Command::ReaffirmDependency {
                dependency_id: dep_id.clone(),
                expected_generation: generation,
            },
        ))
        .unwrap_err();
    assert_eq!(denied.code, "denied");
    h.kernel
        .submit_sync(cmd(
            Actor::Agent {
                id: h.a2.clone(),
                principal_id: h.alice.clone(),
            },
            Command::ReaffirmDependency {
                dependency_id: dep_id.clone(),
                expected_generation: generation,
            },
        ))
        .unwrap();
    let producer_b = issue_title(&h, "other-api");
    assign_a1(&h, &producer_b);
    create_worktree(&h, &producer_b);
    let dep_b = declare_dep(&h, &consumer, &producer_b, "repo");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer_b,
                patch: "another change".into(),
            },
        ))
        .unwrap();
    reaffirm_dep(&h, &dep_b);
}

#[test]
fn conductor_session_complete_starts_green_successor() {
    let h = setup();
    set_conductor(&h, &h.a2);
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    declare_dep(&h, &consumer, &producer, "repo");
    assign_a1(&h, &producer);
    assign_a1(&h, &consumer);
    let producer_run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == producer && run.trigger == "graph")
        .expect("producer run")
        .id;
    assert_eq!(
        alice_runs(&h)
            .iter()
            .filter(|run| run.task_id == consumer && run.status == "running")
            .count(),
        0
    );
    ingest_session_ok(&h, &producer_run);
    assert!(
        alice_runs(&h).iter().any(|run| {
            run.task_id == consumer
                && run.agent_id == h.a1
                && run.trigger == "graph"
                && run.status == "running"
        }),
        "successful producer session must start a still-green successor"
    );
}

#[test]
fn executor_graph_run_cannot_reaffirm_by_prefix() {
    let h = setup();
    set_conductor(&h, &h.a2);
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    assign_a1(&h, &producer);
    assign_a1(&h, &consumer);
    bind_demo_repo(&h);
    create_worktree(&h, &producer);
    let dep_id = declare_dep(&h, &consumer, &producer, "repo");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer,
                patch: "safe change".into(),
            },
        ))
        .unwrap();
    let executor_run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == consumer && run.agent_id == h.a1)
        .map(|run| run.id);
    if let Some(run_id) = executor_run {
        let _ = h.kernel.submit_sync(cmd(
            daemon(),
            Command::IngestHarnessEvent {
                run_id,
                event: HarnessEvent::Message {
                    role: "assistant".into(),
                    content: format!("REAFFIRM: {dep_id}"),
                },
            },
        ));
    }
    assert!(
        alice_deps(&h)
            .iter()
            .any(|dep| dep.id == dep_id && !dep.valid),
        "only the conductor graph run may ingest REAFFIRM"
    );
}

#[test]
fn public_start_run_cannot_spoof_an_internal_graph_review() {
    let h = setup();
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    assign_a1(&h, &producer);
    assign_a1(&h, &consumer);
    bind_demo_repo(&h);
    create_worktree(&h, &producer);
    let dep_id = declare_dep(&h, &consumer, &producer, "repo");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer,
                patch: "safe change".into(),
            },
        ))
        .unwrap();
    set_conductor(&h, &h.a2);
    let legitimate_reviews = alice_runs(&h)
        .iter()
        .filter(|run| run.task_id == consumer && run.trigger == "graph_review")
        .count();
    let spoofed_source = || RunSource::Fixture {
        events: vec![HarnessEvent::Message {
            role: "assistant".into(),
            content: format!("REAFFIRM: {dep_id}"),
        }],
    };

    for actor in [
        alice_actor(&h),
        Actor::Agent {
            id: h.a2.clone(),
            principal_id: h.alice.clone(),
        },
    ] {
        for trigger in [
            "graph",
            "graph_execute",
            "graph_validate",
            "graph_resume",
            "graph_review",
        ] {
            let error = h
                .kernel
                .submit_sync(cmd(
                    actor.clone(),
                    Command::StartRun {
                        task_id: consumer.clone(),
                        source: spoofed_source(),
                        agent_id: Some(h.a2.clone()),
                        chat_id: None,
                        trigger: trigger.into(),
                    },
                ))
                .unwrap_err();
            assert_eq!(error.code, "invalid", "trigger {trigger}");
        }
    }

    assert!(alice_deps(&h)
        .iter()
        .any(|dep| dep.id == dep_id && !dep.valid));
    assert_eq!(
        alice_runs(&h)
            .iter()
            .filter(|run| run.task_id == consumer && run.trigger == "graph_review")
            .count(),
        legitimate_reviews
    );
}

#[test]
fn only_assistant_messages_from_the_review_run_can_reaffirm() {
    let h = setup();
    set_conductor(&h, &h.a2);
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    assign_a1(&h, &producer);
    assign_a1(&h, &consumer);
    bind_demo_repo(&h);
    create_worktree(&h, &producer);
    let dep_id = declare_dep(&h, &consumer, &producer, "repo");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer,
                patch: "safe change".into(),
            },
        ))
        .unwrap();
    let review_run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == consumer && run.trigger == "graph_review")
        .expect("review run")
        .id;

    h.kernel
        .submit_sync(cmd(
            daemon(),
            Command::IngestHarnessEvent {
                run_id: review_run.clone(),
                event: HarnessEvent::Message {
                    role: "system".into(),
                    content: format!("REAFFIRM: {dep_id}"),
                },
            },
        ))
        .unwrap();

    assert!(alice_deps(&h)
        .iter()
        .any(|dep| dep.id == dep_id && !dep.valid));

    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::CancelRun {
                run_id: review_run.clone(),
            },
        ))
        .unwrap();
    let late = h.kernel.submit_sync(cmd(
        daemon(),
        Command::IngestHarnessEvent {
            run_id: review_run,
            event: HarnessEvent::Message {
                role: "assistant".into(),
                content: format!("REAFFIRM: {dep_id}"),
            },
        },
    ));
    assert_eq!(late.unwrap_err().code, "invalid");
    assert!(alice_deps(&h)
        .iter()
        .any(|dep| dep.id == dep_id && !dep.valid));
}

#[test]
fn conductor_review_cannot_reaffirm_a_newer_dependency_generation() {
    let h = setup();
    set_conductor(&h, &h.a2);
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    assign_a1(&h, &producer);
    assign_a1(&h, &consumer);
    bind_demo_repo(&h);
    create_worktree(&h, &producer);
    let dep_id = declare_dep(&h, &consumer, &producer, "repo");
    let producer_run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == producer && run.trigger == "graph")
        .expect("producer run")
        .id;

    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer.clone(),
                patch: "first change".into(),
            },
        ))
        .unwrap();
    let old_review = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == consumer && run.trigger == "graph_review")
        .expect("first-generation review run");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer,
                patch: "second change".into(),
            },
        ))
        .unwrap();
    let new_review = alice_runs(&h)
        .into_iter()
        .find(|run| {
            run.task_id == consumer
                && run.trigger == "graph_review"
                && run.id != old_review.id
                && run.status == "running"
        })
        .expect("current-generation review run");
    assert_eq!(
        alice_deps(&h)
            .into_iter()
            .find(|dep| dep.id == dep_id)
            .expect("dependency")
            .generation,
        3
    );
    let executor_runs_before = alice_runs(&h)
        .iter()
        .filter(|run| run.task_id == consumer && run.agent_id == h.a1)
        .count();

    let late = h.kernel.submit_sync(cmd(
        daemon(),
        Command::IngestHarnessEvent {
            run_id: old_review.id,
            event: HarnessEvent::Message {
                role: "assistant".into(),
                content: format!("REAFFIRM: {dep_id}"),
            },
        },
    ));
    assert_eq!(late.unwrap_err().code, "invalid");

    assert!(alice_deps(&h)
        .iter()
        .any(|dep| dep.id == dep_id && !dep.valid));
    assert_eq!(
        alice_runs(&h)
            .iter()
            .filter(|run| run.task_id == consumer && run.agent_id == h.a1)
            .count(),
        executor_runs_before
    );

    ingest_assistant(&h, &new_review.id, &format!("REAFFIRM: {dep_id}"));
    assert!(alice_deps(&h)
        .iter()
        .any(|dep| dep.id == dep_id && dep.valid));
    assert_eq!(
        alice_runs(&h)
            .iter()
            .filter(|run| run.task_id == consumer && run.agent_id == h.a1)
            .count(),
        executor_runs_before,
        "reaffirming an edge must not bypass its unfinished producer"
    );
    ingest_session_ok(&h, &producer_run);
    assert!(
        alice_runs(&h)
            .iter()
            .filter(|run| run.task_id == consumer && run.agent_id == h.a1)
            .count()
            > executor_runs_before
    );
}

#[test]
fn missing_session_exit_code_does_not_start_a_successor() {
    let h = setup();
    set_conductor(&h, &h.a2);
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    declare_dep(&h, &consumer, &producer, "repo");
    assign_a1(&h, &producer);
    assign_a1(&h, &consumer);
    let producer_run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == producer && run.trigger == "graph")
        .expect("producer run")
        .id;

    h.kernel
        .submit_sync(cmd(
            daemon(),
            Command::IngestHarnessEvent {
                run_id: producer_run,
                event: HarnessEvent::Tool {
                    name: coordy_protocol::HARNESS_SESSION_TOOL.into(),
                    input: String::new(),
                    output: "unknown".into(),
                    exit_code: None,
                },
            },
        ))
        .unwrap();

    assert!(!alice_runs(&h)
        .iter()
        .any(|run| run.task_id == consumer && run.status == "running"));
}

#[test]
fn a_conductor_execution_run_is_not_a_review_run() {
    let h = setup();
    set_conductor(&h, &h.a1);
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    assign_a1(&h, &producer);
    assign_a1(&h, &consumer);
    let executor_run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == consumer && run.trigger == "graph")
        .expect("executor run")
        .id;
    bind_demo_repo(&h);
    create_worktree(&h, &producer);
    let dep_id = declare_dep(&h, &consumer, &producer, "repo");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer,
                patch: "safe change".into(),
            },
        ))
        .unwrap();

    let late = h.kernel.submit_sync(cmd(
        daemon(),
        Command::IngestHarnessEvent {
            run_id: executor_run,
            event: HarnessEvent::Message {
                role: "assistant".into(),
                content: format!("REAFFIRM: {dep_id}"),
            },
        },
    ));
    assert_eq!(late.unwrap_err().code, "invalid");
    assert!(alice_deps(&h)
        .iter()
        .any(|dep| dep.id == dep_id && !dep.valid));
    assert!(alice_runs(&h).iter().any(|run| {
        run.task_id == consumer && run.agent_id == h.a1 && run.trigger == "graph_review"
    }));
}

#[test]
fn archiving_the_conductor_clears_the_workspace_setting() {
    let h = setup();
    set_conductor(&h, &h.a2);
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ArchiveAgent {
                agent_id: h.a2.clone(),
            },
        ))
        .unwrap();

    let View::Workspace(workspace) = h
        .kernel
        .view_sync(q(
            alice_actor(&h),
            Query::Workspace {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap()
    else {
        panic!("workspace");
    };
    assert!(workspace.conductor_agent_id.is_none());
}

#[test]
fn setting_or_changing_conductor_reconciles_ready_and_stale_tasks() {
    let h = setup();
    let ready = issue_title(&h, "ready before conductor");
    assign_a1(&h, &ready);
    assert!(alice_runs(&h).is_empty());

    set_conductor(&h, &h.a2);
    assert!(alice_runs(&h)
        .iter()
        .any(|run| run.task_id == ready && run.trigger == "graph"));

    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    bind_demo_repo(&h);
    create_worktree(&h, &producer);
    let dep_id = declare_dep(&h, &consumer, &producer, "repo");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::UpdateWorkspace {
                workspace_id: h.workspace_id.clone(),
                name: None,
                icon: None,
                description: None,
                context: None,
                slug: None,
                issue_prefix: None,
                conductor_agent_id: Some(String::new()),
            },
        ))
        .unwrap();
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer,
                patch: "change".into(),
            },
        ))
        .unwrap();
    assert!(alice_deps(&h)
        .iter()
        .any(|dep| dep.id == dep_id && !dep.valid));

    set_conductor(&h, &h.a2);
    let first_review = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == consumer && run.trigger == "graph_review")
        .expect("setting conductor starts stale review");
    set_conductor(&h, &h.a1);
    assert!(alice_runs(&h).iter().any(|run| {
        run.task_id == consumer
            && run.trigger == "graph_review"
            && run.agent_id == h.a1
            && run.id != first_review.id
    }));
}

#[test]
fn late_or_duplicate_terminal_events_do_not_dispatch_successors() {
    let h = setup();
    set_conductor(&h, &h.a2);
    let producer = issue_title(&h, "api");
    let consumer = issue_title(&h, "ui");
    declare_dep(&h, &consumer, &producer, "repo");
    assign_a1(&h, &producer);
    assign_a1(&h, &consumer);
    let producer_run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == producer && run.trigger == "graph")
        .expect("producer run")
        .id;
    assert!(!alice_runs(&h)
        .iter()
        .any(|run| run.task_id == consumer && run.status == "running"));
    ingest_session_ok(&h, &producer_run);
    let successor = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == consumer && run.status == "running")
        .expect("successor")
        .id;
    ingest_session_ok(&h, &successor);
    let consumer_count = alice_runs(&h)
        .iter()
        .filter(|run| run.task_id == consumer)
        .count();

    let duplicate = h.kernel.submit_sync(cmd(
        daemon(),
        Command::IngestHarnessEvent {
            run_id: producer_run,
            event: HarnessEvent::Tool {
                name: coordy_protocol::HARNESS_SESSION_TOOL.into(),
                input: String::new(),
                output: "duplicate".into(),
                exit_code: Some(0),
            },
        },
    ));
    assert_eq!(duplicate.unwrap_err().code, "invalid");
    assert_eq!(
        alice_runs(&h)
            .iter()
            .filter(|run| run.task_id == consumer)
            .count(),
        consumer_count
    );

    let cancelled_producer = issue_title(&h, "cancelled producer");
    let waiting = issue_title(&h, "must stay waiting");
    declare_dep(&h, &waiting, &cancelled_producer, "repo");
    assign_a1(&h, &cancelled_producer);
    let cancelled_run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == cancelled_producer && run.status == "running")
        .expect("cancelled producer run")
        .id;
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::CancelRun {
                run_id: cancelled_run.clone(),
            },
        ))
        .unwrap();
    let late = h.kernel.submit_sync(cmd(
        daemon(),
        Command::IngestHarnessEvent {
            run_id: cancelled_run,
            event: HarnessEvent::Tool {
                name: coordy_protocol::HARNESS_SESSION_TOOL.into(),
                input: String::new(),
                output: "late".into(),
                exit_code: Some(0),
            },
        },
    ));
    assert_eq!(late.unwrap_err().code, "invalid");
    assert!(!alice_runs(&h)
        .iter()
        .any(|run| run.task_id == waiting && run.status == "running"));
}

#[test]
fn graph_reconcile_retries_capacity_blocked_sibling_and_review() {
    let h = setup();
    update_agent_cli_and_limit(&h.kernel, &h.alice, &h.a1, None, Some(1));
    set_conductor(&h, &h.a2);
    let first = issue_title(&h, "first");
    let sibling = issue_title(&h, "sibling");
    assign_a1(&h, &first);
    assign_a1(&h, &sibling);
    let first_run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == first && run.status == "running")
        .expect("first run")
        .id;
    assert!(!alice_runs(&h)
        .iter()
        .any(|run| run.task_id == sibling && run.status == "running"));
    ingest_session_ok(&h, &first_run);
    assert!(alice_runs(&h)
        .iter()
        .any(|run| run.task_id == sibling && run.status == "running"));
    assert_eq!(
        alice_runs(&h)
            .iter()
            .filter(|run| run.task_id == first && run.trigger == "graph")
            .count(),
        1
    );

    update_agent_cli_and_limit(&h.kernel, &h.alice, &h.a2, None, Some(1));
    let occupying = issue_title(&h, "conductor occupied");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::AssignTask {
                task_id: occupying.clone(),
                agent_id: h.a2.clone(),
            },
        ))
        .unwrap();
    let occupying_run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == occupying && run.status == "running")
        .expect("occupying run")
        .id;
    let producer = issue_title(&h, "producer");
    let consumer = issue_title(&h, "stale consumer");
    bind_demo_repo(&h);
    create_worktree(&h, &producer);
    declare_dep(&h, &consumer, &producer, "repo");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer,
                patch: "change".into(),
            },
        ))
        .unwrap();
    assert!(!alice_runs(&h)
        .iter()
        .any(|run| run.task_id == consumer && run.trigger == "graph_review"));
    ingest_session_ok(&h, &occupying_run);
    assert!(alice_runs(&h)
        .iter()
        .any(|run| run.task_id == consumer && run.trigger == "graph_review"));
}

#[test]
fn declared_graph_retries_new_generation_after_completed_run_and_capacity_release() {
    let h = setup();
    update_agent_cli_and_limit(&h.kernel, &h.alice, &h.a1, None, Some(1));
    set_conductor(&h, &h.a2);
    let producer = issue_title(&h, "generation producer");
    let consumer = issue_title(&h, "generation consumer");
    bind_demo_repo(&h);
    create_worktree(&h, &producer);
    let dep_id = declare_dep(&h, &consumer, &producer, "repo");
    assign_a1(&h, &producer);
    assign_a1(&h, &consumer);

    let producer_run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == producer && run.status == "running")
        .expect("producer run");
    ingest_session_ok(&h, &producer_run.id);
    let first_consumer = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == consumer && run.status == "running")
        .expect("first consumer generation");
    ingest_session_ok(&h, &first_consumer.id);

    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer.clone(),
                patch: "new producer generation".into(),
            },
        ))
        .unwrap();
    let review = alice_runs(&h)
        .into_iter()
        .find(|run| {
            run.task_id == consumer && run.trigger == "graph_review" && run.status == "running"
        })
        .expect("generation review");

    let occupying = issue_title(&h, "capacity holder");
    assign_a1(&h, &occupying);
    let occupying_run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == occupying && run.status == "running")
        .expect("capacity holder run");
    ingest_assistant(&h, &review.id, &format!("REAFFIRM: {dep_id}"));
    assert!(h
        .kernel
        .export_world()
        .node_attempts
        .iter()
        .any(|attempt| { attempt.node_id == consumer && attempt.lease_status == "paused" }));
    assert_eq!(
        alice_runs(&h)
            .iter()
            .filter(|run| run.task_id == consumer)
            .count(),
        2,
        "review must not count as a new executor generation"
    );

    ingest_session_ok(&h, &occupying_run.id);
    let consumer_runs: Vec<_> = alice_runs(&h)
        .into_iter()
        .filter(|run| run.task_id == consumer && run.trigger == "graph")
        .collect();
    assert_eq!(consumer_runs.len(), 2);
    assert!(consumer_runs
        .iter()
        .any(|run| run.id != first_consumer.id && run.status == "running"));
    let fingerprints: std::collections::HashSet<_> = h
        .kernel
        .export_world()
        .node_attempts
        .into_iter()
        .filter(|attempt| attempt.node_id == consumer)
        .map(|attempt| attempt.input_fingerprint)
        .collect();
    assert_eq!(
        fingerprints.len(),
        2,
        "new edge generation needs a new attempt"
    );
}

#[test]
fn conductor_blocker_release_reconciles_stale_squad_task() {
    let h = setup();
    set_conductor(&h, &h.a2);
    let squad_id = h
        .kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::CreateSquad {
                workspace_id: h.workspace_id.clone(),
                name: "team".into(),
                leader_agent_id: h.a1.clone(),
            },
        ))
        .unwrap()
        .ids["squad_id"]
        .as_str()
        .unwrap()
        .to_string();
    let blocker = issue_title(&h, "blocker");
    let producer = issue_title(&h, "producer");
    let consumer = issue_title(&h, "squad consumer");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::AddIssueBlocker {
                task_id: consumer.clone(),
                blocker_id: blocker.clone(),
            },
        ))
        .unwrap();
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::AssignIssue {
                task_id: consumer.clone(),
                agent_id: None,
                principal_id: None,
                squad_id: Some(squad_id),
                project_id: None,
                parent_id: None,
                stage: None,
            },
        ))
        .unwrap();
    bind_demo_repo(&h);
    create_worktree(&h, &producer);
    declare_dep(&h, &consumer, &producer, "repo");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::ApplyPatch {
                task_id: producer,
                patch: "change".into(),
            },
        ))
        .unwrap();
    assert!(!alice_runs(&h)
        .iter()
        .any(|run| run.task_id == consumer && run.trigger == "graph_review"));
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::SetTaskStatus {
                task_id: blocker,
                status: "done".into(),
            },
        ))
        .unwrap();
    assert!(alice_runs(&h)
        .iter()
        .any(|run| run.task_id == consumer && run.trigger == "graph_review"));
}

#[test]
fn conductor_reconcile_respects_action_conflict_and_compaction_drift_blocks() {
    let action = setup();
    let action_task = issue_title(&action, "action blocked");
    assign_a1(&action, &action_task);
    action
        .kernel
        .submit_sync(cmd(
            alice_actor(&action),
            Command::UpsertCommitment {
                workspace_id: action.workspace_id.clone(),
                task_id: Some(action_task.clone()),
                commitment_type: "CONSTRAINT".into(),
                claim: "never-deploy".into(),
                polarity: "MUST_NOT".into(),
                authority: "USER".into(),
                scope: action_task.clone(),
            },
        ))
        .unwrap();
    let blocked = action
        .kernel
        .submit_sync(cmd(
            alice_actor(&action),
            Command::ApplyPatch {
                task_id: action_task.clone(),
                patch: "never-deploy".into(),
            },
        ))
        .unwrap();
    assert!(blocked.blocked);
    set_conductor(&action, &action.a2);
    assert!(!alice_runs(&action)
        .iter()
        .any(|run| run.task_id == action_task && run.trigger == "graph"));

    let drift = setup();
    let drift_task = issue_title(&drift, "drift blocked");
    assign_a1(&drift, &drift_task);
    drift
        .kernel
        .submit_sync(cmd(
            alice_actor(&drift),
            Command::UpsertCommitment {
                workspace_id: drift.workspace_id.clone(),
                task_id: Some(drift_task.clone()),
                commitment_type: "CONSTRAINT".into(),
                claim: "never-deploy-without-approval".into(),
                polarity: "MUST_NOT".into(),
                authority: "USER".into(),
                scope: drift_task.clone(),
            },
        ))
        .unwrap();
    start_fixture(
        &drift,
        &drift_task,
        vec![
            HarnessEvent::Message {
                role: "user".into(),
                content: "GOAL: preserve-release-gate\nCONSTRAINT: never-deploy-without-approval"
                    .into(),
            },
            HarnessEvent::Compaction {
                summary: "lost state".into(),
            },
            HarnessEvent::Message {
                role: "assistant".into(),
                content: "PLAN: ship directly to production".into(),
            },
        ],
    );
    let producer = issue_title(&drift, "producer");
    bind_demo_repo(&drift);
    create_worktree(&drift, &producer);
    declare_dep(&drift, &drift_task, &producer, "repo");
    drift
        .kernel
        .submit_sync(cmd(
            alice_actor(&drift),
            Command::ApplyPatch {
                task_id: producer,
                patch: "change".into(),
            },
        ))
        .unwrap();
    set_conductor(&drift, &drift.a2);
    assert!(!alice_runs(&drift).iter().any(|run| {
        run.task_id == drift_task && matches!(run.trigger.as_str(), "graph" | "graph_review")
    }));
}

#[test]
fn conductor_reconcile_does_not_restart_completed_manual_or_squad_work() {
    let h = setup();
    let manual_task = issue_title(&h, "manual completed");
    assign_a1(&h, &manual_task);
    start_fixture(
        &h,
        &manual_task,
        vec![HarnessEvent::Message {
            role: "assistant".into(),
            content: "done".into(),
        }],
    );
    set_conductor(&h, &h.a2);
    assert_eq!(
        alice_runs(&h)
            .iter()
            .filter(|run| run.task_id == manual_task)
            .count(),
        1
    );

    let squad_id = h
        .kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::CreateSquad {
                workspace_id: h.workspace_id.clone(),
                name: "completion team".into(),
                leader_agent_id: h.a1.clone(),
            },
        ))
        .unwrap()
        .ids["squad_id"]
        .as_str()
        .unwrap()
        .to_string();
    let squad_task = issue_title(&h, "squad completed");
    h.kernel
        .submit_sync(cmd(
            alice_actor(&h),
            Command::AssignIssue {
                task_id: squad_task.clone(),
                agent_id: None,
                principal_id: None,
                squad_id: Some(squad_id),
                project_id: None,
                parent_id: None,
                stage: None,
            },
        ))
        .unwrap();
    let squad_run = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == squad_task && run.trigger == "squad")
        .expect("squad run");
    ingest_session_ok(&h, &squad_run.id);
    assert_eq!(
        alice_runs(&h)
            .iter()
            .filter(|run| run.task_id == squad_task && run.trigger == "squad")
            .count(),
        1
    );
}

#[test]
fn completed_review_reconciles_waiting_reviews_and_reaffirmed_execution() {
    let h = setup();
    update_agent_cli_and_limit(&h.kernel, &h.alice, &h.a2, None, Some(1));
    set_conductor(&h, &h.a2);

    let producer_a = issue_title(&h, "producer a");
    let consumer_a = issue_title(&h, "consumer a");
    let producer_b = issue_title(&h, "producer b");
    let consumer_b = issue_title(&h, "consumer b");
    bind_demo_repo(&h);
    create_worktree(&h, &producer_a);
    create_worktree(&h, &producer_b);
    declare_dep(&h, &consumer_a, &producer_a, "repo");
    declare_dep(&h, &consumer_b, &producer_b, "repo");
    for (task_id, patch) in [(&producer_a, "change a"), (&producer_b, "change b")] {
        h.kernel
            .submit_sync(cmd(
                alice_actor(&h),
                Command::ApplyPatch {
                    task_id: task_id.clone(),
                    patch: patch.into(),
                },
            ))
            .unwrap();
    }
    let first_review = alice_runs(&h)
        .into_iter()
        .find(|run| run.task_id == consumer_a && run.trigger == "graph_review")
        .expect("first review");
    assert!(!alice_runs(&h)
        .iter()
        .any(|run| run.task_id == consumer_b && run.trigger == "graph_review"));
    ingest_session_ok(&h, &first_review.id);
    assert!(alice_runs(&h)
        .iter()
        .any(|run| run.task_id == consumer_b && run.trigger == "graph_review"));

    let same_agent = setup();
    update_agent_cli_and_limit(
        &same_agent.kernel,
        &same_agent.alice,
        &same_agent.a1,
        None,
        Some(1),
    );
    let producer = issue_title(&same_agent, "producer same agent");
    let consumer = issue_title(&same_agent, "consumer same agent");
    bind_demo_repo(&same_agent);
    create_worktree(&same_agent, &producer);
    let dep_id = declare_dep(&same_agent, &consumer, &producer, "repo");
    assign_a1(&same_agent, &consumer);
    same_agent
        .kernel
        .submit_sync(cmd(
            alice_actor(&same_agent),
            Command::ApplyPatch {
                task_id: producer.clone(),
                patch: "change".into(),
            },
        ))
        .unwrap();
    set_conductor(&same_agent, &same_agent.a1);
    let review = alice_runs(&same_agent)
        .into_iter()
        .find(|run| run.task_id == consumer && run.trigger == "graph_review")
        .expect("same-agent review");
    ingest_assistant(&same_agent, &review.id, &format!("REAFFIRM: {dep_id}"));
    assert!(!alice_runs(&same_agent)
        .iter()
        .any(|run| run.task_id == consumer && run.trigger == "graph"));
    same_agent
        .kernel
        .submit_sync(cmd(
            alice_actor(&same_agent),
            Command::SetTaskStatus {
                task_id: producer,
                status: "done".into(),
            },
        ))
        .unwrap();
    assert!(!alice_runs(&same_agent)
        .iter()
        .any(|run| run.task_id == consumer && run.trigger == "graph"));
    ingest_session_ok(&same_agent, &review.id);
    assert!(alice_runs(&same_agent)
        .iter()
        .any(|run| run.task_id == consumer && run.trigger == "graph"));
}
fn pr_item(
    number: u32,
    branch: &str,
    title: &str,
    body: &str,
    state: &str,
) -> GithubPullRequestItem {
    GithubPullRequestItem {
        number,
        url: format!("https://github.com/acme/app/pull/{number}"),
        title: title.into(),
        state: state.into(),
        repo: "acme/app".into(),
        branch: branch.into(),
        author: "dev".into(),
        body: body.into(),
        additions: 4,
        deletions: 1,
        changed_files: 2,
        mergeable: "mergeable".into(),
        merge_state: "clean".into(),
        checks_rollup: "success".into(),
        checks_total: 3,
        checks_passed: 3,
        checks_failed: 0,
        checks_running: 0,
        failed_check_names: Vec::new(),
        snapshot_available: true,
    }
}

#[test]
fn github_auto_link_attaches_ci_snapshot() {
    let h = setup();
    let created = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::CreateTask {
                workspace_id: h.workspace_id.clone(),
                title: "登录跳转".into(),
                description: String::new(),
            },
        ))
        .unwrap();
    let task_id = created.ids["task_id"].as_str().unwrap().to_string();
    h.kernel
        .submit_sync(cmd(
            Actor::Daemon,
            Command::SyncGithubPullRequests(Box::new(GithubSync {
                workspace_id: h.workspace_id.clone(),
                cli_available: true,
                authenticated: true,
                account: "dev".into(),
                error: String::new(),
                fetched_at: "2026-08-19T00:00:00Z".into(),
                items: vec![pr_item(
                    41,
                    "coor-1-fix-login",
                    "COOR-1 fix login",
                    "notes",
                    "open",
                )],
            })),
        ))
        .unwrap();
    let board = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Board {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    let View::Board { tasks } = board else {
        panic!("board");
    };
    let task = tasks.iter().find(|row| row.id == task_id).unwrap();
    assert_eq!(task.pull_requests.len(), 1);
    let pr = &task.pull_requests[0];
    assert_eq!(pr.number, 41);
    assert_eq!(pr.state, "open");
    assert_eq!(pr.checks_rollup, "success");
    assert_eq!(pr.checks_passed, 3);
    assert_eq!(pr.merge_state, "clean");
    assert_eq!(pr.linked_by, "auto");
    let settings = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Settings {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    let View::Settings { github, .. } = settings else {
        panic!("settings");
    };
    assert!(github.cli_available);
    assert!(github.authenticated);
    assert_eq!(github.account, "dev");
}

#[test]
fn github_merged_close_intent_completes_issue() {
    let h = setup();
    let created = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::CreateTask {
                workspace_id: h.workspace_id.clone(),
                title: "完成登录".into(),
                description: String::new(),
            },
        ))
        .unwrap();
    let task_id = created.ids["task_id"].as_str().unwrap().to_string();
    h.kernel
        .submit_sync(cmd(
            Actor::Daemon,
            Command::SyncGithubPullRequests(Box::new(GithubSync {
                workspace_id: h.workspace_id.clone(),
                cli_available: true,
                authenticated: true,
                account: "dev".into(),
                error: String::new(),
                fetched_at: String::new(),
                items: vec![pr_item(9, "feat", "login", "Closes COOR-1", "merged")],
            })),
        ))
        .unwrap();
    let board = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Board {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    let View::Board { tasks } = board else {
        panic!("board");
    };
    let task = tasks.iter().find(|row| row.id == task_id).unwrap();
    assert_eq!(task.status, "done");
    assert!(task.pull_requests[0].close_intent);
}

#[test]
fn github_related_to_does_not_link_or_complete() {
    let h = setup();
    let created = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::CreateTask {
                workspace_id: h.workspace_id.clone(),
                title: "旁路".into(),
                description: String::new(),
            },
        ))
        .unwrap();
    let task_id = created.ids["task_id"].as_str().unwrap().to_string();
    h.kernel
        .submit_sync(cmd(
            Actor::Daemon,
            Command::SyncGithubPullRequests(Box::new(GithubSync {
                workspace_id: h.workspace_id.clone(),
                cli_available: true,
                authenticated: true,
                error: String::new(),
                account: "dev".into(),
                fetched_at: String::new(),
                items: vec![pr_item(
                    3,
                    "other",
                    "unrelated",
                    "Related to COOR-1",
                    "merged",
                )],
            })),
        ))
        .unwrap();
    let board = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Board {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    let View::Board { tasks } = board else {
        panic!("board");
    };
    let task = tasks.iter().find(|row| row.id == task_id).unwrap();
    assert!(task.pull_requests.is_empty());
    assert_eq!(task.status, "open");
}

#[test]
fn github_sync_error_keeps_auto_links_and_marks_stale() {
    let h = setup();
    let task_id = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::CreateTask {
                workspace_id: h.workspace_id.clone(),
                title: "登录跳转".into(),
                description: String::new(),
            },
        ))
        .unwrap()
        .ids["task_id"]
        .as_str()
        .unwrap()
        .to_string();
    h.kernel
        .submit_sync(cmd(
            Actor::Daemon,
            Command::SyncGithubPullRequests(Box::new(GithubSync {
                workspace_id: h.workspace_id.clone(),
                cli_available: true,
                authenticated: true,
                account: "dev".into(),
                error: String::new(),
                fetched_at: "2026-08-19T00:00:00Z".into(),
                items: vec![pr_item(
                    41,
                    "coor-1-fix-login",
                    "COOR-1 fix login",
                    "notes",
                    "open",
                )],
            })),
        ))
        .unwrap();
    h.kernel
        .submit_sync(cmd(
            Actor::Daemon,
            Command::SyncGithubPullRequests(Box::new(GithubSync {
                workspace_id: h.workspace_id.clone(),
                cli_available: true,
                authenticated: true,
                account: "dev".into(),
                error: "尚未绑定代码仓库。".into(),
                fetched_at: "2026-08-19T00:01:00Z".into(),
                items: Vec::new(),
            })),
        ))
        .unwrap();
    let board = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Board {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    let View::Board { tasks } = board else {
        panic!("board");
    };
    let task = tasks.iter().find(|row| row.id == task_id).unwrap();
    let pr = &task.pull_requests[0];
    assert_eq!(pr.number, 41);
    assert!(pr.snapshot_stale);
    let settings = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Settings {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    let View::Settings { github, .. } = settings else {
        panic!("settings");
    };
    assert_eq!(github.last_error, "尚未绑定代码仓库。");
}

#[test]
fn github_refresh_without_daemon_is_unavailable() {
    let h = setup();
    let err = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::RefreshGithub {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap_err();
    assert_eq!(err.code, "unavailable");
}

#[test]
fn github_sync_rejects_member_forged_snapshots() {
    let h = setup();
    let task_id = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::CreateTask {
                workspace_id: h.workspace_id.clone(),
                title: "不能由客户端伪造完成".into(),
                description: String::new(),
            },
        ))
        .unwrap()
        .ids["task_id"]
        .as_str()
        .unwrap()
        .to_string();

    let error = h
        .kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::SyncGithubPullRequests(Box::new(GithubSync {
                workspace_id: h.workspace_id.clone(),
                cli_available: true,
                authenticated: true,
                account: "forged".into(),
                error: String::new(),
                fetched_at: "2026-08-19T00:00:00Z".into(),
                items: vec![pr_item(99, "other", "unrelated", "Closes COOR-1", "merged")],
            })),
        ))
        .unwrap_err();
    assert_eq!(error.code, "denied");

    let board = h
        .kernel
        .view_sync(q(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Query::Board {
                workspace_id: h.workspace_id.clone(),
            },
        ))
        .unwrap();
    let View::Board { tasks } = board else {
        panic!("board");
    };
    let task = tasks.iter().find(|row| row.id == task_id).unwrap();
    assert_eq!(task.status, "open");
    assert!(task.pull_requests.is_empty());
}
