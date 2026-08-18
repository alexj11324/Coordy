use std::os::unix::net::UnixStream;
use std::thread;

use coordy_harness::{drive_session, map_session_update, serve_fake_acp};
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
        std::path::Path::new("."),
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
