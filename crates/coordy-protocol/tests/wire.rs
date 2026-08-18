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
    };
    let value = serde_json::to_value(view).unwrap();
    assert_eq!(value["type"], "Settings");
    assert_eq!(value["llm_advisor_enabled"], json!(false));
}
