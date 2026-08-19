use coordy_control_plane::{SharedState, SyncPush};
use coordy_kernel::Kernel;
use coordy_protocol::{Actor, AuthenticatedCommand, Command};

#[test]
fn private_memory_rejected_from_world_sync_filter() {
    let k = Kernel::default_in_process();
    k.submit_sync(AuthenticatedCommand {
        actor: Actor::Daemon,
        command: Command::CreateWorkspace { name: "w".into() },
    })
    .unwrap();
    let world = k.export_world();
    let state = SharedState::default();
    let batch = state.admit(&world, "ws", "pr").unwrap();
    assert!(batch.get("published_memory").is_some());
    assert_eq!(state.members("ws"), vec!["pr".to_string()]);
}

#[test]
fn projection_with_principal_memory_is_rejected() {
    let state = SharedState::default();
    let err = state
        .push_sync(SyncPush {
            workspace_id: "ws".into(),
            principal_id: "pr".into(),
            batch: serde_json::json!({
                "published_memory": [{
                    "visibility": "principal",
                    "status": "shared",
                    "body": "secret"
                }]
            }),
        })
        .unwrap_err();
    assert_eq!(err.code, "denied");
    assert!(state.snapshot("ws").is_none());
}

#[test]
fn shared_projection_is_stored() {
    let state = SharedState::default();
    state
        .push_sync(SyncPush {
            workspace_id: "ws".into(),
            principal_id: "pr".into(),
            batch: serde_json::json!({
                "contracts": [],
                "published_memory": [{
                    "visibility": "shared",
                    "status": "shared",
                    "body": "ok"
                }],
                "tasks": [],
                "conflicts": []
            }),
        })
        .unwrap();
    let stored = state.snapshot("ws").expect("projection stored");
    assert_eq!(stored["published_memory"][0]["body"], "ok");
}

#[test]
fn invalidate_is_audited() {
    let state = SharedState::default();
    state.invalidate(coordy_control_plane::InvalidateReq {
        workspace_id: "ws".into(),
        entity: "repo".into(),
        reason: "contract drifted".into(),
    });
    assert_eq!(state.invalidations().len(), 1);
    assert!(state
        .audit()
        .iter()
        .any(|row| row["action"] == "invalidate"));
}
