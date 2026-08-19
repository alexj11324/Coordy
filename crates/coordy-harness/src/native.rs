//! Native (non-ACP) CLI adapters. Parse each vendor's stdout dialect into
//! `HarnessEvent`. Does not talk to the kernel.

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

use coordy_protocol::{CoordyError, HarnessEvent};
use serde_json::Value;

use crate::protocol::{native_launch_args, protocol_family, resolve_builtin_bin, ProtocolFamily};
use crate::{parse_codex_jsonl_line, SecretEnv};

pub fn spawn_native_session(
    kind: &str,
    worktree: &str,
    prompt: &str,
    model: &str,
    thinking: &str,
    speed: &str,
    secrets: &SecretEnv,
    run_id: Option<&str>,
    mut on_event: impl FnMut(HarnessEvent),
) -> Result<(), CoordyError> {
    let family = protocol_family(kind);
    if family.uses_acp() {
        return Err(CoordyError::invalid(format!(
            "`{kind}` is an ACP family harness"
        )));
    }
    let bin = resolve_builtin_bin(kind)
        .ok_or_else(|| CoordyError::unavailable(format!("{kind} is not installed")))?;
    let mut cmd = Command::new(&bin);
    cmd.args(native_launch_args(family, prompt, model, thinking, speed))
        .current_dir(if worktree.is_empty() { "." } else { worktree })
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in secrets.env_pairs() {
        cmd.env(key, value);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| CoordyError::unavailable(format!("spawn `{kind}`: {e}")))?;
    if let Some(run_id) = run_id {
        crate::children::register_child(run_id, child.id());
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CoordyError::unavailable(format!("{kind} stdout")))?;
    let stderr_thread = child.stderr.take().map(|mut stderr| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = std::io::copy(&mut stderr, &mut buf);
            buf
        })
    });
    let mut any = false;
    let mut raw = String::new();
    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|e| CoordyError::unavailable(format!("{kind} read: {e}")))?;
        raw.push_str(&line);
        raw.push('\n');
        if let Some(event) = parse_native_line(family, &line) {
            any = true;
            on_event(event);
        } else if !family.uses_jsonl() && !line.trim().is_empty() {
            any = true;
            on_event(HarnessEvent::Message {
                role: "assistant".into(),
                content: line,
            });
        }
    }
    let status = child
        .wait()
        .map_err(|e| CoordyError::unavailable(format!("wait `{kind}`: {e}")))?;
    let stderr_buf = stderr_thread
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    if let Some(run_id) = run_id {
        crate::children::unregister_child(run_id);
    }
    if !any {
        let stderr = String::from_utf8_lossy(&stderr_buf);
        let text = if raw.trim().is_empty() {
            stderr.into_owned()
        } else {
            raw
        };
        if !text.trim().is_empty() {
            on_event(HarnessEvent::Message {
                role: "assistant".into(),
                content: text,
            });
        }
    }
    if !status.success() {
        let stderr = String::from_utf8_lossy(&stderr_buf);
        return Err(CoordyError::unavailable(format!(
            "{kind} exited {}{}",
            status,
            if stderr.trim().is_empty() {
                String::new()
            } else {
                format!(": {}", stderr.trim())
            }
        )));
    }
    Ok(())
}

pub fn parse_native_line(family: ProtocolFamily, line: &str) -> Option<HarnessEvent> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    match family {
        ProtocolFamily::Codex => parse_codex_jsonl_line(line),
        ProtocolFamily::Claude | ProtocolFamily::Cursor | ProtocolFamily::Copilot => {
            parse_stream_json_line(line)
        }
        ProtocolFamily::OpenCode
        | ProtocolFamily::Gemini
        | ProtocolFamily::Acp
        | ProtocolFamily::Stub => None,
    }
}

fn parse_stream_json_line(line: &str) -> Option<HarnessEvent> {
    let parsed: Value = serde_json::from_str(line).ok()?;
    let kind = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match kind {
        "assistant" | "agent_message" | "message" => {
            if let Some(event) = content_event(parsed.get("message").unwrap_or(&parsed)) {
                return Some(event);
            }
            text_from(&parsed).map(|content| HarnessEvent::Message {
                role: "assistant".into(),
                content,
            })
        }
        "tool_use" | "tool_call" | "tool_call_started" => Some(HarnessEvent::Tool {
            name: tool_name(&parsed),
            input: parsed
                .get("input")
                .or_else(|| parsed.pointer("/tool_call/args"))
                .or_else(|| parsed.get("args"))
                .map(|v| v.to_string())
                .unwrap_or_default(),
            output: String::new(),
            exit_code: None,
        }),
        "tool_result" | "tool_call_completed" => Some(HarnessEvent::Tool {
            name: tool_name(&parsed),
            input: String::new(),
            output: text_from(&parsed).unwrap_or_else(|| parsed.to_string()),
            exit_code: None,
        }),
        "user" => content_event(parsed.get("message").unwrap_or(&parsed))
            .filter(|event| matches!(event, HarnessEvent::Tool { .. })),
        "result" => None,
        _ => text_from(&parsed).map(|content| HarnessEvent::Message {
            role: "assistant".into(),
            content,
        }),
    }
}

fn content_event(node: &Value) -> Option<HarnessEvent> {
    let content = node.get("content")?;
    if let Some(text) = content.as_str() {
        if text.is_empty() {
            return None;
        }
        return Some(HarnessEvent::Message {
            role: "assistant".into(),
            content: text.to_string(),
        });
    }
    let items = content.as_array()?;
    let mut texts = Vec::new();
    for item in items {
        match item.get("type").and_then(|v| v.as_str()).unwrap_or("") {
            "text" => {
                if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                    if !text.is_empty() {
                        texts.push(text.to_string());
                    }
                }
            }
            "thinking" => {
                if let Some(text) = item
                    .get("thinking")
                    .or_else(|| item.get("text"))
                    .and_then(|v| v.as_str())
                {
                    if !text.is_empty() {
                        texts.push(format!("thinking: {text}"));
                    }
                }
            }
            "tool_use" => {
                return Some(HarnessEvent::Tool {
                    name: item
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("tool")
                        .to_string(),
                    input: item.get("input").map(|v| v.to_string()).unwrap_or_default(),
                    output: String::new(),
                    exit_code: None,
                });
            }
            "tool_result" => {
                return Some(HarnessEvent::Tool {
                    name: "tool".into(),
                    input: String::new(),
                    output: item
                        .get("content")
                        .map(|v| match v {
                            Value::String(s) => s.clone(),
                            other => other.to_string(),
                        })
                        .unwrap_or_default(),
                    exit_code: None,
                });
            }
            _ => {}
        }
    }
    if texts.is_empty() {
        None
    } else {
        Some(HarnessEvent::Message {
            role: "assistant".into(),
            content: texts.join(""),
        })
    }
}

fn tool_name(parsed: &Value) -> String {
    parsed
        .get("name")
        .or_else(|| parsed.pointer("/tool_call/name"))
        .or_else(|| parsed.get("title"))
        .and_then(|v| v.as_str())
        .unwrap_or("tool")
        .to_string()
}

fn text_from(parsed: &Value) -> Option<String> {
    parsed
        .get("text")
        .or_else(|| parsed.get("result"))
        .or_else(|| parsed.get("content"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            parsed
                .get("delta")
                .and_then(|d| d.get("text"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .filter(|s| !s.is_empty())
        })
}
