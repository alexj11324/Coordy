//! Agent harness adapters. The kernel consumes `HarnessEvent` only.

use coordy_protocol::{CoordyError, HarnessEvent, RunSource};
use serde::Deserialize;

#[derive(Clone, Debug)]
pub struct DetectedHarness {
    pub kind: String,
    pub binary: String,
}

pub fn detect_on_path() -> Vec<DetectedHarness> {
    let mut found = Vec::new();
    for (kind, names) in [
        ("codex", &["codex"][..]),
        ("claude_code", &["claude", "claude-code"][..]),
        ("opencode", &["opencode"][..]),
    ] {
        for name in names {
            if which(name) {
                found.push(DetectedHarness {
                    kind: kind.into(),
                    binary: name.to_string(),
                });
                break;
            }
        }
    }
    found
}

fn which(name: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths).any(|dir| {
                let p = dir.join(name);
                p.is_file()
            })
        })
        .unwrap_or(false)
}

pub fn spawn_command(
    kind: &str,
    worktree: &str,
    prompt: &str,
) -> Result<std::process::Command, CoordyError> {
    let detected = detect_on_path();
    let bin = detected
        .iter()
        .find(|d| d.kind == kind)
        .ok_or_else(|| CoordyError::unavailable(format!("{kind} is not installed")))?;
    let mut cmd = std::process::Command::new(&bin.binary);
    cmd.current_dir(worktree);
    match kind {
        "codex" => {
            cmd.args(["exec", "--json", prompt]);
        }
        "claude_code" => {
            cmd.args(["-p", prompt]);
        }
        "opencode" => {
            cmd.args(["run", prompt]);
        }
        _ => return Err(CoordyError::invalid(format!("unknown harness {kind}"))),
    }
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
        RunSource::ClaudeCode { .. } => "claude_code",
        RunSource::OpenCode { .. } => "opencode",
    }
}
