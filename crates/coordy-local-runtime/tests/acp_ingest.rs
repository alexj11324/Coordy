use coordy_local_runtime::{Runtime, SecretStore};
use coordy_protocol::{Actor, AuthenticatedCommand, Command, RunSource};

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

fn write_fake_acp(dir: &std::path::Path) -> std::path::PathBuf {
    let path = dir.join("fake_acp.py");
    std::fs::write(
        &path,
        r#"#!/usr/bin/env python3
import json, sys

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

for raw in sys.stdin:
    line = raw.strip()
    if not line:
        continue
    msg = json.loads(line)
    method = msg.get("method")
    ident = msg.get("id")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": ident, "result": {
            "protocolVersion": 1,
            "agentCapabilities": {},
            "agentInfo": {"name": "fake-acp", "version": "0"},
            "authMethods": []
        }})
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": ident, "result": {"sessionId": "s1"}})
    elif method == "session/set_model":
        send({"jsonrpc": "2.0", "id": ident, "result": {}})
    elif method == "session/prompt":
        send({"jsonrpc": "2.0", "method": "session/update", "params": {
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "acp-live-hello"}
            }
        }})
        send({"jsonrpc": "2.0", "id": ident, "result": {"stopReason": "end_turn"}})
        break
"#,
    )
    .unwrap();
    path
}

fn python() -> Option<&'static str> {
    for bin in ["python3", "python"] {
        if std::process::Command::new(bin)
            .arg("-c")
            .arg("print(1)")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return Some(bin);
        }
    }
    None
}

#[test]
fn acp_session_ingests_and_key_stays_out_of_sqlite() {
    let Some(python) = python() else {
        panic!("python3 is required to exercise the ACP stdio adapter");
    };
    let dir = unique_dir("acp-live");
    let script = write_fake_acp(&dir);
    let store = SecretStore::open(&dir);
    store
        .set(
            "openai".into(),
            Some("sk-must-not-land-in-sqlite".into()),
            None,
            Some(format!("{python} {}", script.display())),
        )
        .unwrap();
    let sock = dir.join("unused.sock");
    let rt = Runtime::open(&dir, &sock, "tok".into()).unwrap();
    let ws = rt
        .kernel
        .submit_sync(AuthenticatedCommand {
            actor: Actor::Daemon,
            command: Command::CreateWorkspace {
                name: "live".into(),
            },
        })
        .unwrap();
    let workspace_id = ws.ids["workspace_id"].as_str().unwrap().to_string();
    let principal = rt
        .kernel
        .submit_sync(AuthenticatedCommand {
            actor: Actor::Daemon,
            command: Command::CreatePrincipal {
                workspace_id: workspace_id.clone(),
                name: "Owner".into(),
            },
        })
        .unwrap();
    let principal_id = principal.ids["principal_id"].as_str().unwrap().to_string();
    let agent = rt
        .kernel
        .submit_sync(AuthenticatedCommand {
            actor: Actor::Principal {
                id: principal_id.clone(),
            },
            command: Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: principal_id.clone(),
                name: "ACP".into(),
                harness: "acp".into(),
            },
        })
        .unwrap();
    let agent_id = agent.ids["agent_id"].as_str().unwrap().to_string();
    let task = rt
        .kernel
        .submit_sync(AuthenticatedCommand {
            actor: Actor::Principal {
                id: principal_id.clone(),
            },
            command: Command::CreateTask {
                workspace_id,
                title: "say hi".into(),
                description: String::new(),
            },
        })
        .unwrap();
    let task_id = task.ids["task_id"].as_str().unwrap().to_string();
    rt.kernel
        .submit_sync(AuthenticatedCommand {
            actor: Actor::Principal {
                id: principal_id.clone(),
            },
            command: Command::AssignTask {
                task_id: task_id.clone(),
                agent_id,
            },
        })
        .unwrap();
    rt.kernel
        .submit_sync(AuthenticatedCommand {
            actor: Actor::Principal { id: principal_id },
            command: Command::StartRun {
                task_id,
                source: RunSource::Acp {
                    prompt: "hello".into(),
                },
                agent_id: None,
                chat_id: None,
                trigger: String::new(),
            },
        })
        .unwrap();

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    let mut saw = false;
    while std::time::Instant::now() < deadline {
        let world = rt.kernel.export_world();
        if world
            .run_events
            .iter()
            .any(|event| event.payload.contains("acp-live-hello"))
        {
            saw = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    assert!(saw, "ACP session output should be ingested as a run event");

    rt.persist().unwrap();
    let db = std::fs::read(dir.join("coordy.sqlite")).unwrap();
    let needle = b"sk-must-not-land-in-sqlite";
    assert!(
        !db.windows(needle.len()).any(|w| w == needle),
        "BYOK key must not be written to SQLite"
    );
}
