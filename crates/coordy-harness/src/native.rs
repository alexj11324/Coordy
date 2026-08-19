//! Native (non-ACP) CLI adapters. Parse each vendor's stdout dialect into
//! `HarnessEvent`. Does not talk to the kernel.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

use coordy_protocol::{CoordyError, HarnessEvent};
use serde_json::Value;

use crate::protocol::{
    append_cli_args, native_launch_args, parse_tool_access, protocol_family, resolve_builtin_bin,
    ProtocolFamily,
};
use crate::{parse_codex_jsonl_line, SecretEnv};

#[allow(clippy::too_many_arguments)]
pub fn spawn_native_session(
    kind: &str,
    worktree: &str,
    prompt: &str,
    model: &str,
    thinking: &str,
    speed: &str,
    cli_args: &str,
    tool_access: &str,
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
    if family == ProtocolFamily::Codex {
        return spawn_codex_app_server(
            kind,
            worktree,
            prompt,
            model,
            thinking,
            speed,
            cli_args,
            tool_access,
            secrets,
            run_id,
            on_event,
        );
    }
    if family == ProtocolFamily::Dsh {
        return spawn_dsh_session(
            kind,
            worktree,
            prompt,
            model,
            thinking,
            cli_args,
            tool_access,
            secrets,
            run_id,
            on_event,
        );
    }
    let bin = resolve_builtin_bin(kind)
        .ok_or_else(|| CoordyError::unavailable(format!("{kind} is not installed")))?;
    let mut args = native_launch_args(family, prompt, model, thinking, speed, tool_access);
    let pi_session = if family == ProtocolFamily::Pi {
        let path = std::env::temp_dir().join(format!(
            "coordy-{}-{}-{}.jsonl",
            kind,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::File::create(&path)
            .map_err(|e| CoordyError::unavailable(format!("create Pi session file: {e}")))?;
        args.splice(3..3, ["--session".to_string(), path.display().to_string()]);
        Some(path)
    } else {
        None
    };
    let antigravity_log = if family == ProtocolFamily::Antigravity {
        let path = std::env::temp_dir().join(format!(
            "coordy-agy-{}-{}.log",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::File::create(&path)
            .map_err(|e| CoordyError::unavailable(format!("create Antigravity log: {e}")))?;
        args.extend([
            "--print-timeout".to_string(),
            "24h0m0s".to_string(),
            "--log-file".to_string(),
            path.display().to_string(),
        ]);
        if !worktree.is_empty() {
            args.extend(["--add-dir".to_string(), worktree.to_string()]);
        }
        Some(path)
    } else {
        None
    };
    if let Err(error) = append_cli_args(family, parse_tool_access(tool_access), &mut args, cli_args)
    {
        cleanup_native_temp(&pi_session, &antigravity_log);
        return Err(error);
    }
    let mut cmd = Command::new(&bin);
    cmd.args(args)
        .current_dir(if worktree.is_empty() { "." } else { worktree })
        .stdin(if family.prompt_on_stdin() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in secrets.env_pairs() {
        cmd.env(key, value);
    }
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            cleanup_native_temp(&pi_session, &antigravity_log);
            return Err(CoordyError::unavailable(format!("spawn `{kind}`: {error}")));
        }
    };
    if family.prompt_on_stdin() {
        let write_result = (|| -> Result<(), CoordyError> {
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| CoordyError::unavailable(format!("{kind} stdin")))?;
            let payload = match family {
                ProtocolFamily::Claude | ProtocolFamily::CodeBuddy => serde_json::json!({
                    "type": "user",
                    "message": {
                        "role": "user",
                        "content": [{ "type": "text", "text": prompt }]
                    }
                })
                .to_string(),
                _ => prompt.to_string(),
            };
            writeln!(stdin, "{payload}")
                .map_err(|e| CoordyError::unavailable(format!("{kind} stdin write: {e}")))
        })();
        if let Err(error) = write_result {
            let _ = child.kill();
            let _ = child.wait();
            cleanup_native_temp(&pi_session, &antigravity_log);
            return Err(error);
        }
    }
    if let Some(run_id) = run_id {
        crate::children::register_child(run_id, child.id());
    }
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            if let Some(run_id) = run_id {
                crate::children::unregister_child(run_id);
            }
            let _ = child.kill();
            let _ = child.wait();
            cleanup_native_temp(&pi_session, &antigravity_log);
            return Err(CoordyError::unavailable(format!("{kind} stdout")));
        }
    };
    let stderr_thread = child.stderr.take().map(|mut stderr| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = std::io::copy(&mut stderr, &mut buf);
            buf
        })
    });
    let mut any = false;
    let mut terminal = false;
    let mut raw = String::new();
    let mut stream_error = None;
    for line in BufReader::new(stdout).lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                stream_error = Some(CoordyError::unavailable(format!("{kind} read: {error}")));
                break;
            }
        };
        raw.push_str(&line);
        raw.push('\n');
        if family == ProtocolFamily::OpenClaw {
            match serde_json::from_str::<Value>(&raw) {
                Ok(value) => {
                    terminal = true;
                    if let Some(event) = parse_whole_json_value(&value) {
                        any = true;
                        on_event(event);
                    } else {
                        stream_error = Some(CoordyError::invalid(
                            "openclaw returned no successful result payload",
                        ));
                    }
                    break;
                }
                Err(error) if error.is_eof() => continue,
                Err(_) => {
                    stream_error = Some(CoordyError::invalid(
                        "openclaw emitted malformed result JSON",
                    ));
                    break;
                }
            }
        }
        let parsed = if family.expects_structured_output() && !line.trim().is_empty() {
            match serde_json::from_str::<Value>(&line) {
                Ok(value) => Some(value),
                Err(_) => {
                    stream_error = Some(CoordyError::invalid(format!(
                        "{kind} emitted malformed {} output",
                        family.as_str()
                    )));
                    break;
                }
            }
        } else {
            None
        };
        if let Some(value) = parsed.as_ref() {
            match native_terminal(family, value, kind) {
                Ok(is_terminal) => terminal |= is_terminal,
                Err(error) => {
                    stream_error = Some(error);
                    break;
                }
            }
        }
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
    let completed_by_protocol = family == ProtocolFamily::OpenClaw && terminal;
    if stream_error.is_some() || completed_by_protocol {
        let _ = child.kill();
    }
    let status = match child.wait() {
        Ok(status) => status,
        Err(error) => {
            if let Some(run_id) = run_id {
                crate::children::unregister_child(run_id);
            }
            cleanup_native_temp(&pi_session, &antigravity_log);
            return Err(CoordyError::unavailable(format!("wait `{kind}`: {error}")));
        }
    };
    let stderr_buf = stderr_thread
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    if let Some(run_id) = run_id {
        crate::children::unregister_child(run_id);
    }
    let antigravity_log_error = antigravity_log
        .as_ref()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|log| {
            if log.contains("Print mode: timed out after") {
                return Some(CoordyError::unavailable(
                    "antigravity print timeout elapsed before a final response",
                ));
            }
            log.lines()
                .filter_map(|line| {
                    line.split_once("agent executor error:")
                        .map(|(_, detail)| detail.trim())
                })
                .rfind(|detail| !detail.is_empty())
                .map(|detail| {
                    CoordyError::unavailable(format!("antigravity provider error: {detail}"))
                })
        });
    cleanup_native_temp(&pi_session, &antigravity_log);
    if let Some(error) = stream_error {
        return Err(error);
    }
    if let Some(error) = antigravity_log_error {
        return Err(error);
    }
    if !status.success() && !completed_by_protocol {
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
    if !any && (family.expects_structured_output() || family == ProtocolFamily::Antigravity) {
        return Err(CoordyError::invalid(format!(
            "{kind} produced no valid {} events",
            family.as_str()
        )));
    }
    if family.expects_structured_output() && !terminal {
        return Err(CoordyError::invalid(format!(
            "{kind} closed without a terminal {} event",
            family.as_str()
        )));
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
    Ok(())
}

fn cleanup_native_temp(
    pi_session: &Option<std::path::PathBuf>,
    antigravity_log: &Option<std::path::PathBuf>,
) {
    for path in [pi_session, antigravity_log].into_iter().flatten() {
        let _ = std::fs::remove_file(path);
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_codex_app_server(
    kind: &str,
    worktree: &str,
    prompt: &str,
    model: &str,
    thinking: &str,
    speed: &str,
    cli_args: &str,
    tool_access: &str,
    secrets: &SecretEnv,
    run_id: Option<&str>,
    mut on_event: impl FnMut(HarnessEvent),
) -> Result<(), CoordyError> {
    let bin = resolve_builtin_bin(kind)
        .ok_or_else(|| CoordyError::unavailable(format!("{kind} is not installed")))?;
    let mut args = native_launch_args(
        ProtocolFamily::Codex,
        prompt,
        model,
        thinking,
        speed,
        tool_access,
    );
    append_cli_args(
        ProtocolFamily::Codex,
        parse_tool_access(tool_access),
        &mut args,
        cli_args,
    )?;
    let mut cmd = Command::new(&bin);
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
        .map_err(|e| CoordyError::unavailable(format!("spawn `{kind}` app-server: {e}")))?;
    if let Some(run_id) = run_id {
        crate::children::register_child(run_id, child.id());
    }
    let stderr_thread = child.stderr.take().map(|mut stderr| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = std::io::copy(&mut stderr, &mut buf);
            buf
        })
    });
    let result = (|| -> Result<(), CoordyError> {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| CoordyError::unavailable("codex app-server stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| CoordyError::unavailable("codex app-server stdout"))?;
        let mut lines = BufReader::new(stdout);
        write_json_line(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc":"2.0", "id":1, "method":"initialize",
                "params":{"clientInfo":{"name":"coordy","version":env!("CARGO_PKG_VERSION")}}
            }),
            "codex initialize",
        )?;
        let _ = read_json_rpc_response(&mut lines, 1, kind, &mut on_event)?;
        write_json_line(
            &mut stdin,
            &serde_json::json!({"jsonrpc":"2.0","method":"initialized","params":{}}),
            "codex initialized",
        )?;
        let (sandbox, approval_policy) = match parse_tool_access(tool_access) {
            // Auto is deliberately non-interactive and fail-closed. The workspace
            // sandbox may execute allowed operations, while escape/network approval
            // requests are denied instead of being silently escalated by Coordy.
            crate::protocol::ToolAccess::Auto => ("workspace-write", "never"),
            crate::protocol::ToolAccess::FullAccess => ("danger-full-access", "never"),
        };
        write_json_line(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc":"2.0", "id":2, "method":"thread/start",
                "params":{
                    "cwd":worktree,"model":model,"reasoningEffort":thinking,"serviceTier":speed,
                    "sandbox":sandbox,"approvalPolicy":approval_policy
                }
            }),
            "codex thread/start",
        )?;
        let thread = read_json_rpc_response(&mut lines, 2, kind, &mut on_event)?;
        let thread_id = thread
            .pointer("/result/thread/id")
            .or_else(|| thread.pointer("/result/threadId"))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| CoordyError::invalid("codex thread/start returned no thread id"))?;
        write_json_line(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc":"2.0", "id":3, "method":"turn/start",
                "params":{"threadId":thread_id,"input":[{"type":"text","text":prompt}]}
            }),
            "codex turn/start",
        )?;
        let started = read_json_rpc_response(&mut lines, 3, kind, &mut on_event)?;
        let turn_id = started
            .pointer("/result/turn/id")
            .or_else(|| started.pointer("/result/turnId"))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| CoordyError::invalid("codex turn/start returned no turn id"))?;
        drive_codex_turn(
            &mut lines,
            &mut stdin,
            turn_id,
            kind,
            parse_tool_access(tool_access),
            &mut on_event,
        )
    })();

    if let Some(run_id) = run_id {
        crate::children::unregister_child(run_id);
    }
    let pre_cleanup_status = child.try_wait().ok().flatten();
    if pre_cleanup_status.is_none() {
        let _ = child.kill();
    }
    let _ = child.wait();
    let stderr = stderr_thread
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    match result {
        Err(error) if !stderr.is_empty() => Err(CoordyError::unavailable(format!(
            "{}: {}",
            error.message,
            String::from_utf8_lossy(&stderr).trim()
        ))),
        Err(error) => Err(error),
        Ok(()) if pre_cleanup_status.is_some_and(|status| !status.success()) => Err(
            CoordyError::unavailable(format!("{kind} exited {}", pre_cleanup_status.unwrap())),
        ),
        Ok(()) => Ok(()),
    }
}

fn drive_codex_turn(
    lines: &mut impl BufRead,
    writer: &mut impl Write,
    turn_id: &str,
    kind: &str,
    access: crate::protocol::ToolAccess,
    on_event: &mut impl FnMut(HarnessEvent),
) -> Result<(), CoordyError> {
    let mut line = String::new();
    let mut emitted_delta = false;
    loop {
        line.clear();
        if lines
            .read_line(&mut line)
            .map_err(|e| CoordyError::unavailable(format!("{kind} read: {e}")))?
            == 0
        {
            return Err(CoordyError::unavailable(format!(
                "{kind} closed before turn/completed"
            )));
        }
        let value: Value = serde_json::from_str(line.trim())
            .map_err(|e| CoordyError::invalid(format!("{kind} JSON-RPC: {e}")))?;
        if value.get("id").is_some() && value.get("method").is_some() {
            handle_codex_request(writer, &value, access)?;
            continue;
        }
        match value.get("method").and_then(Value::as_str).unwrap_or("") {
            "item/agentMessage/delta" => {
                if let Some(text) = value.pointer("/params/delta").and_then(Value::as_str) {
                    if !text.is_empty() {
                        emitted_delta = true;
                        on_event(HarnessEvent::Message {
                            role: "assistant".into(),
                            content: text.into(),
                        });
                    }
                }
            }
            "item/completed" if !emitted_delta => {
                if value.pointer("/params/item/type").and_then(Value::as_str)
                    == Some("agentMessage")
                {
                    if let Some(text) = value
                        .pointer("/params/item/text")
                        .and_then(Value::as_str)
                        .filter(|text| !text.is_empty())
                    {
                        on_event(HarnessEvent::Message {
                            role: "assistant".into(),
                            content: text.into(),
                        });
                    }
                }
            }
            "turn/completed" => {
                let completed_id = value
                    .pointer("/params/turn/id")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if completed_id != turn_id {
                    continue;
                }
                let status = value
                    .pointer("/params/turn/status")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if status != "completed" {
                    let detail = value
                        .pointer("/params/turn/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or(status);
                    return Err(CoordyError::unavailable(format!(
                        "{kind} turn {status}: {detail}"
                    )));
                }
                return Ok(());
            }
            "error" => {
                return Err(CoordyError::unavailable(format!(
                    "{kind} app-server error: {}",
                    value.get("params").unwrap_or(&Value::Null)
                )));
            }
            _ => {}
        }
    }
}

fn handle_codex_request(
    writer: &mut impl Write,
    request: &Value,
    access: crate::protocol::ToolAccess,
) -> Result<(), CoordyError> {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    let decision = match (method, access) {
        (
            "item/commandExecution/requestApproval" | "item/fileChange/requestApproval",
            crate::protocol::ToolAccess::Auto,
        ) => "decline",
        (
            "item/commandExecution/requestApproval" | "item/fileChange/requestApproval",
            crate::protocol::ToolAccess::FullAccess,
        ) => "acceptForSession",
        _ => {
            write_json_line(
                writer,
                &serde_json::json!({
                    "jsonrpc":"2.0", "id":id,
                    "error":{"code":-32601,"message":format!("unsupported request {method}")}
                }),
                "codex request rejection",
            )?;
            return Err(CoordyError::unavailable(format!(
                "codex app-server requested unsupported method {method}"
            )));
        }
    };
    write_json_line(
        writer,
        &serde_json::json!({"jsonrpc":"2.0","id":id,"result":{"decision":decision}}),
        "codex approval response",
    )
}

fn write_json_line(
    writer: &mut impl Write,
    value: &Value,
    context: &str,
) -> Result<(), CoordyError> {
    writeln!(writer, "{value}")
        .and_then(|_| writer.flush())
        .map_err(|e| CoordyError::unavailable(format!("{context}: {e}")))
}

fn read_json_rpc_response(
    lines: &mut impl BufRead,
    expected_id: u64,
    kind: &str,
    on_event: &mut impl FnMut(HarnessEvent),
) -> Result<Value, CoordyError> {
    let mut line = String::new();
    loop {
        line.clear();
        if lines
            .read_line(&mut line)
            .map_err(|e| CoordyError::unavailable(format!("{kind} read: {e}")))?
            == 0
        {
            return Err(CoordyError::unavailable(format!(
                "{kind} closed before JSON-RPC response {expected_id}"
            )));
        }
        let value: Value = serde_json::from_str(line.trim())
            .map_err(|e| CoordyError::invalid(format!("{kind} JSON-RPC: {e}")))?;
        if value.get("id").and_then(Value::as_u64) == Some(expected_id) {
            if let Some(error) = value.get("error") {
                return Err(CoordyError::unavailable(format!(
                    "{kind} JSON-RPC error: {error}"
                )));
            }
            return Ok(value);
        }
        if let Some(text) = value
            .pointer("/params/item/text")
            .or_else(|| value.pointer("/params/delta/text"))
            .or_else(|| value.pointer("/params/message/text"))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        {
            on_event(HarnessEvent::Message {
                role: "assistant".into(),
                content: text.into(),
            });
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_dsh_session(
    kind: &str,
    worktree: &str,
    prompt: &str,
    model: &str,
    thinking: &str,
    cli_args: &str,
    tool_access: &str,
    secrets: &SecretEnv,
    run_id: Option<&str>,
    mut on_event: impl FnMut(HarnessEvent),
) -> Result<(), CoordyError> {
    let bin = resolve_builtin_bin(kind)
        .ok_or_else(|| CoordyError::unavailable(format!("{kind} is not installed")))?;
    let probe = Command::new(&bin)
        .args(["--profile", "multica", "--probe"])
        .output()
        .map_err(|e| CoordyError::unavailable(format!("dsh probe: {e}")))?;
    if !probe.status.success() {
        return Err(CoordyError::unavailable(format!(
            "dsh probe exited {}",
            probe.status
        )));
    }
    let proof: Value = serde_json::from_slice(&probe.stdout)
        .map_err(|e| CoordyError::invalid(format!("dsh probe JSON: {e}")))?;
    let protocol = proof
        .get("protocolVersion")
        .or_else(|| proof.get("protocol_version"))
        .and_then(Value::as_u64);
    if proof.get("runtime").and_then(Value::as_str) != Some("dsh") || protocol != Some(1) {
        return Err(CoordyError::invalid(
            "dsh probe did not prove protocol version 1",
        ));
    }

    let mut args = native_launch_args(
        ProtocolFamily::Dsh,
        prompt,
        model,
        thinking,
        "",
        tool_access,
    );
    append_cli_args(
        ProtocolFamily::Dsh,
        parse_tool_access(tool_access),
        &mut args,
        cli_args,
    )?;
    let mut cmd = Command::new(&bin);
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
        .map_err(|e| CoordyError::unavailable(format!("spawn dsh: {e}")))?;
    if let Some(run_id) = run_id {
        crate::children::register_child(run_id, child.id());
    }
    let stderr_thread = child.stderr.take().map(|mut stderr| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = std::io::copy(&mut stderr, &mut buf);
            buf
        })
    });
    let result = (|| -> Result<(), CoordyError> {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| CoordyError::unavailable("dsh stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| CoordyError::unavailable("dsh stdout"))?;
        let mut lines = BufReader::new(stdout);
        let mut line = String::new();
        lines
            .read_line(&mut line)
            .map_err(|e| CoordyError::unavailable(format!("dsh ready: {e}")))?;
        let ready: Value = serde_json::from_str(line.trim())
            .map_err(|e| CoordyError::invalid(format!("dsh ready JSON: {e}")))?;
        if ready.get("type").and_then(Value::as_str) != Some("ready") {
            return Err(CoordyError::invalid("dsh did not emit ready frame"));
        }
        write_json_line(
            &mut stdin,
            &serde_json::json!({
                "version":1,"type":"execute","id":"coordy",
                "prompt":prompt,"cwd":worktree,"model":model,"reasoningEffort":thinking
            }),
            "dsh execute",
        )?;
        loop {
            line.clear();
            if lines
                .read_line(&mut line)
                .map_err(|e| CoordyError::unavailable(format!("dsh read: {e}")))?
                == 0
            {
                return Err(CoordyError::invalid("dsh closed without result frame"));
            }
            let frame: Value = serde_json::from_str(line.trim())
                .map_err(|e| CoordyError::invalid(format!("dsh frame JSON: {e}")))?;
            match frame.get("type").and_then(Value::as_str).unwrap_or("") {
                "text" | "thinking" => {
                    if let Some(text) = frame.get("text").and_then(Value::as_str) {
                        on_event(HarnessEvent::Message {
                            role: "assistant".into(),
                            content: text.into(),
                        });
                    }
                }
                "result" => return Ok(()),
                "error" => {
                    return Err(CoordyError::unavailable(format!("dsh error: {frame}")));
                }
                _ => {}
            }
        }
    })();
    if let Some(run_id) = run_id {
        crate::children::unregister_child(run_id);
    }
    let pre_cleanup_status = child.try_wait().ok().flatten();
    if pre_cleanup_status.is_none() {
        let _ = child.kill();
    }
    let _ = child.wait();
    let stderr = stderr_thread
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    match result {
        Err(error) if !stderr.is_empty() => Err(CoordyError::unavailable(format!(
            "{}: {}",
            error.message,
            String::from_utf8_lossy(&stderr).trim()
        ))),
        Err(error) => Err(error),
        Ok(()) if pre_cleanup_status.is_some_and(|status| !status.success()) => Err(
            CoordyError::unavailable(format!("dsh exited {}", pre_cleanup_status.unwrap())),
        ),
        Ok(()) => Ok(()),
    }
}

pub fn parse_native_line(family: ProtocolFamily, line: &str) -> Option<HarnessEvent> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    match family {
        ProtocolFamily::Codex => parse_codex_jsonl_line(line),
        ProtocolFamily::Claude | ProtocolFamily::CodeBuddy | ProtocolFamily::Qwen => {
            parse_stream_json_line(line)
        }
        ProtocolFamily::Copilot => parse_copilot_line(line),
        ProtocolFamily::OpenCode | ProtocolFamily::DevEco => parse_opencode_line(line),
        ProtocolFamily::Pi => parse_pi_line(line),
        ProtocolFamily::Cursor => parse_cursor_line(line),
        ProtocolFamily::OpenClaw => parse_whole_json_line(line),
        ProtocolFamily::Gemini
        | ProtocolFamily::Antigravity
        | ProtocolFamily::Dsh
        | ProtocolFamily::Acp
        | ProtocolFamily::Stub => None,
    }
}

fn parse_whole_json_line(line: &str) -> Option<HarnessEvent> {
    let parsed: Value = serde_json::from_str(line).ok()?;
    parse_whole_json_value(&parsed)
}

fn parse_whole_json_value(parsed: &Value) -> Option<HarnessEvent> {
    let content = parsed
        .pointer("/result/payload/text")
        .or_else(|| parsed.pointer("/result/text"))
        .or_else(|| parsed.get("output"))
        .or_else(|| parsed.get("message"))
        .and_then(Value::as_str)?;
    if content.is_empty() {
        None
    } else {
        Some(HarnessEvent::Message {
            role: "assistant".into(),
            content: content.into(),
        })
    }
}

fn native_terminal(
    family: ProtocolFamily,
    value: &Value,
    kind_name: &str,
) -> Result<bool, CoordyError> {
    let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
    let error_text = || {
        value
            .pointer("/error/message")
            .or_else(|| value.pointer("/data/message"))
            .or_else(|| value.get("error"))
            .or_else(|| value.get("result"))
            .and_then(Value::as_str)
            .unwrap_or("provider reported failure")
    };
    match family {
        ProtocolFamily::Claude
        | ProtocolFamily::CodeBuddy
        | ProtocolFamily::Cursor
        | ProtocolFamily::Qwen => {
            if kind == "result"
                && (value.get("is_error").and_then(Value::as_bool) == Some(true)
                    || matches!(
                        value.get("subtype").and_then(Value::as_str),
                        Some("error" | "failed")
                    ))
            {
                return Err(CoordyError::unavailable(format!(
                    "{kind_name} result failed: {}",
                    error_text()
                )));
            }
            Ok(kind == "result")
        }
        ProtocolFamily::Copilot => {
            if kind == "session.error" {
                return Err(CoordyError::unavailable(format!(
                    "{kind_name} session failed: {}",
                    error_text()
                )));
            }
            let exit_code = value.get("exitCode").and_then(Value::as_i64).unwrap_or(0);
            if kind == "result" && exit_code != 0 {
                return Err(CoordyError::unavailable(format!(
                    "{kind_name} result exitCode {exit_code}"
                )));
            }
            Ok(kind == "result" || kind == "session.shutdown")
        }
        ProtocolFamily::OpenCode | ProtocolFamily::DevEco => Ok(kind == "step_finish"
            && value
                .get("reason")
                .or_else(|| value.pointer("/part/reason"))
                .and_then(Value::as_str)
                != Some("tool-calls")),
        ProtocolFamily::Pi => {
            if kind == "turn_end"
                && value.pointer("/message/stopReason").and_then(Value::as_str) == Some("error")
            {
                return Err(CoordyError::unavailable(format!(
                    "{kind_name} turn failed: {}",
                    value
                        .pointer("/message/errorMessage")
                        .and_then(Value::as_str)
                        .unwrap_or("provider error")
                )));
            }
            Ok(kind == "turn_end" || kind == "result")
        }
        ProtocolFamily::OpenClaw => Ok(true),
        _ => Ok(false),
    }
}

fn parse_copilot_line(line: &str) -> Option<HarnessEvent> {
    let event: Value = serde_json::from_str(line).ok()?;
    let kind = event.get("type").and_then(Value::as_str)?;
    let data = event.get("data").unwrap_or(&event);
    match kind {
        "assistant.message" => data
            .get("content")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(|content| HarnessEvent::Message {
                role: "assistant".into(),
                content: content.into(),
            })
            .or_else(|| {
                data.get("toolRequests")
                    .and_then(Value::as_array)
                    .and_then(|items| items.first())
                    .map(|tool| HarnessEvent::Tool {
                        name: tool
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                            .into(),
                        input: tool
                            .get("arguments")
                            .map(Value::to_string)
                            .unwrap_or_default(),
                        output: String::new(),
                        exit_code: None,
                    })
            }),
        "assistant.message_delta" => data
            .get("deltaContent")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(|content| HarnessEvent::Message {
                role: "assistant".into(),
                content: content.into(),
            }),
        "assistant.reasoning" | "assistant.reasoning_delta" => data
            .get("content")
            .or_else(|| data.get("deltaContent"))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(|content| HarnessEvent::Message {
                role: "assistant".into(),
                content: format!("thinking: {content}"),
            }),
        "tool.execution_complete" => Some(HarnessEvent::Tool {
            name: data
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .into(),
            input: String::new(),
            output: data
                .pointer("/result/content")
                .or_else(|| data.pointer("/error/message"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .into(),
            exit_code: data.get("success").and_then(Value::as_bool).map(|success| {
                if success {
                    0
                } else {
                    1
                }
            }),
        }),
        _ => None,
    }
}

fn parse_opencode_line(line: &str) -> Option<HarnessEvent> {
    let event: Value = serde_json::from_str(line).ok()?;
    match event.get("type").and_then(Value::as_str)? {
        "text" => event
            .pointer("/part/text")
            .or_else(|| event.get("text"))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(|content| HarnessEvent::Message {
                role: "assistant".into(),
                content: content.into(),
            }),
        "tool_use" => {
            let state = event.pointer("/part/state").unwrap_or(&Value::Null);
            Some(HarnessEvent::Tool {
                name: event
                    .pointer("/part/tool")
                    .or_else(|| event.pointer("/part/name"))
                    .and_then(Value::as_str)
                    .unwrap_or("tool")
                    .into(),
                input: state
                    .get("input")
                    .or_else(|| event.pointer("/part/input"))
                    .map(Value::to_string)
                    .unwrap_or_default(),
                output: state
                    .get("output")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
                exit_code: match state.get("status").and_then(Value::as_str) {
                    Some("completed") => Some(0),
                    Some("error") => Some(1),
                    _ => None,
                },
            })
        }
        _ => None,
    }
}

fn parse_pi_line(line: &str) -> Option<HarnessEvent> {
    let event: Value = serde_json::from_str(line).ok()?;
    match event.get("type").and_then(Value::as_str)? {
        "message_update" => {
            let update = event.get("assistantMessageEvent")?;
            let kind = update.get("type").and_then(Value::as_str)?;
            let text = update.get("delta").and_then(Value::as_str)?.trim();
            (!text.is_empty()).then(|| HarnessEvent::Message {
                role: "assistant".into(),
                content: if kind == "thinking_delta" {
                    format!("thinking: {text}")
                } else {
                    text.into()
                },
            })
        }
        "tool_execution_start" => Some(HarnessEvent::Tool {
            name: event
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .into(),
            input: event.get("args").map(Value::to_string).unwrap_or_default(),
            output: String::new(),
            exit_code: None,
        }),
        "tool_execution_end" => Some(HarnessEvent::Tool {
            name: event
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .into(),
            input: String::new(),
            output: event
                .get("result")
                .map(|result| match result {
                    Value::String(text) => text.clone(),
                    other => other.to_string(),
                })
                .unwrap_or_default(),
            exit_code: event.get("isError").and_then(Value::as_bool).map(|failed| {
                if failed {
                    1
                } else {
                    0
                }
            }),
        }),
        _ => None,
    }
}

fn parse_cursor_line(line: &str) -> Option<HarnessEvent> {
    let line = line
        .strip_prefix("stdout:")
        .or_else(|| line.strip_prefix("stderr:"))
        .unwrap_or(line)
        .trim();
    let event: Value = serde_json::from_str(line).ok()?;
    match event.get("type").and_then(Value::as_str)? {
        "thinking" if event.get("subtype").and_then(Value::as_str) == Some("delta") => event
            .get("text")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(|content| HarnessEvent::Message {
                role: "assistant".into(),
                content: format!("thinking: {content}"),
            }),
        "tool_call" => {
            let call = event.get("tool_call").unwrap_or(&event);
            let payload = call.as_object().and_then(|object| {
                object
                    .iter()
                    .filter(|(key, _)| key.ends_with("ToolCall"))
                    .min_by_key(|(key, _)| *key)
            });
            Some(HarnessEvent::Tool {
                name: payload
                    .map(|(key, _)| key.trim_end_matches("ToolCall"))
                    .or_else(|| call.get("name").and_then(Value::as_str))
                    .or_else(|| call.get("tool_name").and_then(Value::as_str))
                    .unwrap_or("tool")
                    .into(),
                input: payload
                    .and_then(|(_, value)| value.get("args"))
                    .or_else(|| call.get("args"))
                    .or_else(|| call.get("parameters"))
                    .map(Value::to_string)
                    .unwrap_or_default(),
                output: payload
                    .and_then(|(_, value)| value.get("result"))
                    .or_else(|| call.get("result"))
                    .or_else(|| call.get("output"))
                    .map(|result| match result {
                        Value::String(text) => text.clone(),
                        other => other.to_string(),
                    })
                    .unwrap_or_default(),
                exit_code: match event.get("subtype").and_then(Value::as_str) {
                    Some("completed") => Some(0),
                    _ => None,
                },
            })
        }
        _ => parse_stream_json_line(line),
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
            "text" | "output_text" => {
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
