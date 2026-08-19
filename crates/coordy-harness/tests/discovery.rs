use std::sync::Mutex;

use coordy_harness::{
    discover, extra_bin_dirs, launch_uses_acp, spawn_native_session, which_bin, SecretEnv,
};
use coordy_protocol::{DiscoveredAgentView, HarnessEvent};

static PATH_LOCK: Mutex<()> = Mutex::new(());

#[cfg(unix)]
#[test]
fn path_probe_skips_plain_files_and_accepts_executable_files() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = PATH_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!(
        "coordy-executable-probe-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let plain_dir = root.join("plain");
    let executable_dir = root.join("executable");
    std::fs::create_dir_all(&plain_dir).unwrap();
    std::fs::create_dir_all(&executable_dir).unwrap();
    let name = format!("coordy-probe-{}", std::process::id());
    let plain = plain_dir.join(&name);
    let executable = executable_dir.join(&name);
    std::fs::write(&plain, "not executable").unwrap();
    std::fs::set_permissions(&plain, std::fs::Permissions::from_mode(0o644)).unwrap();
    std::fs::write(&executable, "#!/bin/sh\nexit 0\n").unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();

    let original = std::env::var_os("PATH");
    std::env::set_var("PATH", &plain_dir);
    assert_eq!(
        which_bin(&name),
        None,
        "a plain file must not count as installed"
    );
    std::env::set_var(
        "PATH",
        std::env::join_paths([&plain_dir, &executable_dir]).unwrap(),
    );
    assert_eq!(which_bin(&name), Some(executable));
    match original {
        Some(value) => std::env::set_var("PATH", value),
        None => std::env::remove_var("PATH"),
    }
}

#[test]
fn extra_bin_dirs_include_common_gui_invisible_user_install_locations() {
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .expect("HOME");
    let dirs = extra_bin_dirs();
    for relative in [
        ".local/bin",
        ".cargo/bin",
        ".npm-global/bin",
        ".opencode/bin",
        ".grok/bin",
        ".antigravity/antigravity/bin",
        ".antigravity-ide/antigravity-ide/bin",
        ".bun/bin",
        "Library/pnpm",
        "bin",
    ] {
        assert!(dirs.contains(&home.join(relative)), "missing {relative}");
    }
}

#[test]
fn execution_transport_follows_the_discovered_registry_fallback() {
    let registry_fallback = DiscoveredAgentView {
        id: "opencode".into(),
        name: "OpenCode".into(),
        installed: false,
        launch_state: "on_demand".into(),
        command: "npx -y opencode-acp".into(),
        source: "registry".into(),
        version: None,
        protocol_family: "acp".into(),
    };
    assert!(launch_uses_acp("opencode", &[registry_fallback]));

    let native = DiscoveredAgentView {
        id: "opencode".into(),
        name: "OpenCode".into(),
        installed: true,
        launch_state: "ready".into(),
        command: "/usr/bin/opencode run --format json".into(),
        source: "path".into(),
        version: None,
        protocol_family: "opencode".into(),
    };
    assert!(!launch_uses_acp("opencode", &[native]));
}

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
    assert_eq!(agent.launch_state, "on_demand");
    assert_eq!(agent.command, "npx -y made-up-acp@1.0.0 --acp");
    assert_eq!(agent.source, "registry");
    assert_eq!(agent.protocol_family, "acp");
}

#[test]
fn registry_archive_without_an_installed_binary_is_visible_but_not_launchable() {
    let registry = r#"{"agents":[{"id":"archive-only-agent","name":"Archive Only","distribution":{"binary":{"darwin-aarch64":{"archive":"https://example.invalid/agent.tgz","cmd":"./definitely-not-installed-coordy-agent","args":["acp"]}}}}]}"#;
    let found = discover(Some(registry));
    let agent = found
        .iter()
        .find(|item| item.id == "archive-only-agent")
        .expect("archive entry remains visible");
    assert_eq!(agent.launch_state, "missing");
    assert!(!agent.installed);
    assert_eq!(agent.command, "definitely-not-installed-coordy-agent acp");
}

#[test]
fn requested_multica_runtimes_have_real_launch_contracts() {
    let registry = r#"{"agents":[{"id":"grok-build","name":"Grok Build","distribution":{"npx":{"package":"@xai-official/grok@1.0.6","args":["agent","stdio"]}}}]}"#;
    let found = discover(Some(registry));

    let hermes = found.iter().find(|a| a.id == "hermes").expect("hermes");
    assert_eq!(hermes.protocol_family, "acp");
    assert!(hermes.command.ends_with("hermes acp"));

    let antigravity = found
        .iter()
        .find(|a| a.id == "antigravity")
        .expect("antigravity");
    assert_eq!(antigravity.protocol_family, "antigravity");
    assert!(antigravity.command.ends_with("agy -p"));

    let grok = found.iter().find(|a| a.id == "grok").expect("grok");
    assert_eq!(grok.name, "Grok Build");
    assert_eq!(grok.protocol_family, "acp");
    if grok.installed {
        assert!(grok
            .command
            .contains("--no-auto-update agent --always-approve stdio"));
    } else {
        assert_eq!(grok.launch_state, "on_demand");
        assert_eq!(
            grok.command,
            "npx -y @xai-official/grok@1.0.6 --no-auto-update agent --always-approve stdio"
        );
    }
}

#[test]
fn antigravity_plain_text_streams_and_nonzero_exit_fails() {
    let _guard = PATH_LOCK.lock().unwrap();
    let dir = std::env::temp_dir().join(format!(
        "coordy-antigravity-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let fake = dir.join("agy");
    std::fs::write(
        &fake,
        format!(
            "#!/bin/sh\n[ \"$1 $2 $3 $4 $5 $6\" = \"-p hello --model model-x --print-timeout 24h0m0s\" ] || exit 19\n[ \"$7\" = \"--log-file\" ] || exit 20\n[ -f \"$8\" ] || exit 21\n[ \"$9 ${{10}}\" = \"--add-dir {}\" ] || exit 22\nprintf '%s\\n' \"$*\"\nprintf 'antigravity reply\\n'\n",
            dir.display()
        ),
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
    spawn_native_session(
        "antigravity",
        dir.to_str().unwrap(),
        "hello",
        "model-x",
        "",
        "",
        "",
        "auto",
        &SecretEnv::default(),
        None,
        |event| events.push(event),
    )
    .expect("antigravity success");
    let text = format!("{events:?}");
    assert!(text.contains("-p hello --model model-x"), "{text}");
    assert!(text.contains("--print-timeout 24h0m0s"), "{text}");
    assert!(text.contains("--log-file"), "{text}");
    assert!(text.contains("--add-dir"), "{text}");
    assert!(text.contains("antigravity reply"), "{text}");

    std::fs::write(
        &fake,
        "#!/bin/sh\nprintf 'E agent executor error: upstream denied\\n' > \"$6\"\necho misleading-success\nexit 0\n",
    )
    .unwrap();
    let provider_error = spawn_native_session(
        "antigravity",
        dir.to_str().unwrap(),
        "hello",
        "",
        "",
        "",
        "",
        "auto",
        &SecretEnv::default(),
        None,
        |_| {},
    )
    .expect_err("provider error in Antigravity log must fail despite exit 0");
    assert!(
        provider_error.message.contains("upstream denied"),
        "{}",
        provider_error.message
    );

    std::fs::write(&fake, "#!/bin/sh\necho boom >&2\nexit 7\n").unwrap();
    let err = spawn_native_session(
        "antigravity",
        dir.to_str().unwrap(),
        "hello",
        "",
        "",
        "",
        "",
        "auto",
        &SecretEnv::default(),
        None,
        |_| {},
    )
    .unwrap_err();
    assert!(err.message.contains("exited"));
    assert!(err.message.contains("boom"));

    std::fs::write(&fake, "#!/bin/sh\nexit 0\n").unwrap();
    let empty = spawn_native_session(
        "antigravity",
        dir.to_str().unwrap(),
        "hello",
        "",
        "",
        "",
        "",
        "auto",
        &SecretEnv::default(),
        None,
        |_| {},
    )
    .expect_err("empty Antigravity output must fail");
    std::env::set_var("PATH", original);
    assert!(empty.message.contains("no valid"), "{}", empty.message);
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
echo '{"type":"result","subtype":"success"}'
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
        "--session-id benign",
        "auto",
        &SecretEnv::default(),
        None,
        |event| events.push(event),
    );
    let denied = spawn_native_session(
        "claude",
        dir.to_str().unwrap(),
        "hello",
        "",
        "",
        "",
        "--dangerously-skip-permissions",
        "auto",
        &SecretEnv::default(),
        None,
        |_| {},
    )
    .unwrap_err();
    std::env::set_var("PATH", original);
    result.expect("spawn native claude");
    assert_eq!(denied.code, "invalid");
    assert!(denied.message.contains("tool_access is auto"));
    assert!(
        events.iter().any(|event| matches!(
            event,
            HarnessEvent::Message { content, .. } if content.contains("from-cli")
        )),
        "{events:?}"
    );
}

#[test]
fn codex_auto_spawn_rejects_attached_access_and_scope_overrides() {
    let _guard = PATH_LOCK.lock().unwrap();
    let dir = std::env::temp_dir().join(format!(
        "coordy-native-codex-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let fake = dir.join("codex");
    std::fs::write(
        &fake,
        r#"#!/bin/sh
[ "$1" = "app-server" ] || exit 19
[ "$2" = "--listen" ] || exit 19
[ "$3" = "stdio://" ] || exit 19
read initialize
echo '{"jsonrpc":"2.0","id":1,"result":{}}'
read initialized
read thread
case "$thread" in *'"sandbox":"workspace-write"'*) ;; *) exit 20 ;; esac
case "$thread" in *'"approvalPolicy":"never"'*) ;; *) exit 20 ;; esac
echo '{"jsonrpc":"2.0","id":2,"result":{"thread":{"id":"thread-1"}}}'
read turn
echo '{"jsonrpc":"2.0","id":3,"result":{"turn":{"id":"turn-1","status":"inProgress","items":[]}}}'
echo '{"jsonrpc":"2.0","method":"item/commandExecution/requestApproval","id":99,"params":{}}'
read approval
case "$approval" in *'"decision":"decline"'*) ;; *) exit 21 ;; esac
echo '{"jsonrpc":"2.0","method":"item/agentMessage/delta","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"item-1","delta":"from-codex"}}'
echo '{"jsonrpc":"2.0","method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"completed","items":[]}}}'
sleep 30
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
    let benign = spawn_native_session(
        "codex",
        dir.to_str().unwrap(),
        "hello",
        "",
        "",
        "",
        "-cservice_tier=fast",
        "auto",
        &SecretEnv::default(),
        None,
        |event| events.push(event),
    );
    for cli_args in [
        "-s=danger-full-access",
        "-capproval_policy=never",
        "-C/tmp/outside",
        "--add-dir=/tmp/outside",
        "--profile=unsafe",
    ] {
        let denied = spawn_native_session(
            "codex",
            dir.to_str().unwrap(),
            "hello",
            "",
            "",
            "",
            cli_args,
            "auto",
            &SecretEnv::default(),
            None,
            |_| {},
        )
        .unwrap_err();
        assert_eq!(denied.code, "invalid", "{cli_args}");
        assert!(denied.message.contains("tool_access is auto"), "{cli_args}");
    }
    benign.expect("spawn native codex with benign attached config");
    assert!(
        events.iter().any(|event| matches!(
            event,
            HarnessEvent::Message { content, .. } if content.contains("from-codex")
        )),
        "{events:?}"
    );

    std::fs::write(&fake, "#!/bin/sh\nread _\necho not-json\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let malformed = spawn_native_session(
        "codex",
        dir.to_str().unwrap(),
        "hello",
        "",
        "",
        "",
        "",
        "auto",
        &SecretEnv::default(),
        None,
        |_| {},
    )
    .expect_err("malformed app-server frame must fail");
    std::env::set_var("PATH", original);
    assert!(
        malformed.message.contains("JSON-RPC"),
        "{}",
        malformed.message
    );
}

#[test]
fn codex_turn_failure_notification_is_not_reported_as_success() {
    let _guard = PATH_LOCK.lock().unwrap();
    let dir = std::env::temp_dir().join(format!(
        "coordy-native-codex-failed-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let fake = dir.join("codex");
    std::fs::write(
        &fake,
        r#"#!/bin/sh
read _
echo '{"jsonrpc":"2.0","id":1,"result":{}}'
read _
read _
echo '{"jsonrpc":"2.0","id":2,"result":{"thread":{"id":"thread-1"}}}'
read _
echo '{"jsonrpc":"2.0","id":3,"result":{"turn":{"id":"turn-1","status":"inProgress","items":[]}}}'
echo '{"jsonrpc":"2.0","method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"failed","error":{"message":"provider failed"},"items":[]}}}'
sleep 30
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
    let error = spawn_native_session(
        "codex",
        dir.to_str().unwrap(),
        "hello",
        "",
        "",
        "",
        "",
        "auto",
        &SecretEnv::default(),
        None,
        |_| {},
    )
    .expect_err("failed turn must surface");
    std::env::set_var("PATH", original);
    assert!(
        error.message.contains("provider failed"),
        "{}",
        error.message
    );
}

#[test]
fn dsh_probe_and_stdio_contract_completes_and_missing_result_fails() {
    let _guard = PATH_LOCK.lock().unwrap();
    let dir = std::env::temp_dir().join(format!(
        "coordy-dsh-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let fake = dir.join("dsh");
    let success = r#"#!/bin/sh
if [ "$*" = "--profile multica --probe" ]; then
  echo '{"runtime":"dsh","protocolVersion":1}'
  exit 0
fi
[ "$*" = "--profile multica --stdio" ] || exit 19
echo '{"type":"ready"}'
IFS= read -r _
echo '{"type":"text","text":"from dsh"}'
echo '{"type":"result"}'
"#;
    std::fs::write(&fake, success).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let original = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", format!("{}:{original}", dir.display()));
    let mut events = Vec::new();
    spawn_native_session(
        "dsh",
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
    )
    .expect("dsh success contract");
    assert!(format!("{events:?}").contains("from dsh"));

    std::fs::write(&fake, success.replace("echo '{\"type\":\"result\"}'", "")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let error = spawn_native_session(
        "dsh",
        dir.to_str().unwrap(),
        "hello",
        "",
        "",
        "",
        "",
        "auto",
        &SecretEnv::default(),
        None,
        |_| {},
    )
    .expect_err("dsh missing result must fail");
    std::env::set_var("PATH", original);
    assert!(
        error.message.contains("without result"),
        "{}",
        error.message
    );
}

#[test]
fn first_class_stream_and_one_shot_contracts_complete_and_surface_nonzero_exit() {
    let _guard = PATH_LOCK.lock().unwrap();
    let dir = std::env::temp_dir().join(format!(
        "coordy-first-class-native-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let cases = [
        ("claude", "claude", "-p --output-format stream-json --input-format stream-json --verbose --permission-mode auto", true, "stream"),
        ("codebuddy", "codebuddy", "-p --output-format stream-json --input-format stream-json --verbose --disallowedTools AskUserQuestion EnterPlanMode ExitPlanMode --permission-mode auto", true, "stream"),
        ("copilot", "copilot", "-p hello --output-format json --no-ask-user", false, "stream"),
        ("opencode", "opencode", "run --format json", true, "stream"),
        ("deveco", "deveco", "run --format json hello", false, "stream"),
        ("openclaw", "openclaw", "", false, "whole"),
        ("pi", "pi", "-p --mode json", true, "stream"),
        ("omp", "omp", "-p --mode json", true, "stream"),
        ("cursor", "cursor-agent", "-p --output-format stream-json", true, "stream"),
        ("qwen", "qwen", "-p hello --output-format stream-json", false, "stream"),
        ("gemini", "gemini", "-p hello --approval-mode auto_edit", false, "plain"),
    ];
    let original = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", format!("{}:{original}", dir.display()));
    for (kind, binary, expected, reads_stdin, dialect) in cases {
        let fake = dir.join(binary);
        let expected = if kind == "openclaw" {
            format!(
                "agent --json --session-id coordy-{} --message hello",
                std::process::id()
            )
        } else {
            expected.to_string()
        };
        let read = if reads_stdin {
            "IFS= read -r input"
        } else {
            ""
        };
        let output = match dialect {
            "whole" => format!(
                "printf '%s\\n' '{{' '  \"result\": {{' '    \"text\": \"from {kind}\"' '  }}' '}}'\nsleep 30"
            ),
            "plain" => format!("echo 'from {kind}'"),
            _ => match kind {
                "claude" | "codebuddy" | "qwen" => format!(
                    "echo '{{\"type\":\"assistant\",\"message\":{{\"content\":[{{\"type\":\"text\",\"text\":\"from {kind}\"}}]}}}}'\necho '{{\"type\":\"result\",\"subtype\":\"success\"}}'"
                ),
                "copilot" => format!(
                    "echo '{{\"type\":\"session.start\",\"data\":{{\"sessionId\":\"copilot-s1\",\"selectedModel\":\"fake\"}}}}'\necho '{{\"type\":\"assistant.message\",\"data\":{{\"content\":\"from {kind}\",\"toolRequests\":[]}}}}'\necho '{{\"type\":\"result\",\"sessionId\":\"copilot-s1\",\"exitCode\":0}}'"
                ),
                "opencode" | "deveco" => format!(
                    "echo '{{\"type\":\"step_start\",\"sessionID\":\"open-s1\",\"part\":{{}}}}'\necho '{{\"type\":\"text\",\"sessionID\":\"open-s1\",\"part\":{{\"text\":\"from {kind}\"}}}}'\necho '{{\"type\":\"step_finish\",\"sessionID\":\"open-s1\",\"part\":{{\"reason\":\"stop\"}}}}'"
                ),
                "pi" | "omp" => format!(
                    "echo '{{\"type\":\"agent_start\"}}'\necho '{{\"type\":\"turn_start\"}}'\necho '{{\"type\":\"message_update\",\"assistantMessageEvent\":{{\"type\":\"text_delta\",\"delta\":\"from {kind}\"}}}}'\necho '{{\"type\":\"turn_end\",\"message\":{{\"role\":\"assistant\",\"stopReason\":\"stop\"}}}}'"
                ),
                "cursor" => format!(
                    "echo '{{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"cursor-s1\"}}'\necho '{{\"type\":\"assistant\",\"message\":{{\"content\":[{{\"type\":\"output_text\",\"text\":\"from {kind}\"}}]}}}}'\necho '{{\"type\":\"result\",\"subtype\":\"success\",\"session_id\":\"cursor-s1\"}}'"
                ),
                _ => unreachable!("unexpected structured fixture {kind}"),
            },
        };
        let argv_check = if matches!(kind, "pi" | "omp") {
            "[ \"$1 $2 $3 $4\" = \"-p --mode json --session\" ] || exit 19\n[ -f \"$5\" ] || exit 20".to_string()
        } else if kind == "antigravity" {
            format!(
                "[ \"$1 $2 $3 $4\" = \"-p hello --print-timeout 24h0m0s\" ] || exit 19\n[ \"$5\" = \"--log-file\" ] || exit 20\n[ -f \"$6\" ] || exit 21\n[ \"$7 $8\" = \"--add-dir {}\" ] || exit 22",
                dir.display()
            )
        } else {
            format!("[ \"$*\" = \"{expected}\" ] || exit 19")
        };
        std::fs::write(
            &fake,
            format!("#!/bin/sh\n{argv_check}\n{read}\n{output}\n"),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let mut events = Vec::new();
        spawn_native_session(
            kind,
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
        )
        .unwrap_or_else(|error| panic!("{kind} success contract: {error:?}"));
        assert!(
            format!("{events:?}").contains(&format!("from {kind}")),
            "{kind}: {events:?}"
        );

        std::fs::write(&fake, "#!/bin/sh\necho provider-failed >&2\nexit 7\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let error = spawn_native_session(
            kind,
            dir.to_str().unwrap(),
            "hello",
            "",
            "",
            "",
            "",
            "auto",
            &SecretEnv::default(),
            None,
            |_| {},
        )
        .expect_err("nonzero provider exit must fail");
        assert!(
            error.message.contains("exited"),
            "{kind}: {}",
            error.message
        );

        if dialect != "plain" {
            std::fs::write(
                &fake,
                format!(
                    "#!/bin/sh\n{}\necho '{{\"type\":\"message\",\"text\":\"from {kind}\"}}'\necho not-json\n",
                    if reads_stdin { "IFS= read -r input" } else { "" }
                ),
            )
            .unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            let malformed = spawn_native_session(
                kind,
                dir.to_str().unwrap(),
                "hello",
                "",
                "",
                "",
                "",
                "auto",
                &SecretEnv::default(),
                None,
                |_| {},
            )
            .expect_err("malformed structured output must fail even after a valid event");
            assert!(
                malformed.message.contains("malformed")
                    || malformed.message.contains("no successful result"),
                "{kind}: {malformed:?}"
            );
        }
    }
    std::env::set_var("PATH", original);
}
