//! Per-CLI protocol families. Coordy wraps each vendor CLI's native
//! headless interface; ACP is only used for the demo stub and ACP-registry agents.

use crate::which_bin;

/// How Coordy talks to a discovered harness.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtocolFamily {
    Claude,
    Codex,
    Copilot,
    OpenCode,
    Cursor,
    Gemini,
    Acp,
    Stub,
}

impl ProtocolFamily {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Copilot => "copilot",
            Self::OpenCode => "opencode",
            Self::Cursor => "cursor",
            Self::Gemini => "gemini",
            Self::Acp => "acp",
            Self::Stub => "stub",
        }
    }

    pub fn uses_jsonl(self) -> bool {
        matches!(
            self,
            Self::Claude | Self::Codex | Self::Copilot | Self::Cursor
        )
    }

    pub fn uses_acp(self) -> bool {
        matches!(self, Self::Acp | Self::Stub)
    }
}

pub struct BuiltinHarness {
    pub id: &'static str,
    pub name: &'static str,
    pub bins: &'static [&'static str],
    pub family: ProtocolFamily,
}

pub const BUILTINS: &[BuiltinHarness] = &[
    BuiltinHarness {
        id: "claude",
        name: "Claude Code",
        bins: &["claude", "claude-code"],
        family: ProtocolFamily::Claude,
    },
    BuiltinHarness {
        id: "codex",
        name: "Codex",
        bins: &["codex"],
        family: ProtocolFamily::Codex,
    },
    BuiltinHarness {
        id: "gemini",
        name: "Gemini CLI",
        bins: &["gemini"],
        family: ProtocolFamily::Gemini,
    },
    BuiltinHarness {
        id: "copilot",
        name: "GitHub Copilot",
        bins: &["copilot"],
        family: ProtocolFamily::Copilot,
    },
    BuiltinHarness {
        id: "opencode",
        name: "OpenCode",
        bins: &["opencode"],
        family: ProtocolFamily::OpenCode,
    },
    BuiltinHarness {
        id: "cursor",
        name: "Cursor",
        bins: &["cursor-agent", "agent"],
        family: ProtocolFamily::Cursor,
    },
];

/// Collapse leftover ACP-era harness ids onto the native catalog ids.
pub fn canonical_harness_id(id: &str) -> &str {
    match id.trim() {
        "claude-acp" | "claude_code" | "claude-code" => "claude",
        "codex-acp" => "codex",
        "github-copilot-cli" => "copilot",
        "gemini-cli" => "gemini",
        other => other,
    }
}

pub fn protocol_family(kind: &str) -> ProtocolFamily {
    let kind = canonical_harness_id(kind);
    BUILTINS
        .iter()
        .find(|item| item.id == kind)
        .map(|item| item.family)
        .unwrap_or(match kind {
            "coordy-stub" => ProtocolFamily::Stub,
            _ => ProtocolFamily::Acp,
        })
}

pub fn builtin(kind: &str) -> Option<&'static BuiltinHarness> {
    let kind = canonical_harness_id(kind);
    BUILTINS.iter().find(|item| item.id == kind)
}

pub fn is_builtin_id(id: &str) -> bool {
    let id = canonical_harness_id(id);
    BUILTINS.iter().any(|item| item.id == id)
}

/// Flags shown in the catalog (no prompt). The prompt is appended at spawn.
pub fn display_args(family: ProtocolFamily) -> Vec<&'static str> {
    match family {
        ProtocolFamily::Claude => vec![
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--dangerously-skip-permissions",
        ],
        ProtocolFamily::Codex => vec!["exec", "--json"],
        ProtocolFamily::Copilot => vec!["-p", "--output-format", "json", "--allow-all"],
        ProtocolFamily::OpenCode => vec!["run"],
        ProtocolFamily::Cursor => vec!["-p", "--trust", "--output-format", "stream-json"],
        ProtocolFamily::Gemini => vec!["-p"],
        ProtocolFamily::Acp | ProtocolFamily::Stub => Vec::new(),
    }
}

pub fn native_launch_args(family: ProtocolFamily, prompt: &str, model: &str) -> Vec<String> {
    let model = model.trim();
    match family {
        ProtocolFamily::Claude => {
            let mut args = vec![
                "-p".into(),
                prompt.to_string(),
                "--output-format".into(),
                "stream-json".into(),
                "--verbose".into(),
                "--dangerously-skip-permissions".into(),
            ];
            if !model.is_empty() {
                args.extend(["--model".into(), model.to_string()]);
            }
            args
        }
        ProtocolFamily::Codex => {
            let mut args = vec!["exec".into(), "--json".into()];
            if !model.is_empty() {
                args.extend(["--model".into(), model.to_string()]);
            }
            args.push(prompt.to_string());
            args
        }
        ProtocolFamily::Copilot => {
            let mut args = vec![
                "-p".into(),
                prompt.to_string(),
                "--output-format".into(),
                "json".into(),
                "--allow-all".into(),
            ];
            if !model.is_empty() {
                args.extend(["--model".into(), model.to_string()]);
            }
            args
        }
        ProtocolFamily::OpenCode => {
            let mut args = vec!["run".into()];
            if !model.is_empty() {
                args.extend(["--model".into(), model.to_string()]);
            }
            args.push(prompt.to_string());
            args
        }
        ProtocolFamily::Cursor => {
            let mut args = vec![
                "-p".into(),
                "--trust".into(),
                "--output-format".into(),
                "stream-json".into(),
            ];
            if !model.is_empty() {
                args.extend(["--model".into(), model.to_string()]);
            }
            args.push(prompt.to_string());
            args
        }
        ProtocolFamily::Gemini => {
            let mut args = vec!["-p".into(), prompt.to_string()];
            if !model.is_empty() {
                args.extend(["-m".into(), model.to_string()]);
            }
            args
        }
        ProtocolFamily::Acp | ProtocolFamily::Stub => Vec::new(),
    }
}

pub fn resolve_builtin_bin(kind: &str) -> Option<std::path::PathBuf> {
    builtin(kind).and_then(|spec| spec.bins.iter().find_map(|name| which_bin(name)))
}
