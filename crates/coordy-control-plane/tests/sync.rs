use coordy_control_plane::SharedState;
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
