use std::os::unix::net::UnixStream;
use std::thread;

use coordy_harness::{
    drive_session, drive_session_with_auth, map_session_update, serve_fake_acp, spawn_acp_session,
    SecretEnv,
};
use coordy_protocol::HarnessEvent;
use serde_json::json;

#[test]
fn maps_agent_message_chunks() {
    let params = json!({
        "sessionId": "s1",
        "update": {
            "sessionUpdate": "agent_message_chunk",
            "content": { "type": "text", "text": "hello from ACP" }
        }
    });
    let event = map_session_update(&params).expect("mapped");
    assert!(matches!(
        event,
        HarnessEvent::Message { role, content }
            if role == "assistant" && content == "hello from ACP"
    ));
}

#[cfg(unix)]
#[test]
fn drive_session_against_fake_acp_agent() {
    let (client, agent) = UnixStream::pair().expect("pair");
    let agent_write = agent.try_clone().expect("clone");
    let reply = "GOAL: keep-release-gate";
    let agent_thread = thread::spawn(move || {
        serve_fake_acp(agent, agent_write, reply).expect("fake agent");
    });
    let client_write = client.try_clone().expect("clone client");
    let mut events = Vec::new();
    drive_session(
        client,
        client_write,
        "ship it",
        "",
        std::path::Path::new("."),
        "full_access",
        &mut |event| {
            events.push(event);
        },
    )
    .expect("drive");
    agent_thread.join().expect("join");
    assert!(
        events.iter().any(|event| matches!(
            event,
            HarnessEvent::Message { content, .. } if content.contains("keep-release-gate")
        )),
        "{events:?}"
    );
}

#[test]
fn resolve_acp_command_uses_configured_launch() {
    let (bin, args) = coordy_harness::resolve_acp_command(Some(" /usr/bin/codex acp ")).unwrap();
    assert_eq!(bin, "/usr/bin/codex");
    assert_eq!(args, vec!["acp".to_string()]);
}

#[cfg(unix)]
#[test]
fn grok_authenticates_with_an_advertised_method_before_session_creation() {
    use std::io::{BufRead, BufReader, Write};

    let (client, agent) = UnixStream::pair().expect("pair");
    let mut agent_read = BufReader::new(agent.try_clone().expect("clone agent"));
    let mut agent_write = agent;
    let agent_thread = thread::spawn(move || {
        let mut line = String::new();
        agent_read.read_line(&mut line).unwrap();
        let init: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        writeln!(
            agent_write,
            "{}",
            json!({
                "jsonrpc": "2.0", "id": init["id"],
                "result": { "authMethods": [{"id":"cached_token"}, {"id":"xai.api_key"}] }
            })
        )
        .unwrap();

        line.clear();
        agent_read.read_line(&mut line).unwrap();
        let auth: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(auth["method"], "authenticate");
        assert_eq!(auth["params"]["methodId"], "xai.api_key");
        writeln!(
            agent_write,
            "{}",
            json!({"jsonrpc":"2.0", "id":auth["id"], "result":{}})
        )
        .unwrap();

        line.clear();
        agent_read.read_line(&mut line).unwrap();
        let new_session: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(new_session["method"], "session/new");
        writeln!(
            agent_write,
            "{}",
            json!({"jsonrpc":"2.0", "id":new_session["id"], "result":{"sessionId":"g1"}})
        )
        .unwrap();

        line.clear();
        agent_read.read_line(&mut line).unwrap();
        let prompt: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        writeln!(
            agent_write,
            "{}",
            json!({"jsonrpc":"2.0", "id":prompt["id"], "result":{"stopReason":"end_turn"}})
        )
        .unwrap();
    });
    let client_write = client.try_clone().expect("clone client");
    drive_session_with_auth(
        client,
        client_write,
        "ship it",
        "",
        std::path::Path::new("."),
        "full_access",
        true,
        true,
        &mut |_| {},
    )
    .expect("authenticated drive");
    agent_thread.join().expect("join");
}

#[cfg(unix)]
#[test]
fn hermes_launches_acp_subcommand_and_completes_a_fake_session() {
    use std::os::unix::fs::PermissionsExt;

    let dir = std::env::temp_dir().join(format!(
        "coordy-hermes-acp-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let fake = dir.join("hermes");
    std::fs::write(
        &fake,
        r#"#!/bin/sh
[ "$1" = "acp" ] || exit 9
IFS= read -r _
echo '{"jsonrpc":"2.0","id":1,"result":{}}'
IFS= read -r _
echo '{"jsonrpc":"2.0","id":2,"result":{"sessionId":"hermes-fake"}}'
IFS= read -r _
echo '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"from hermes acp"}}}}'
echo '{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}'
"#,
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();

    let mut events = Vec::new();
    spawn_acp_session(
        "hermes",
        fake.to_str().unwrap(),
        &["acp".into()],
        dir.to_str().unwrap(),
        "ship it",
        "",
        "",
        &SecretEnv::default(),
        "full_access",
        None,
        |event| events.push(event),
    )
    .expect("hermes ACP fake session");
    assert!(events.iter().any(|event| matches!(
        event,
        HarnessEvent::Message { content, .. } if content == "from hermes acp"
    )));

    std::fs::write(&fake, "#!/bin/sh\nread _\necho not-json\n").unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    spawn_acp_session(
        "hermes",
        fake.to_str().unwrap(),
        &["acp".into()],
        dir.to_str().unwrap(),
        "ship it",
        "",
        "",
        &SecretEnv::default(),
        "full_access",
        None,
        |_| {},
    )
    .expect_err("malformed Hermes ACP must fail");
}

#[cfg(unix)]
#[test]
fn grok_fixed_argv_auth_and_failure_contract_run_through_the_process_boundary() {
    use std::os::unix::fs::PermissionsExt;
    let dir = std::env::temp_dir().join(format!(
        "coordy-grok-process-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let fake = dir.join("grok");
    std::fs::write(&fake, r#"#!/bin/sh
[ "$*" = "--no-auto-update agent --always-approve --effort high stdio" ] || exit 19
read _
echo '{"jsonrpc":"2.0","id":1,"result":{"authMethods":[{"id":"xai.api_key"}]}}'
read _
echo '{"jsonrpc":"2.0","id":2,"result":{}}'
read _
echo '{"jsonrpc":"2.0","id":3,"result":{"sessionId":"grok-session"}}'
read _
echo '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"from grok"}}}}'
echo '{"jsonrpc":"2.0","id":4,"result":{"stopReason":"end_turn"}}'
"#).unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let secret = SecretEnv {
        provider: "xai".into(),
        api_key: Some("test-only".into()),
        ..Default::default()
    };
    let args = ["--no-auto-update", "agent", "--always-approve", "stdio"].map(str::to_string);
    let mut events = Vec::new();
    spawn_acp_session(
        "grok",
        fake.to_str().unwrap(),
        &args,
        dir.to_str().unwrap(),
        "ship it",
        "",
        "high",
        &secret,
        "full_access",
        None,
        |event| events.push(event),
    )
    .expect("Grok authenticated process contract");
    assert!(format!("{events:?}").contains("from grok"));

    std::fs::write(
        &fake,
        "#!/bin/sh\nread _\necho '{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}'\n",
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let error = spawn_acp_session(
        "grok",
        fake.to_str().unwrap(),
        &args,
        dir.to_str().unwrap(),
        "ship it",
        "",
        "",
        &secret,
        "full_access",
        None,
        |_| {},
    )
    .expect_err("Grok without advertised authentication must fail");
    assert!(error.message.contains("auth"), "{}", error.message);
}

#[cfg(unix)]
#[test]
fn first_class_acp_launch_contracts_complete_and_surface_malformed_output() {
    use std::os::unix::fs::PermissionsExt;

    let dir = std::env::temp_dir().join(format!(
        "coordy-first-class-acp-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let fake = dir.join("fake-acp");
    let cases: &[(&str, &[&str])] = &[
        ("kimi", &["acp"]),
        (
            "reasonix",
            &[
                "acp",
                "--profile",
                "balanced",
                "--planner",
                "auto",
                "--sandbox-network",
                "auto",
                "--sandbox-bash",
                "auto",
                "--workspace-only",
            ],
        ),
        ("kiro", &["acp", "--trust-all-tools"]),
        ("qoder", &["--yolo", "--acp"]),
        ("qoderclicn", &["--yolo", "--acp"]),
        ("traecli", &["acp", "serve", "--yolo"]),
        ("qwenpaw", &["acp"]),
        ("mcode", &["acp"]),
    ];
    for (kind, fixed) in cases {
        let expected = if *kind == "qwenpaw" {
            format!("{} --workspace {}", fixed.join(" "), dir.display())
        } else {
            fixed.join(" ")
        };
        let script = format!(
            r#"#!/bin/sh
[ "$*" = "{expected}" ] || exit 19
IFS= read -r _
echo '{{"jsonrpc":"2.0","id":1,"result":{{}}}}'
IFS= read -r _
echo '{{"jsonrpc":"2.0","id":2,"result":{{"sessionId":"fake-session"}}}}'
IFS= read -r _
echo '{{"jsonrpc":"2.0","method":"session/update","params":{{"update":{{"sessionUpdate":"agent_message_chunk","content":{{"type":"text","text":"from {kind}"}}}}}}}}'
echo '{{"jsonrpc":"2.0","id":3,"result":{{"stopReason":"end_turn"}}}}'
"#
        );
        std::fs::write(&fake, script).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let args: Vec<String> = fixed.iter().map(|arg| (*arg).into()).collect();
        let mut events = Vec::new();
        spawn_acp_session(
            kind,
            fake.to_str().unwrap(),
            &args,
            dir.to_str().unwrap(),
            "ship it",
            "",
            "",
            &SecretEnv::default(),
            "full_access",
            None,
            |event| events.push(event),
        )
        .unwrap_or_else(|error| panic!("{kind} success contract: {error:?}"));
        assert!(events.iter().any(|event| matches!(
            event,
            HarnessEvent::Message { content, .. } if content == &format!("from {kind}")
        )));

        std::fs::write(&fake, "#!/bin/sh\nIFS= read -r _\necho not-json\n").unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let error = spawn_acp_session(
            kind,
            fake.to_str().unwrap(),
            &args,
            dir.to_str().unwrap(),
            "ship it",
            "",
            "",
            &SecretEnv::default(),
            "full_access",
            None,
            |_| {},
        )
        .expect_err("malformed ACP must fail");
        assert!(error.message.contains("JSON"), "{kind}: {}", error.message);
    }
}

#[cfg(unix)]
#[test]
fn acp_provider_model_thinking_and_workspace_policies_reach_the_process_boundary() {
    use std::os::unix::fs::PermissionsExt;

    let dir = std::env::temp_dir().join(format!(
        "coordy-acp-policy-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let fake = dir.join("fake-acp-policy");

    std::fs::write(
        &fake,
        r#"#!/bin/sh
[ "$*" = "acp" ] || exit 19
read init
case "$init" in *'"protocolVersion":1'*) ;; *) exit 20 ;; esac
echo '{"jsonrpc":"2.0","id":1,"result":{}}'
read new
echo '{"jsonrpc":"2.0","id":2,"result":{"sessionId":"kimi-s1"}}'
read model
case "$model" in *'"method":"session/set_model"'*'"modelId":"kimi-model"'*) ;; *) exit 21 ;; esac
echo '{"jsonrpc":"2.0","id":3,"result":{}}'
read config
case "$config" in *'"method":"session/set_config_option"'*'"configId":"thinking"'*'"value":"high"'*) ;; *) exit 22 ;; esac
echo '{"jsonrpc":"2.0","id":4,"result":{}}'
read prompt
case "$prompt" in *'"method":"session/prompt"'*) ;; *) exit 23 ;; esac
echo '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"kimi policy ok"}}}}'
echo '{"jsonrpc":"2.0","id":5,"result":{"stopReason":"end_turn"}}'
"#,
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut events = Vec::new();
    spawn_acp_session(
        "kimi",
        fake.to_str().unwrap(),
        &["acp".into()],
        dir.to_str().unwrap(),
        "ship it",
        "kimi-model",
        "high",
        &SecretEnv::default(),
        "auto",
        None,
        |event| events.push(event),
    )
    .expect("Kimi model and thinking policy");
    assert!(format!("{events:?}").contains("kimi policy ok"));

    let qwenpaw_argv = format!("acp --workspace {}", dir.display());
    std::fs::write(
        &fake,
        format!(
            r#"#!/bin/sh
[ "$*" = "{qwenpaw_argv}" ] || exit 29
read init
case "$init" in *'"protocolVersion":2'*) ;; *) exit 30 ;; esac
echo '{{"jsonrpc":"2.0","id":1,"result":{{}}}}'
read new
case "$new" in *'"qwenpaw.coding_project_dir"'*) ;; *) exit 31 ;; esac
echo '{{"jsonrpc":"2.0","id":2,"result":{{"sessionId":"paw-s1"}}}}'
read prompt
case "$prompt" in *'"method":"session/prompt"'*) ;; *) exit 32 ;; esac
echo '{{"jsonrpc":"2.0","method":"session/update","params":{{"update":{{"sessionUpdate":"agent_message_chunk","content":{{"type":"text","text":"qwenpaw policy ok"}}}}}}}}'
echo '{{"jsonrpc":"2.0","id":3,"result":{{"stopReason":"end_turn"}}}}'
"#
        ),
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut events = Vec::new();
    spawn_acp_session(
        "qwenpaw",
        fake.to_str().unwrap(),
        &["acp".into()],
        dir.to_str().unwrap(),
        "ship it",
        "must-not-be-set",
        "must-not-be-set",
        &SecretEnv::default(),
        "auto",
        None,
        |event| events.push(event),
    )
    .expect("QwenPaw workspace metadata and runtime-owned model policy");
    assert!(format!("{events:?}").contains("qwenpaw policy ok"));

    std::fs::write(
        &fake,
        r#"#!/bin/sh
[ "$*" = "acp" ] || exit 39
[ -z "${HERMES_YOLO_MODE:-}" ] || exit 42
read _
echo '{"jsonrpc":"2.0","id":1,"result":{"configOptions":[{"id":"effort"}]}}'
read _
echo '{"jsonrpc":"2.0","id":2,"result":{"sessionId":"hermes-s1"}}'
read config
case "$config" in *'"method":"session/set_config_option"'*'"configId":"effort"'*'"value":"medium"'*) ;; *) exit 40 ;; esac
echo '{"jsonrpc":"2.0","id":3,"result":{}}'
read prompt
case "$prompt" in *'"method":"session/prompt"'*) ;; *) exit 41 ;; esac
echo '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hermes policy ok"}}}}'
echo '{"jsonrpc":"2.0","id":4,"result":{"stopReason":"end_turn"}}'
"#,
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut events = Vec::new();
    spawn_acp_session(
        "hermes",
        fake.to_str().unwrap(),
        &["acp".into()],
        dir.to_str().unwrap(),
        "ship it",
        "",
        "medium",
        &SecretEnv::default(),
        "auto",
        None,
        |event| events.push(event),
    )
    .expect("Hermes advertised effort policy");
    assert!(format!("{events:?}").contains("hermes policy ok"));
}
