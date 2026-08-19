use std::sync::Arc;

use coordy_local_runtime::{generate_token, serve, RpcClient, Runtime};
use coordy_protocol::{Actor, AuthorizedQuery, Query};
use tokio::net::UnixStream;

#[tokio::test]
async fn ipc_roundtrip_health() {
    let dir = std::env::temp_dir().join(format!("coordy-ipc-{}", uuid_like()));
    std::fs::create_dir_all(&dir).unwrap();
    let sock = dir.join("coordyd.sock");
    let token = generate_token();
    let runtime = Arc::new(Runtime::open(&dir, &sock, token.clone()).unwrap());
    let server = tokio::spawn(async move {
        let _ = serve(runtime).await;
    });
    for _ in 0..50 {
        if UnixStream::connect(&sock).await.is_ok() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    let mut client = RpcClient::connect(&sock, &token).await.unwrap();
    let health = client.health().await.unwrap();
    assert!(health.ok);
    let view = client
        .view(AuthorizedQuery {
            actor: Actor::Daemon,
            query: Query::Health,
        })
        .await
        .unwrap();
    assert!(view.ok);
    let secrets = client
        .request(coordy_protocol::RpcRequest::SetSecret {
            id: "secret-1".into(),
            provider: "openai".into(),
            api_key: Some("sk-ipc-only".into()),
            base_url: None,
            acp_command: Some("codex acp".into()),
        })
        .await
        .unwrap();
    assert!(secrets.ok);
    let status = secrets.result.expect("secret status");
    assert_eq!(status["key_configured"], true);
    assert_eq!(status["acp_command"], "codex acp");
    assert!(!status.to_string().contains("sk-ipc-only"));
    server.abort();
}

fn uuid_like() -> String {
    format!("{}", std::process::id())
}

#[test]
fn sqlite_crash_replay() {
    let dir = std::env::temp_dir().join(format!("coordy-db-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let sock = dir.join("unused.sock");
    let rt = Runtime::open(&dir, &sock, "tok".into()).unwrap();
    rt.kernel
        .submit_sync(coordy_protocol::AuthenticatedCommand {
            actor: Actor::Daemon,
            command: coordy_protocol::Command::CreateWorkspace {
                name: "persisted".into(),
            },
        })
        .unwrap();
    rt.persist().unwrap();
    let rt2 = Runtime::open(&dir, &sock, "tok".into()).unwrap();
    let world = rt2.kernel.export_world();
    assert_eq!(world.workspaces.len(), 1);
}

#[test]
fn persist_failure_does_not_ack_and_rolls_back() {
    let dir = std::env::temp_dir().join(format!("coordy-persist-fail-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let sock = dir.join("unused.sock");
    let rt = Runtime::open(&dir, &sock, "tok".into()).unwrap();
    rt.submit_and_persist(coordy_protocol::AuthenticatedCommand {
        actor: Actor::Daemon,
        command: coordy_protocol::Command::CreateWorkspace {
            name: "kept".into(),
        },
    })
    .unwrap();
    assert_eq!(rt.kernel.export_world().workspaces.len(), 1);

    let db = dir.join("coordy.sqlite");
    std::fs::remove_file(&db).unwrap();
    std::fs::create_dir(&db).unwrap();

    let err = rt
        .submit_and_persist(coordy_protocol::AuthenticatedCommand {
            actor: Actor::Daemon,
            command: coordy_protocol::Command::CreateWorkspace {
                name: "lost".into(),
            },
        })
        .unwrap_err();
    assert_eq!(err.code, "unavailable");
    let world = rt.kernel.export_world();
    assert_eq!(world.workspaces.len(), 1);
    assert_eq!(world.workspaces[0].name, "kept");
}

#[test]
fn cli_resolves_desktop_socket_pointer() {
    let dir = std::env::temp_dir().join(format!("coordy-sock-ptr-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let desktop_sock = dir.join("userData").join("run").join("coordyd.sock");
    coordy_local_runtime::write_active_socket(&dir, &desktop_sock).unwrap();
    let resolved = coordy_local_runtime::resolve_cli_socket(None, &dir, dir.join("default.sock"));
    assert_eq!(resolved, desktop_sock);
    let explicit = coordy_local_runtime::resolve_cli_socket(
        Some(dir.join("explicit.sock")),
        &dir,
        dir.join("default.sock"),
    );
    assert_eq!(explicit, dir.join("explicit.sock"));
}
