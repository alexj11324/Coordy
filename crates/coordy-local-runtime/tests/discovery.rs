use coordy_local_runtime::Runtime;
use coordy_protocol::{Actor, AuthenticatedCommand, AuthorizedQuery, Command, Query, View};

fn unique_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "coordy-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn seed_registry(data_dir: &std::path::Path, body: &str) {
    let cache = data_dir.join("cache");
    std::fs::create_dir_all(&cache).unwrap();
    std::fs::write(cache.join("acp-registry.json"), body).unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    std::fs::write(cache.join("acp-registry.fetched"), now.to_string()).unwrap();
}

#[tokio::test]
async fn explicit_import_rejects_registry_agent_without_path_install() {
    let dir = unique_dir("discover-import");
    seed_registry(
        &dir,
        r#"{"agents":[{"id":"made-up-acp","name":"Made Up","distribution":{"npx":{"package":"made-up-acp@1.0.0","args":["--acp"]}}}]}"#,
    );
    let sock = dir.join("unused.sock");
    let rt = Runtime::open(&dir, &sock, "tok".into()).unwrap();
    let workspace_id = rt
        .kernel
        .submit_sync(AuthenticatedCommand {
            actor: Actor::Daemon,
            command: Command::CreateWorkspace { name: "ws".into() },
        })
        .unwrap()
        .ids["workspace_id"]
        .as_str()
        .unwrap()
        .to_string();
    let principal_id = rt
        .kernel
        .submit_sync(AuthenticatedCommand {
            actor: Actor::Daemon,
            command: Command::CreatePrincipal {
                workspace_id: workspace_id.clone(),
                name: "Owner".into(),
            },
        })
        .unwrap()
        .ids["principal_id"]
        .as_str()
        .unwrap()
        .to_string();
    let imported = coordy_local_runtime::import_agents(
        &rt,
        workspace_id.clone(),
        principal_id,
        Some(vec!["made-up-acp".into()]),
    )
    .await
    .unwrap();
    assert!(imported.imported.is_empty());
    let View::Agents { items } = rt
        .kernel
        .view_sync(AuthorizedQuery {
            actor: Actor::Daemon,
            query: Query::Agents { workspace_id },
        })
        .unwrap()
    else {
        panic!("agents view");
    };
    assert!(!items.iter().any(|agent| agent.harness == "made-up-acp"));
}

#[tokio::test]
async fn rejected_import_keeps_existing_generic_acp_placeholder() {
    let dir = unique_dir("discover-archive");
    seed_registry(
        &dir,
        r#"{"agents":[{"id":"made-up-acp","name":"Made Up","distribution":{"npx":{"package":"made-up-acp@1.0.0","args":["--acp"]}}}]}"#,
    );
    let sock = dir.join("unused.sock");
    let rt = Runtime::open(&dir, &sock, "tok".into()).unwrap();
    let workspace_id = rt
        .kernel
        .submit_sync(AuthenticatedCommand {
            actor: Actor::Daemon,
            command: Command::CreateWorkspace { name: "ws".into() },
        })
        .unwrap()
        .ids["workspace_id"]
        .as_str()
        .unwrap()
        .to_string();
    let principal_id = rt
        .kernel
        .submit_sync(AuthenticatedCommand {
            actor: Actor::Daemon,
            command: Command::CreatePrincipal {
                workspace_id: workspace_id.clone(),
                name: "Owner".into(),
            },
        })
        .unwrap()
        .ids["principal_id"]
        .as_str()
        .unwrap()
        .to_string();
    rt.kernel
        .submit_sync(AuthenticatedCommand {
            actor: Actor::Daemon,
            command: Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: principal_id.clone(),
                name: "助手".into(),
                harness: "acp".into(),
            },
        })
        .unwrap();
    coordy_local_runtime::import_agents(
        &rt,
        workspace_id.clone(),
        principal_id,
        Some(vec!["made-up-acp".into()]),
    )
    .await
    .unwrap();
    let View::Agents { items } = rt
        .kernel
        .view_sync(AuthorizedQuery {
            actor: Actor::Daemon,
            query: Query::Agents { workspace_id },
        })
        .unwrap()
    else {
        panic!("agents view");
    };
    assert!(items.iter().any(|agent| agent.harness == "acp"));
    assert!(!items.iter().any(|agent| agent.harness == "made-up-acp"));
}
