use coordy_advisor::DeterministicAdvisor;
use coordy_kernel::{
    parse_sync_projection, sync_batch, sync_omits_private_memory, Kernel, RecordingPorts,
};
use coordy_protocol::{
    Actor, AuthenticatedCommand, AuthorizedQuery, Command, GraphEdgeKind, GraphEdgeState,
    HarnessEvent, NodeKind, Query, RunSource, View, STALE_DEPENDENCY_REASON,
};

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
    let kernel = Kernel::default_in_process();
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
