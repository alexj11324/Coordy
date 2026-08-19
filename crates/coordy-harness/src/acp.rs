//! Agent Client Protocol (ACP) stdio JSON-RPC client.
//! Maps session updates onto kernel `HarnessEvent`s. Does not talk to the kernel.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;

use coordy_protocol::{CoordyError, HarnessEvent};
use serde_json::{json, Value};

use crate::protocol::{parse_tool_access, ToolAccess};
use crate::SecretEnv;

pub const ACP_STUB_REPLY: &str = "内置演示智能体已就绪。这不是云端模型：在「新建智能体」中选择本机 harness，并配置模型密钥后即可使用真实智能体。";

pub fn resolve_acp_command(configured: Option<&str>) -> Result<(String, Vec<String>), CoordyError> {
    crate::discovery::resolve_launch("acp", configured, None)
}

#[allow(clippy::too_many_arguments)]
pub fn spawn_acp_session(
    bin: &str,
    args: &[String],
    worktree: &str,
    prompt: &str,
    model: &str,
    secrets: &SecretEnv,
    tool_access: &str,
    run_id: Option<&str>,
    mut on_event: impl FnMut(HarnessEvent),
) -> Result<(), CoordyError> {
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .current_dir(if worktree.is_empty() { "." } else { worktree })
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in secrets.env_pairs() {
        cmd.env(key, value);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| CoordyError::unavailable(format!("spawn ACP `{bin}`: {e}")))?;
    if let Some(run_id) = run_id {
        crate::children::register_child(run_id, child.id());
    }
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| CoordyError::unavailable("ACP stdin"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CoordyError::unavailable("ACP stdout"))?;
    if let Some(mut stderr) = child.stderr.take() {
        thread::spawn(move || {
            let mut sink = std::io::sink();
            let _ = std::io::copy(&mut stderr, &mut sink);
        });
    }
    let cwd = PathBuf::from(if worktree.is_empty() { "." } else { worktree });
    let result = drive_session(
        stdout,
        stdin,
        prompt,
        model,
        &cwd,
        tool_access,
        &mut on_event,
    );
    if let Some(run_id) = run_id {
        crate::children::unregister_child(run_id);
    }
    let _ = child.kill();
    let _ = child.wait();
    result
}

#[allow(clippy::too_many_arguments)]
pub fn drive_session<R: Read, W: Write>(
    reader: R,
    mut writer: W,
    prompt: &str,
    model: &str,
    cwd: &Path,
    tool_access: &str,
    on_event: &mut impl FnMut(HarnessEvent),
) -> Result<(), CoordyError> {
    let access = parse_tool_access(tool_access);
    let mut lines = BufReader::new(reader);
    let mut next_id = 1u64;
    write_rpc(
        &mut writer,
        next_id,
        "initialize",
        json!({
            "protocolVersion": 1,
            "clientCapabilities": {
                "fs": { "readTextFile": true, "writeTextFile": true },
                "terminal": false
            },
            "clientInfo": { "name": "coordy", "title": "Coordy", "version": env!("CARGO_PKG_VERSION") }
        }),
    )?;
    let _init = wait_response(&mut lines, &mut writer, next_id, cwd, access, on_event)?;
    next_id += 1;
    write_rpc(
        &mut writer,
        next_id,
        "session/new",
        json!({ "cwd": cwd.display().to_string(), "mcpServers": [] }),
    )?;
    let new_session = wait_response(&mut lines, &mut writer, next_id, cwd, access, on_event)?;
    let session_id = new_session
        .get("result")
        .and_then(|r| r.get("sessionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("default")
        .to_string();
    next_id += 1;
    if !model.trim().is_empty() {
        write_rpc(
            &mut writer,
            next_id,
            "session/set_model",
            json!({ "sessionId": session_id, "modelId": model.trim() }),
        )?;
        let _set_model = wait_response(&mut lines, &mut writer, next_id, cwd, access, on_event)?;
        next_id += 1;
    }
    write_rpc(
        &mut writer,
        next_id,
        "session/prompt",
        json!({
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": prompt }]
        }),
    )?;
    let _done = wait_response(&mut lines, &mut writer, next_id, cwd, access, on_event)?;
    Ok(())
}

fn rpc_id_matches(value: Option<&Value>, expect: u64) -> bool {
    let Some(value) = value else {
        return false;
    };
    if value.as_u64() == Some(expect) {
        return true;
    }
    if value.as_i64().and_then(|n| u64::try_from(n).ok()) == Some(expect) {
        return true;
    }
    value.as_str().and_then(|s| s.parse::<u64>().ok()) == Some(expect)
}

fn write_rpc<W: Write>(
    writer: &mut W,
    id: u64,
    method: &str,
    params: Value,
) -> Result<(), CoordyError> {
    let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
    writeln!(writer, "{msg}").map_err(|e| CoordyError::unavailable(format!("ACP write: {e}")))?;
    writer
        .flush()
        .map_err(|e| CoordyError::unavailable(format!("ACP flush: {e}")))
}

fn write_result<W: Write>(writer: &mut W, id: &Value, result: Value) -> Result<(), CoordyError> {
    let msg = json!({ "jsonrpc": "2.0", "id": id, "result": result });
    writeln!(writer, "{msg}").map_err(|e| CoordyError::unavailable(format!("ACP write: {e}")))?;
    writer
        .flush()
        .map_err(|e| CoordyError::unavailable(format!("ACP flush: {e}")))
}

fn write_error<W: Write>(writer: &mut W, id: &Value, message: &str) -> Result<(), CoordyError> {
    let msg = json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": -32601, "message": message }
    });
    writeln!(writer, "{msg}").map_err(|e| CoordyError::unavailable(format!("ACP write: {e}")))?;
    writer
        .flush()
        .map_err(|e| CoordyError::unavailable(format!("ACP flush: {e}")))
}

fn wait_response<R: BufRead, W: Write>(
    lines: &mut R,
    writer: &mut W,
    expect_id: u64,
    cwd: &Path,
    access: ToolAccess,
    on_event: &mut impl FnMut(HarnessEvent),
) -> Result<Value, CoordyError> {
    let mut buf = String::new();
    loop {
        buf.clear();
        let n = lines
            .read_line(&mut buf)
            .map_err(|e| CoordyError::unavailable(format!("ACP read: {e}")))?;
        if n == 0 {
            return Err(CoordyError::unavailable("ACP agent closed stdout"));
        }
        let line = buf.trim();
        if line.is_empty() {
            continue;
        }
        let msg: Value = serde_json::from_str(line)
            .map_err(|e| CoordyError::invalid(format!("ACP JSON: {e}")))?;
        if rpc_id_matches(msg.get("id"), expect_id)
            && (msg.get("result").is_some() || msg.get("error").is_some())
        {
            if let Some(err) = msg.get("error") {
                return Err(CoordyError::unavailable(format!("ACP error: {err}")));
            }
            return Ok(msg);
        }
        if let Some(method) = msg.get("method").and_then(|m| m.as_str()) {
            if method == "session/update" {
                if let Some(event) = map_session_update(msg.get("params").unwrap_or(&Value::Null)) {
                    on_event(event);
                }
                continue;
            }
            if msg.get("id").is_some() {
                handle_agent_request(writer, &msg, cwd, access, on_event)?;
            }
        }
    }
}

pub fn map_session_update(params: &Value) -> Option<HarnessEvent> {
    let update = params.get("update").unwrap_or(params);
    let kind = update
        .get("sessionUpdate")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let text = update
        .pointer("/content/text")
        .and_then(|v| v.as_str())
        .or_else(|| update.get("text").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();
    match kind {
        "agent_message_chunk" | "agent_message" | "message" => {
            if text.is_empty() {
                None
            } else {
                Some(HarnessEvent::Message {
                    role: "assistant".into(),
                    content: text,
                })
            }
        }
        "agent_thought_chunk" => {
            if text.is_empty() {
                None
            } else {
                Some(HarnessEvent::Message {
                    role: "assistant".into(),
                    content: format!("thinking: {text}"),
                })
            }
        }
        "tool_call" | "tool_call_update" => {
            let name = update
                .get("title")
                .or_else(|| update.get("kind"))
                .or_else(|| update.get("toolCallId"))
                .and_then(|v| v.as_str())
                .unwrap_or("tool")
                .to_string();
            Some(HarnessEvent::Tool {
                name,
                input: update
                    .get("rawInput")
                    .map(|v| v.to_string())
                    .unwrap_or_default(),
                output: update
                    .get("rawOutput")
                    .or_else(|| update.get("status"))
                    .map(|v| v.to_string())
                    .unwrap_or_default(),
                exit_code: None,
            })
        }
        _ => {
            if text.is_empty() {
                None
            } else {
                Some(HarnessEvent::Message {
                    role: "assistant".into(),
                    content: text,
                })
            }
        }
    }
}

fn handle_agent_request<W: Write>(
    writer: &mut W,
    msg: &Value,
    cwd: &Path,
    access: ToolAccess,
    on_event: &mut impl FnMut(HarnessEvent),
) -> Result<(), CoordyError> {
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(json!({}));
    match method {
        "fs/read_text_file" => {
            let path = params.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let resolved = match resolve_fs_path(cwd, path, access, false) {
                Ok(path) => path,
                Err(message) => return write_error(writer, &id, &message),
            };
            match std::fs::read_to_string(&resolved) {
                Ok(content) => write_result(writer, &id, json!({ "content": content })),
                Err(e) => write_error(writer, &id, &e.to_string()),
            }
        }
        "fs/write_text_file" => {
            let path = params.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let content = params.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let resolved = match resolve_fs_path(cwd, path, access, true) {
                Ok(path) => path,
                Err(message) => return write_error(writer, &id, &message),
            };
            if let Some(parent) = resolved.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::write(&resolved, content)
                .map_err(|e| CoordyError::unavailable(format!("ACP write file: {e}")))?;
            on_event(HarnessEvent::Patch {
                diff: format!("*** Update File: {}\n{}", resolved.display(), content),
            });
            write_result(writer, &id, json!({}))
        }
        "session/request_permission" => {
            let outcome = match acp_auto_approve_option_id(&params, access) {
                Some(option_id) => json!({ "outcome": "selected", "optionId": option_id }),
                None => json!({ "outcome": "cancelled" }),
            };
            write_result(writer, &id, json!({ "outcome": outcome }))
        }
        _ => write_error(writer, &id, &format!("unsupported method {method}")),
    }
}

/// Pick an offered allow option so ACP agents do not stall waiting for a human.
/// Auto prefers a one-shot grant. Full Access prefers a lasting grant.
fn acp_auto_approve_option_id(params: &Value, access: ToolAccess) -> Option<String> {
    let options: Vec<(String, Option<String>)> = params
        .get("options")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|opt| {
            let id = opt
                .get("optionId")
                .or_else(|| opt.get("option_id"))
                .and_then(|v| v.as_str())
                .map(str::to_string)?;
            let kind = opt.get("kind").and_then(Value::as_str).map(str::to_string);
            Some((id, kind))
        })
        .collect();
    let preferred_kinds: &[&str] = match access {
        ToolAccess::FullAccess => &["allow_always", "allow_once"],
        ToolAccess::Auto => &["allow_once"],
    };
    for want in preferred_kinds {
        if let Some((id, _)) = options
            .iter()
            .find(|(_, kind)| kind.as_deref() == Some(*want))
        {
            return Some(id.clone());
        }
    }
    options
        .into_iter()
        .find(|(_, kind)| matches!(kind.as_deref(), Some("reject_once" | "reject_always")))
        .map(|(id, _)| id)
}

fn resolve_fs_path(
    cwd: &Path,
    path: &str,
    access: ToolAccess,
    for_write: bool,
) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("file path is required".into());
    }
    let p = PathBuf::from(path);
    let candidate = if p.is_absolute() { p } else { cwd.join(p) };
    if access == ToolAccess::FullAccess {
        return Ok(candidate);
    }

    let workspace = std::fs::canonicalize(cwd)
        .map_err(|_| "cannot resolve the worktree for Auto access".to_string())?;
    let candidate = lexical_normalize(&candidate);
    let resolved = if for_write && !candidate.exists() {
        let mut existing = candidate.as_path();
        let mut missing = Vec::new();
        loop {
            match std::fs::symlink_metadata(existing) {
                Ok(_) => break,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    let Some(name) = existing.file_name() else {
                        return Err("cannot resolve file path".into());
                    };
                    missing.push(name.to_os_string());
                    let Some(parent) = existing.parent() else {
                        return Err("cannot resolve file path".into());
                    };
                    existing = parent;
                }
                Err(_) => return Err("cannot resolve file path".into()),
            }
        }
        let mut resolved =
            std::fs::canonicalize(existing).map_err(|_| "cannot resolve file path".to_string())?;
        for part in missing.into_iter().rev() {
            resolved.push(part);
        }
        resolved
    } else {
        std::fs::canonicalize(&candidate).map_err(|_| "cannot resolve file path".to_string())?
    };
    if !resolved.starts_with(&workspace) {
        return Err("Auto access cannot read or write outside the worktree".into());
    }
    Ok(resolved)
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

/// Test helper: a tiny ACP agent that answers initialize / session/new / session/prompt.
pub fn serve_fake_acp<R: Read, W: Write>(
    reader: R,
    mut writer: W,
    reply: &str,
) -> Result<(), CoordyError> {
    let mut lines = BufReader::new(reader);
    let mut buf = String::new();
    let mut sessions: HashMap<String, ()> = HashMap::new();
    loop {
        buf.clear();
        let n = lines
            .read_line(&mut buf)
            .map_err(|e| CoordyError::unavailable(e.to_string()))?;
        if n == 0 {
            return Ok(());
        }
        let line = buf.trim();
        if line.is_empty() {
            continue;
        }
        let msg: Value =
            serde_json::from_str(line).map_err(|e| CoordyError::invalid(e.to_string()))?;
        let id = msg.get("id").cloned().unwrap_or(Value::Null);
        let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
        match method {
            "initialize" => {
                write_result(
                    &mut writer,
                    &id,
                    json!({
                        "protocolVersion": 1,
                        "agentCapabilities": { "loadSession": false },
                        "agentInfo": { "name": "coordy-fake-acp", "version": "0" },
                        "authMethods": []
                    }),
                )?;
            }
            "session/new" => {
                sessions.insert("s1".into(), ());
                write_result(&mut writer, &id, json!({ "sessionId": "s1" }))?;
            }
            "session/set_model" => {
                write_result(&mut writer, &id, json!({}))?;
            }
            "session/prompt" => {
                let note = json!({
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {
                        "sessionId": "s1",
                        "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "content": { "type": "text", "text": reply }
                        }
                    }
                });
                writeln!(writer, "{note}").map_err(|e| CoordyError::unavailable(e.to_string()))?;
                writer.flush().ok();
                write_result(&mut writer, &id, json!({ "stopReason": "end_turn" }))?;
                return Ok(());
            }
            _ => write_error(&mut writer, &id, "unexpected")?,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{acp_auto_approve_option_id, handle_agent_request};
    use crate::protocol::ToolAccess;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn full_access_prefers_allow_always_auto_keeps_once() {
        let params = json!({
            "options": [
                { "optionId": "persistent-grant-7", "kind": "allow_always" },
                { "optionId": "reject-9", "kind": "reject_once" },
                { "optionId": "single-grant-4", "kind": "allow_once" }
            ]
        });
        assert_eq!(
            acp_auto_approve_option_id(&params, ToolAccess::FullAccess),
            Some("persistent-grant-7".into())
        );
        assert_eq!(
            acp_auto_approve_option_id(&params, ToolAccess::Auto),
            Some("single-grant-4".into())
        );
    }

    #[test]
    fn falls_back_to_offered_rejection_and_cancels_when_empty() {
        let once = json!({
            "options": [
                { "optionId": "single", "kind": "allow_once" },
                { "optionId": "reject", "kind": "reject_once" }
            ]
        });
        assert_eq!(
            acp_auto_approve_option_id(&once, ToolAccess::Auto),
            Some("single".into())
        );
        let only_reject = json!({
            "options": [{ "optionId": "reject", "kind": "reject_once" }]
        });
        assert_eq!(
            acp_auto_approve_option_id(&only_reject, ToolAccess::Auto),
            Some("reject".into())
        );
        let persistent_only = json!({
            "options": [{ "optionId": "persistent", "kind": "allow_always" }]
        });
        assert_eq!(
            acp_auto_approve_option_id(&persistent_only, ToolAccess::Auto),
            None
        );
        assert_eq!(
            acp_auto_approve_option_id(&persistent_only, ToolAccess::FullAccess),
            Some("persistent".into())
        );
        let empty = json!({});
        assert_eq!(acp_auto_approve_option_id(&empty, ToolAccess::Auto), None);
    }

    #[test]
    fn auto_file_access_stays_in_worktree_while_full_access_can_leave() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("coordy-acp-access-{suffix}"));
        let cwd = root.join("worktree");
        std::fs::create_dir_all(&cwd).unwrap();
        let outside = root.join("outside.txt");
        std::fs::write(&outside, "secret").unwrap();

        let read = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "fs/read_text_file",
            "params": { "path": "../outside.txt" }
        });
        let mut auto_reply = Vec::new();
        handle_agent_request(&mut auto_reply, &read, &cwd, ToolAccess::Auto, &mut |_| {}).unwrap();
        assert!(String::from_utf8(auto_reply)
            .unwrap()
            .contains("outside the worktree"));

        let mut full_reply = Vec::new();
        handle_agent_request(
            &mut full_reply,
            &read,
            &cwd,
            ToolAccess::FullAccess,
            &mut |_| {},
        )
        .unwrap();
        assert!(String::from_utf8(full_reply).unwrap().contains("secret"));

        let write = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "fs/write_text_file",
            "params": { "path": "../created.txt", "content": "created" }
        });
        let mut auto_reply = Vec::new();
        handle_agent_request(&mut auto_reply, &write, &cwd, ToolAccess::Auto, &mut |_| {}).unwrap();
        assert!(!root.join("created.txt").exists());

        let inside_write = json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "fs/write_text_file",
            "params": { "path": "nested/new.txt", "content": "inside" }
        });
        let mut inside_reply = Vec::new();
        handle_agent_request(
            &mut inside_reply,
            &inside_write,
            &cwd,
            ToolAccess::Auto,
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(cwd.join("nested/new.txt")).unwrap(),
            "inside"
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;

            let dangling_target = root.join("missing-target.txt");
            symlink(&dangling_target, cwd.join("dangling.txt")).unwrap();
            let dangling_write = json!({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "fs/write_text_file",
                "params": { "path": "dangling.txt", "content": "escape" }
            });
            let mut reply = Vec::new();
            handle_agent_request(
                &mut reply,
                &dangling_write,
                &cwd,
                ToolAccess::Auto,
                &mut |_| {},
            )
            .unwrap();
            assert!(String::from_utf8(reply)
                .unwrap()
                .contains("cannot resolve file path"));
            assert!(!dangling_target.exists());

            let outside_dir = root.join("outside-dir");
            std::fs::create_dir_all(&outside_dir).unwrap();
            symlink(&outside_dir, cwd.join("outside-link")).unwrap();
            symlink(cwd.join("outside-link"), cwd.join("link-chain")).unwrap();
            let chain_write = json!({
                "jsonrpc": "2.0",
                "id": 5,
                "method": "fs/write_text_file",
                "params": { "path": "link-chain/escaped.txt", "content": "escape" }
            });
            let mut reply = Vec::new();
            handle_agent_request(
                &mut reply,
                &chain_write,
                &cwd,
                ToolAccess::Auto,
                &mut |_| {},
            )
            .unwrap();
            assert!(String::from_utf8(reply)
                .unwrap()
                .contains("outside the worktree"));
            assert!(!outside_dir.join("escaped.txt").exists());
        }

        let mut full_reply = Vec::new();
        handle_agent_request(
            &mut full_reply,
            &write,
            &cwd,
            ToolAccess::FullAccess,
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("created.txt")).unwrap(),
            "created"
        );

        std::fs::remove_dir_all(root).unwrap();
    }
}
