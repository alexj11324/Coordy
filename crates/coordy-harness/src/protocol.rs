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

/// Auto: keep a safety net (Claude classifier, Codex workspace sandbox).
/// Full Access: skip tool approval (and Codex sandbox).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ToolAccess {
    Auto,
    FullAccess,
}

pub fn parse_tool_access(value: &str) -> ToolAccess {
    match value.trim() {
        "full_access" | "full-access" | "bypass" => ToolAccess::FullAccess,
        _ => ToolAccess::Auto,
    }
}

/// Flags that keep a headless run from stopping on permission prompts.
/// Auto and Full Access are different: Auto still checks; Full Access does not.
fn unattended_auto_approve_args(
    family: ProtocolFamily,
    access: ToolAccess,
) -> &'static [&'static str] {
    match (family, access) {
        (ProtocolFamily::Claude, ToolAccess::Auto) => &["--permission-mode", "auto"],
        (ProtocolFamily::Claude, ToolAccess::FullAccess) => {
            &["--permission-mode", "bypassPermissions"]
        }
        (ProtocolFamily::Codex, ToolAccess::Auto) => &[
            "--sandbox",
            "workspace-write",
            "--ask-for-approval",
            "never",
            "-c",
            "sandbox_workspace_write.network_access=true",
        ],
        (ProtocolFamily::Codex, ToolAccess::FullAccess) => &[
            "--sandbox",
            "danger-full-access",
            "--ask-for-approval",
            "never",
        ],
        (ProtocolFamily::Copilot, ToolAccess::FullAccess) => &["--allow-all"],
        (ProtocolFamily::OpenCode, ToolAccess::FullAccess) => &["--dangerously-skip-permissions"],
        (ProtocolFamily::Cursor, ToolAccess::FullAccess) => &["--trust"],
        (ProtocolFamily::Gemini, ToolAccess::Auto) => &["--approval-mode", "auto_edit"],
        (ProtocolFamily::Gemini, ToolAccess::FullAccess) => &["--yolo"],
        (
            ProtocolFamily::Copilot
            | ProtocolFamily::OpenCode
            | ProtocolFamily::Cursor
            | ProtocolFamily::Acp
            | ProtocolFamily::Stub,
            ToolAccess::Auto,
        ) => &[],
        (ProtocolFamily::Acp | ProtocolFamily::Stub, ToolAccess::FullAccess) => &[],
    }
}

fn push_auto_approve(family: ProtocolFamily, access: ToolAccess, args: &mut Vec<String>) {
    args.extend(
        unattended_auto_approve_args(family, access)
            .iter()
            .map(|flag| (*flag).to_string()),
    );
}

/// Flags shown in the catalog (no prompt). Permission Auto/Full Access is
/// per-agent, so the catalog only shows the protocol flags.
pub fn display_args(family: ProtocolFamily) -> Vec<&'static str> {
    match family {
        ProtocolFamily::Claude => vec!["-p", "--output-format", "stream-json", "--verbose"],
        ProtocolFamily::Codex => vec!["exec", "--json"],
        ProtocolFamily::Copilot => vec!["-p", "--output-format", "json"],
        ProtocolFamily::OpenCode => vec!["run"],
        ProtocolFamily::Cursor => vec!["-p", "--output-format", "stream-json"],
        ProtocolFamily::Gemini => vec!["-p"],
        ProtocolFamily::Acp | ProtocolFamily::Stub => Vec::new(),
    }
}

#[allow(clippy::too_many_arguments)]
pub fn native_launch_args(
    family: ProtocolFamily,
    prompt: &str,
    model: &str,
    thinking: &str,
    speed: &str,
    tool_access: &str,
) -> Vec<String> {
    let model = model.trim();
    let thinking = thinking.trim();
    let speed = speed.trim();
    let access = parse_tool_access(tool_access);
    match family {
        ProtocolFamily::Claude => {
            let mut args = vec![
                "-p".into(),
                prompt.to_string(),
                "--output-format".into(),
                "stream-json".into(),
                "--verbose".into(),
            ];
            push_auto_approve(family, access, &mut args);
            if !model.is_empty() {
                args.extend(["--model".into(), model.to_string()]);
            }
            if !thinking.is_empty() {
                args.extend(["--effort".into(), thinking.to_string()]);
            }
            args
        }
        ProtocolFamily::Codex => {
            let mut args = vec!["exec".into(), "--json".into()];
            push_auto_approve(family, access, &mut args);
            if !model.is_empty() {
                args.extend(["--model".into(), model.to_string()]);
            }
            if !thinking.is_empty() {
                args.extend(["-c".into(), format!("model_reasoning_effort={thinking}")]);
            }
            if !speed.is_empty() {
                args.extend(["-c".into(), format!("service_tier={speed}")]);
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
            ];
            push_auto_approve(family, access, &mut args);
            if !model.is_empty() {
                args.extend(["--model".into(), model.to_string()]);
            }
            args
        }
        ProtocolFamily::OpenCode => {
            let mut args = vec!["run".into()];
            push_auto_approve(family, access, &mut args);
            if !model.is_empty() {
                args.extend(["--model".into(), model.to_string()]);
            }
            if !thinking.is_empty() {
                args.extend(["--variant".into(), thinking.to_string()]);
            }
            args.push(prompt.to_string());
            args
        }
        ProtocolFamily::Cursor => {
            let mut args = vec!["-p".into(), "--output-format".into(), "stream-json".into()];
            push_auto_approve(family, access, &mut args);
            if !model.is_empty() {
                args.extend(["--model".into(), model.to_string()]);
            }
            args.push(prompt.to_string());
            args
        }
        ProtocolFamily::Gemini => {
            let mut args = vec!["-p".into(), prompt.to_string()];
            push_auto_approve(family, access, &mut args);
            if !model.is_empty() {
                args.extend(["-m".into(), model.to_string()]);
            }
            args
        }
        ProtocolFamily::Acp | ProtocolFamily::Stub => Vec::new(),
    }
}

pub fn append_cli_args(family: ProtocolFamily, args: &mut Vec<String>, extra_cli: &str) {
    if family.uses_acp() {
        return;
    }
    for token in extra_cli.split_whitespace() {
        if !token.is_empty() {
            args.push(token.to_string());
        }
    }
}

pub fn resolve_builtin_bin(kind: &str) -> Option<std::path::PathBuf> {
    builtin(kind).and_then(|spec| spec.bins.iter().find_map(|name| which_bin(name)))
}
