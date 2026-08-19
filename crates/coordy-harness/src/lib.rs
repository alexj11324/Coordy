//! Agent harness adapters. The kernel consumes `HarnessEvent` only.

mod acp;
mod children;
mod discovery;
mod native;
mod protocol;

pub use acp::{
    drive_session, map_session_update, resolve_acp_command, serve_fake_acp, spawn_acp_session,
    ACP_STUB_REPLY,
};
pub use children::{kill_child, register_child, unregister_child};
pub use discovery::{
    discover, extra_bin_dirs, resolve_launch, suggested_acp_stub_command, which_bin,
};
pub use native::{parse_native_line, spawn_native_session};
pub use protocol::{
    append_cli_args, builtin, canonical_harness_id, display_args, native_launch_args,
    parse_tool_access, protocol_family, BuiltinHarness, ProtocolFamily, ToolAccess, BUILTINS,
};

use coordy_protocol::{CoordyError, HarnessEvent, RunSource};
use serde::Deserialize;

use crate::protocol::resolve_builtin_bin;

#[derive(Clone, Debug, Default)]
pub struct SecretEnv {
    pub provider: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub acp_command: Option<String>,
}

impl SecretEnv {
    pub fn env_pairs(&self) -> Vec<(String, String)> {
        let mut out = Vec::new();
        if let Some(key) = &self.api_key {
            out.push(("COORDY_ADVISOR_API_KEY".into(), key.clone()));
            match self.provider.as_str() {
                "anthropic" => out.push(("ANTHROPIC_API_KEY".into(), key.clone())),
                _ => out.push(("OPENAI_API_KEY".into(), key.clone())),
            }
        }
        if let Some(url) = &self.base_url {
            out.push(("COORDY_ADVISOR_BASE_URL".into(), url.clone()));
            out.push(("OPENAI_BASE_URL".into(), url.clone()));
        }
        out
    }
}

#[derive(Clone, Debug)]
pub struct DetectedHarness {
    pub kind: String,
    pub binary: String,
}

pub fn detect_on_path() -> Vec<DetectedHarness> {
    let mut found = Vec::new();
    for spec in BUILTINS {
        if let Some(path) = spec.bins.iter().find_map(|name| which_bin(name)) {
            found.push(DetectedHarness {
                kind: spec.id.into(),
                binary: path.display().to_string(),
            });
        }
    }
    found
}

#[allow(clippy::too_many_arguments)]
pub fn spawn_command(
    kind: &str,
    worktree: &str,
    prompt: &str,
    model: &str,
    thinking: &str,
    speed: &str,
    cli_args: &str,
    tool_access: &str,
) -> Result<std::process::Command, CoordyError> {
    let family = protocol_family(kind);
    if family.uses_acp() {
        return Err(CoordyError::invalid(format!(
            "unknown native harness {kind}"
        )));
    }
    let bin = resolve_builtin_bin(kind).ok_or_else(|| {
        CoordyError::unavailable(format!("{} is not installed", canonical_harness_id(kind)))
    })?;
    let mut cmd = std::process::Command::new(bin);
    cmd.current_dir(worktree);
    let mut args = native_launch_args(family, prompt, model, thinking, speed, tool_access);
    crate::protocol::append_cli_args(family, parse_tool_access(tool_access), &mut args, cli_args)?;
    cmd.args(args);
    Ok(cmd)
}

#[derive(Deserialize)]
struct CodexLine {
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    item: Option<serde_json::Value>,
}

pub fn parse_codex_jsonl_line(line: &str) -> Option<HarnessEvent> {
    let parsed: CodexLine = serde_json::from_str(line).ok()?;
    match parsed.r#type.as_str() {
        "item.completed" => {
            let item = parsed.item?;
            let kind = item.get("type")?.as_str()?;
            if kind.contains("compaction") || kind == "compaction" {
                let summary = item
                    .get("text")
                    .or_else(|| item.get("summary"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                return Some(HarnessEvent::Compaction { summary });
            }
            if kind == "agent_message" || kind == "message" {
                let content = item
                    .get("text")
                    .or_else(|| item.get("content"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                return Some(HarnessEvent::Message {
                    role: "assistant".into(),
                    content,
                });
            }
            None
        }
        "compaction" => Some(HarnessEvent::Compaction {
            summary: line.into(),
        }),
        _ => None,
    }
}

pub fn source_kind(source: &RunSource) -> &'static str {
    match source {
        RunSource::Jsonl { .. } | RunSource::Fixture { .. } => "jsonl",
        RunSource::Codex { .. } => "codex",
        RunSource::ClaudeCode { .. } => "claude",
        RunSource::OpenCode { .. } => "opencode",
        RunSource::Acp { .. } => "acp",
    }
}
