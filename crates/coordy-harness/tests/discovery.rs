use std::sync::Mutex;

use coordy_harness::{discover, spawn_native_session, SecretEnv};
use coordy_protocol::HarnessEvent;

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
    assert!(
        found.iter().all(|a| a.id != "claude-acp"),
        "registry claude-acp must not appear as its own catalog id"
    );
    let claude = found.iter().find(|a| a.id == "claude").expect("claude");
    assert!(claude.installed);
    assert_eq!(claude.source, "path");
    assert_eq!(claude.protocol_family, "claude");
    assert!(claude.command.contains("claude"));
    assert!(claude.command.contains("stream-json"));
    assert!(claude.command.contains("-p"));
    assert!(!claude.command.contains("npx"));
    assert!(!claude.command.contains("bypassPermissions"));
    assert!(!claude.command.contains("--permission-mode"));
    assert!(
        !claude
            .command
            .split_whitespace()
            .any(|part| part == "acp" || part == "--acp"),
        "native Claude launch must not use ACP flags: {}",
        claude.command
    );
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
    assert_eq!(agent.protocol_family, "acp");
}

#[test]
fn unknown_runtime_id_fails_closed() {
    let err = coordy_harness::resolve_launch("definitely-missing-runtime", None, None).unwrap_err();
    assert_eq!(err.code, "unavailable");
    assert!(err.message.contains("definitely-missing-runtime"));
}

#[test]
fn uninstalled_builtins_keep_native_flags() {
    let found = discover(None);
    let claude = found
        .iter()
        .find(|a| a.id == "claude")
        .expect("claude catalog");
    assert_eq!(claude.protocol_family, "claude");
    assert!(claude.command.contains("-p"));
    assert!(claude.command.contains("stream-json"));
    assert!(!claude.command.contains("bypassPermissions"));
    assert!(!claude.command.contains("--permission-mode"));
    assert!(
        !claude
            .command
            .split_whitespace()
            .any(|part| part == "acp" || part == "--acp"),
        "{}",
        claude.command
    );
}

#[test]
fn spawn_native_session_accepts_legacy_claude_acp_id() {
    let _guard = PATH_LOCK.lock().unwrap();
    let dir = std::env::temp_dir().join(format!(
        "coordy-native-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let fake = dir.join("claude");
    std::fs::write(
        &fake,
        r#"#!/bin/sh
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"from-cli"}]}}'
"#,
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let original = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", format!("{}:{original}", dir.display()));
    let mut events = Vec::new();
    let result = spawn_native_session(
        "claude-acp",
        dir.to_str().unwrap(),
        "hello",
        "",
        "",
        "",
        "",
        "auto",
        &SecretEnv::default(),
        None,
        |event| events.push(event),
    );
    std::env::set_var("PATH", original);
    result.expect("spawn native claude");
    assert!(
        events.iter().any(|event| matches!(
            event,
            HarnessEvent::Message { content, .. } if content.contains("from-cli")
        )),
        "{events:?}"
    );
}
