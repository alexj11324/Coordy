use std::sync::Mutex;

use coordy_harness::discover;

static PATH_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn path_binary_wins_over_registry_npx() {
    let _guard = PATH_LOCK.lock().unwrap();
    let dir = std::env::temp_dir().join(format!(
        "coordy-discover-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let fake = dir.join("claude");
    std::fs::write(&fake, "#!/bin/sh\nexit 0\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let original = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", format!("{}:{original}", dir.display()));
    let registry = r#"{"agents":[{"id":"claude-acp","name":"Claude Agent","distribution":{"npx":{"package":"@agentclientprotocol/claude-agent-acp@9.9.9"}}}]}"#;
    let found = discover(Some(registry));
    std::env::set_var("PATH", original);
    let claude = found.iter().find(|a| a.id == "claude-acp").expect("claude");
    assert!(claude.installed);
    assert_eq!(claude.source, "path");
    assert!(claude.command.contains("claude"));
    assert!(!claude.command.contains("npx"));
}

#[test]
fn registry_npx_is_importable_when_not_installed() {
    let registry = r#"{"agents":[{"id":"made-up-acp","name":"Made Up","distribution":{"npx":{"package":"made-up-acp@1.0.0","args":["--acp"]}}}]}"#;
    let found = discover(Some(registry));
    let agent = found
        .iter()
        .find(|a| a.id == "made-up-acp")
        .expect("registry");
    assert!(!agent.installed);
    assert_eq!(agent.command, "npx -y made-up-acp@1.0.0 --acp");
    assert_eq!(agent.source, "registry");
}

#[test]
fn unknown_runtime_id_fails_closed() {
    let err = coordy_harness::resolve_launch("definitely-missing-runtime", None, None).unwrap_err();
    assert_eq!(err.code, "unavailable");
    assert!(err.message.contains("definitely-missing-runtime"));
}
