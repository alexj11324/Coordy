use serde_json::json;

#[test]
fn actor_wire_is_snake_case() {
    let value = serde_json::to_value(coordy_protocol::Actor::Daemon).unwrap();
    assert_eq!(value["type"], "daemon");
}

#[test]
fn command_wire_keeps_pascal_variant() {
    let value = serde_json::to_value(coordy_protocol::Command::CreateWorkspace {
        name: "local".into(),
    })
    .unwrap();
    assert_eq!(value["type"], "CreateWorkspace");
    assert_eq!(value["name"], "local");
}

#[test]
fn github_sync_command_flattens_boxed_payload() {
    let value = serde_json::to_value(coordy_protocol::Command::SyncGithubPullRequests(Box::new(
        coordy_protocol::GithubSync {
            workspace_id: "ws".into(),
            cli_available: true,
            authenticated: true,
            account: "dev".into(),
            error: String::new(),
            fetched_at: String::new(),
            items: Vec::new(),
        },
    )))
    .unwrap();
    assert_eq!(value["type"], "SyncGithubPullRequests");
    assert_eq!(value["workspace_id"], "ws");
    assert_eq!(value["cli_available"], true);
}

#[test]
fn settings_view_includes_advisor_flag() {
    let view = coordy_protocol::View::Settings {
        daemon: coordy_protocol::HealthView {
            status: "ok".into(),
            version: "0.2.0".into(),
            protocol_version: coordy_protocol::PROTOCOL_VERSION.into(),
            pid: 1,
            workspace_count: 0,
        },
        repo_path: None,
        llm_advisor_enabled: false,
        notification_kinds: Vec::new(),
        github: coordy_protocol::GithubView::default(),
    };
    let value = serde_json::to_value(view).unwrap();
    assert_eq!(value["type"], "Settings");
    assert_eq!(value["llm_advisor_enabled"], json!(false));
}

#[test]
fn create_task_description_defaults_when_omitted() {
    let cmd: coordy_protocol::Command = serde_json::from_value(json!({
        "type": "CreateTask",
        "workspace_id": "ws",
        "title": "look around"
    }))
    .unwrap();
    match cmd {
        coordy_protocol::Command::CreateTask { description, .. } => {
            assert_eq!(description, "");
        }
        other => panic!("expected CreateTask, got {other:?}"),
    }
}

#[test]
fn update_agent_fields_default_when_omitted() {
    let cmd: coordy_protocol::Command = serde_json::from_value(json!({
        "type": "UpdateAgent",
        "agent_id": "ag_1"
    }))
    .unwrap();
    match cmd {
        coordy_protocol::Command::UpdateAgent {
            name,
            description,
            instructions,
            harness,
            ..
        } => {
            assert!(name.is_none());
            assert!(description.is_none());
            assert!(instructions.is_none());
            assert!(harness.is_none());
        }
        other => panic!("expected UpdateAgent, got {other:?}"),
    }
}

#[test]
fn run_source_acp_keeps_pascal_variant() {
    let value = serde_json::to_value(coordy_protocol::RunSource::Acp {
        prompt: "hello".into(),
    })
    .unwrap();
    assert_eq!(value["type"], "Acp");
    assert_eq!(value["prompt"], "hello");
}

#[test]
fn byok_is_local_rpc_not_a_kernel_command() {
    let src = include_str!("../src/lib.rs");
    let command_start = src.find("pub enum Command").expect("Command");
    let command_end = src.find("pub enum RunSource").expect("RunSource");
    let command_body = &src[command_start..command_end];
    assert!(
        !command_body.contains("SetSecret"),
        "API keys must not become kernel Command variants"
    );
    assert!(
        !command_body.contains("api_key"),
        "API keys must not travel on kernel Command"
    );
    let req = serde_json::to_value(coordy_protocol::RpcRequest::SetSecret {
        id: "1".into(),
        provider: "openai".into(),
        api_key: Some("sk-test".into()),
        base_url: None,
        acp_command: Some("codex acp".into()),
    })
    .unwrap();
    assert_eq!(req["type"], "SetSecret");
}

#[test]
fn issue_blocker_command_keeps_pascal_variant() {
    let value = serde_json::to_value(coordy_protocol::Command::AddIssueBlocker {
        task_id: "task_b".into(),
        blocker_id: "task_a".into(),
    })
    .unwrap();
    assert_eq!(value["type"], "AddIssueBlocker");
    assert_eq!(value["task_id"], "task_b");
    assert_eq!(value["blocker_id"], "task_a");
}

#[test]
fn task_view_blocker_fields_default_when_omitted() {
    let view: coordy_protocol::TaskView = serde_json::from_value(json!({
        "id": "task_1",
        "workspace_id": "ws",
        "title": "Ship",
        "status": "open",
        "assignee_agent_id": null,
        "worktree_path": null,
        "blocked_reason": null
    }))
    .unwrap();
    assert!(view.blocker_ids.is_empty());
    assert!(view.blocking_ids.is_empty());
    assert!(view.unresolved_blocker_ids.is_empty());
}
