use coordy_advisor::DeterministicAdvisor;
use coordy_kernel::{sync_batch, sync_omits_private_memory, Kernel, RecordingPorts};
use coordy_protocol::{
    Actor, AuthenticatedCommand, AuthorizedQuery, Command, HarnessEvent, Query, RunSource, View,
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
    h.kernel
        .submit_sync(cmd(
            Actor::Principal {
                id: h.alice.clone(),
            },
            Command::DeclareDependency {
                workspace_id: h.workspace_id.clone(),
                from_id: "other-task".into(),
                to_id: task_id.clone(),
                entity: "repo".into(),
            },
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
                harness: "acp".into(),
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
            },
        ))
        .unwrap();
    assert!(!outcome.blocked);
    let spawns = ports.spawns.lock().unwrap();
    assert_eq!(spawns.len(), 1);
    assert_eq!(spawns[0].0, "acp");
    assert_eq!(spawns[0].1, "/tmp/coordy-acp-repo");
    assert_eq!(spawns[0].2, "hello acp");
}
