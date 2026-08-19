//! Per-CLI protocol families. Coordy wraps each vendor CLI's native
//! headless interface; ACP is only used for the demo stub and ACP-registry agents.

use crate::which_bin;
use coordy_protocol::CoordyError;

/// How Coordy talks to a discovered harness.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtocolFamily {
    Claude,
    CodeBuddy,
    Codex,
    Copilot,
    OpenCode,
    Cursor,
    Gemini,
    DevEco,
    OpenClaw,
    Pi,
    Dsh,
    Qwen,
    Antigravity,
    Acp,
    Stub,
}

impl ProtocolFamily {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::CodeBuddy => "codebuddy",
            Self::Codex => "codex",
            Self::Copilot => "copilot",
            Self::OpenCode => "opencode",
            Self::Cursor => "cursor",
            Self::Gemini => "gemini",
            Self::DevEco => "deveco",
            Self::OpenClaw => "openclaw",
            Self::Pi => "pi",
            Self::Dsh => "dsh",
            Self::Qwen => "qwen",
            Self::Antigravity => "antigravity",
            Self::Acp => "acp",
            Self::Stub => "stub",
        }
    }

    pub fn uses_jsonl(self) -> bool {
        matches!(
            self,
            Self::Claude
                | Self::CodeBuddy
                | Self::Copilot
                | Self::Cursor
                | Self::OpenCode
                | Self::DevEco
                | Self::Pi
                | Self::Qwen
        )
    }

    pub fn uses_acp(self) -> bool {
        matches!(self, Self::Acp | Self::Stub)
    }

    pub fn expects_structured_output(self) -> bool {
        !matches!(
            self,
            Self::Gemini | Self::Antigravity | Self::Acp | Self::Stub
        )
    }

    pub fn prompt_on_stdin(self) -> bool {
        matches!(
            self,
            Self::Claude | Self::CodeBuddy | Self::OpenCode | Self::Cursor | Self::Pi
        )
    }
}

pub struct BuiltinHarness {
    pub id: &'static str,
    pub name: &'static str,
    pub bins: &'static [&'static str],
    pub family: ProtocolFamily,
    pub fixed_args: &'static [&'static str],
}

pub const BUILTINS: &[BuiltinHarness] = &[
    BuiltinHarness {
        id: "codebuddy",
        name: "CodeBuddy",
        bins: &["codebuddy"],
        family: ProtocolFamily::CodeBuddy,
        fixed_args: &[],
    },
    BuiltinHarness {
        id: "claude",
        name: "Claude Code",
        bins: &["claude", "claude-code"],
        family: ProtocolFamily::Claude,
        fixed_args: &[],
    },
    BuiltinHarness {
        id: "codex",
        name: "Codex",
        bins: &["codex"],
        family: ProtocolFamily::Codex,
        fixed_args: &[],
    },
    BuiltinHarness {
        id: "gemini",
        name: "Gemini CLI",
        bins: &["gemini"],
        family: ProtocolFamily::Gemini,
        fixed_args: &[],
    },
    BuiltinHarness {
        id: "copilot",
        name: "GitHub Copilot",
        bins: &["copilot"],
        family: ProtocolFamily::Copilot,
        fixed_args: &[],
    },
    BuiltinHarness {
        id: "opencode",
        name: "OpenCode",
        bins: &["opencode"],
        family: ProtocolFamily::OpenCode,
        fixed_args: &[],
    },
    BuiltinHarness {
        id: "cursor",
        name: "Cursor",
        bins: &["cursor-agent", "agent"],
        family: ProtocolFamily::Cursor,
        fixed_args: &[],
    },
    BuiltinHarness {
        id: "deveco",
        name: "DevEco Code",
        bins: &["deveco"],
        family: ProtocolFamily::DevEco,
        fixed_args: &[],
    },
    BuiltinHarness {
        id: "openclaw",
        name: "OpenClaw",
        bins: &["openclaw"],
        family: ProtocolFamily::OpenClaw,
        fixed_args: &[],
    },
    BuiltinHarness {
        id: "hermes",
        name: "Hermes Agent",
        bins: &["hermes"],
        family: ProtocolFamily::Acp,
        fixed_args: &["acp"],
    },
    BuiltinHarness {
        id: "pi",
        name: "Pi",
        bins: &["pi"],
        family: ProtocolFamily::Pi,
        fixed_args: &[],
    },
    BuiltinHarness {
        id: "omp",
        name: "Oh My Pi",
        bins: &["omp"],
        family: ProtocolFamily::Pi,
        fixed_args: &[],
    },
    BuiltinHarness {
        id: "kimi",
        name: "Kimi Code",
        bins: &["kimi"],
        family: ProtocolFamily::Acp,
        fixed_args: &["acp"],
    },
    BuiltinHarness {
        id: "reasonix",
        name: "Reasonix",
        bins: &["reasonix"],
        family: ProtocolFamily::Acp,
        fixed_args: &[
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
    },
    BuiltinHarness {
        id: "dsh",
        name: "DeepSeek Harness",
        bins: &["dsh"],
        family: ProtocolFamily::Dsh,
        fixed_args: &["--profile", "multica", "--stdio"],
    },
    BuiltinHarness {
        id: "kiro",
        name: "Kiro CLI",
        bins: &["kiro-cli"],
        family: ProtocolFamily::Acp,
        fixed_args: &["acp", "--trust-all-tools"],
    },
    BuiltinHarness {
        id: "antigravity",
        name: "Antigravity",
        bins: &["agy"],
        family: ProtocolFamily::Antigravity,
        fixed_args: &[],
    },
    BuiltinHarness {
        id: "qoder",
        name: "Qoder",
        bins: &["qodercli"],
        family: ProtocolFamily::Acp,
        fixed_args: &["--yolo", "--acp"],
    },
    BuiltinHarness {
        id: "qoderclicn",
        name: "Qoder CLI CN",
        bins: &["qoderclicn"],
        family: ProtocolFamily::Acp,
        fixed_args: &["--yolo", "--acp"],
    },
    BuiltinHarness {
        id: "traecli",
        name: "TRAE CLI",
        bins: &["traecli"],
        family: ProtocolFamily::Acp,
        fixed_args: &["acp", "serve", "--yolo"],
    },
    BuiltinHarness {
        id: "grok",
        name: "Grok Build",
        bins: &["grok"],
        family: ProtocolFamily::Acp,
        fixed_args: &["--no-auto-update", "agent", "--always-approve", "stdio"],
    },
    BuiltinHarness {
        id: "qwen",
        name: "Qwen Code",
        bins: &["qwen"],
        family: ProtocolFamily::Qwen,
        fixed_args: &[],
    },
    BuiltinHarness {
        id: "qwenpaw",
        name: "QwenPaw",
        bins: &["qwenpaw"],
        family: ProtocolFamily::Acp,
        fixed_args: &["acp"],
    },
    BuiltinHarness {
        id: "mcode",
        name: "MiniMax Code",
        bins: &["mcode"],
        family: ProtocolFamily::Acp,
        fixed_args: &["acp"],
    },
];

pub const MULTICA_RUNTIME_IDS: &[&str] = &[
    "claude",
    "codebuddy",
    "codex",
    "copilot",
    "opencode",
    "deveco",
    "openclaw",
    "hermes",
    "pi",
    "omp",
    "cursor",
    "kimi",
    "reasonix",
    "dsh",
    "kiro",
    "antigravity",
    "qoder",
    "qoderclicn",
    "traecli",
    "grok",
    "qwen",
    "qwenpaw",
    "mcode",
];

/// Collapse leftover ACP-era harness ids onto the native catalog ids.
pub fn canonical_harness_id(id: &str) -> &str {
    match id.trim() {
        "claude-acp" | "claude_code" | "claude-code" => "claude",
        "codebuddy-code" => "codebuddy",
        "codex-acp" => "codex",
        "github-copilot-cli" => "copilot",
        "gemini-cli" => "gemini",
        "grok-build" => "grok",
        "pi-acp" => "pi",
        "qwen-code" => "qwen",
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

/// Auto: keep a safety net (Claude classifier, Codex workspace sandbox).
/// Full Access: skip tool approval (and Codex sandbox).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ToolAccess {
    Auto,
    FullAccess,
}

pub fn parse_tool_access(value: &str) -> ToolAccess {
    match value.trim() {
        "full_access" => ToolAccess::FullAccess,
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
        (ProtocolFamily::CodeBuddy, ToolAccess::Auto) => &["--permission-mode", "auto"],
        (ProtocolFamily::CodeBuddy, ToolAccess::FullAccess) => {
            &["--permission-mode", "bypassPermissions"]
        }
        (ProtocolFamily::Codex, ToolAccess::Auto) => &[
            "--sandbox",
            "workspace-write",
            "--approve-for-me",
            "-c",
            "sandbox_workspace_write.network_access=true",
        ],
        (ProtocolFamily::Codex, ToolAccess::FullAccess) => {
            &["--dangerously-bypass-approvals-and-sandbox"]
        }
        (ProtocolFamily::Copilot, ToolAccess::FullAccess) => &["--allow-all"],
        (ProtocolFamily::OpenCode, ToolAccess::FullAccess) => &["--dangerously-skip-permissions"],
        (ProtocolFamily::Cursor, ToolAccess::FullAccess) => &["--yolo"],
        (ProtocolFamily::Gemini, ToolAccess::Auto) => &["--approval-mode", "auto_edit"],
        (ProtocolFamily::Gemini, ToolAccess::FullAccess) => &["--yolo"],
        (ProtocolFamily::DevEco, ToolAccess::FullAccess) => &["--dangerously-skip-permissions"],
        (ProtocolFamily::Qwen, ToolAccess::FullAccess) => &["--yolo"],
        (ProtocolFamily::Antigravity, ToolAccess::FullAccess) => {
            &["--dangerously-skip-permissions"]
        }
        (ProtocolFamily::Antigravity, ToolAccess::Auto) => &[],
        (
            ProtocolFamily::Copilot
            | ProtocolFamily::OpenCode
            | ProtocolFamily::Cursor
            | ProtocolFamily::DevEco
            | ProtocolFamily::Qwen
            | ProtocolFamily::Acp
            | ProtocolFamily::Stub,
            ToolAccess::Auto,
        ) => &[],
        (ProtocolFamily::OpenClaw | ProtocolFamily::Pi | ProtocolFamily::Dsh, _) => &[],
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
        ProtocolFamily::CodeBuddy => vec!["-p", "--output-format", "stream-json", "--verbose"],
        ProtocolFamily::Codex => vec!["app-server", "--listen", "stdio://"],
        ProtocolFamily::Copilot => vec!["-p", "--output-format", "json"],
        ProtocolFamily::OpenCode => vec!["run", "--format", "json"],
        ProtocolFamily::Cursor => vec!["-p", "--output-format", "stream-json"],
        ProtocolFamily::Gemini => vec!["-p"],
        ProtocolFamily::DevEco => vec!["run", "--format", "json"],
        ProtocolFamily::OpenClaw => vec!["agent", "--json"],
        ProtocolFamily::Pi => vec!["-p", "--mode", "json"],
        ProtocolFamily::Dsh => vec!["--profile", "multica", "--stdio"],
        ProtocolFamily::Qwen => vec!["-p", "--output-format", "stream-json"],
        ProtocolFamily::Antigravity => vec!["-p"],
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
                "--output-format".into(),
                "stream-json".into(),
                "--input-format".into(),
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
        ProtocolFamily::CodeBuddy => {
            let mut args = vec![
                "-p".into(),
                "--output-format".into(),
                "stream-json".into(),
                "--input-format".into(),
                "stream-json".into(),
                "--verbose".into(),
                "--disallowedTools".into(),
                "AskUserQuestion".into(),
                "EnterPlanMode".into(),
                "ExitPlanMode".into(),
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
            let mut args = vec!["app-server".into(), "--listen".into(), "stdio://".into()];
            if speed == "fast" {
                args.extend(["--enable".into(), "fast_mode".into()]);
            }
            args
        }
        ProtocolFamily::Copilot => {
            let mut args = vec![
                "-p".into(),
                prompt.to_string(),
                "--output-format".into(),
                "json".into(),
                "--no-ask-user".into(),
            ];
            push_auto_approve(family, access, &mut args);
            if !model.is_empty() {
                args.extend(["--model".into(), model.to_string()]);
            }
            args
        }
        ProtocolFamily::OpenCode => {
            let mut args = vec!["run".into(), "--format".into(), "json".into()];
            push_auto_approve(family, access, &mut args);
            if !model.is_empty() {
                args.extend(["--model".into(), model.to_string()]);
            }
            if !thinking.is_empty() {
                args.extend(["--variant".into(), thinking.to_string()]);
            }
            args
        }
        ProtocolFamily::Cursor => {
            let mut args = vec!["-p".into(), "--output-format".into(), "stream-json".into()];
            push_auto_approve(family, access, &mut args);
            if !model.is_empty() {
                args.extend(["--model".into(), model.to_string()]);
            }
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
        ProtocolFamily::DevEco => {
            let mut args = vec!["run".into(), "--format".into(), "json".into()];
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
        ProtocolFamily::OpenClaw => {
            let mut args = vec![
                "agent".into(),
                "--json".into(),
                "--session-id".into(),
                format!("coordy-{}", std::process::id()),
            ];
            if !model.is_empty() {
                args.extend(["--agent".into(), model.to_string()]);
            }
            args.extend(["--message".into(), prompt.to_string()]);
            args
        }
        ProtocolFamily::Pi => {
            let mut args = vec!["-p".into(), "--mode".into(), "json".into()];
            if !model.is_empty() {
                if let Some((provider, model_id)) = model.split_once('/') {
                    if !provider.trim().is_empty() {
                        args.extend(["--provider".into(), provider.trim().to_string()]);
                    }
                    if !model_id.trim().is_empty() {
                        args.extend(["--model".into(), model_id.trim().to_string()]);
                    }
                } else {
                    args.extend(["--model".into(), model.to_string()]);
                }
            }
            if !thinking.is_empty() {
                args.extend(["--thinking".into(), thinking.to_string()]);
            }
            args
        }
        ProtocolFamily::Dsh => vec!["--profile".into(), "multica".into(), "--stdio".into()],
        ProtocolFamily::Qwen => {
            let mut args = vec![
                "-p".into(),
                prompt.to_string(),
                "--output-format".into(),
                "stream-json".into(),
            ];
            push_auto_approve(family, access, &mut args);
            if !model.is_empty() {
                args.extend(["--model".into(), model.to_string()]);
            }
            args
        }
        ProtocolFamily::Antigravity => {
            let mut args = vec!["-p".into(), prompt.to_string()];
            push_auto_approve(family, access, &mut args);
            if !model.is_empty() {
                args.extend(["--model".into(), model.to_string()]);
            }
            args
        }
        ProtocolFamily::Acp | ProtocolFamily::Stub => Vec::new(),
    }
}

pub fn append_cli_args(
    family: ProtocolFamily,
    access: ToolAccess,
    args: &mut Vec<String>,
    extra_cli: &str,
) -> Result<(), CoordyError> {
    if family.uses_acp() {
        return Ok(());
    }
    let tokens: Vec<&str> = extra_cli.split_whitespace().collect();
    for token in &tokens {
        if fixed_contract_flag(family, token) {
            return Err(CoordyError::invalid(format!(
                "cli_args cannot override {} launch contract: {token}",
                family.as_str()
            )));
        }
    }
    if family == ProtocolFamily::Antigravity {
        for token in &tokens {
            if flag_is(token, "-p")
                || flag_is(token, "--print")
                || flag_is(token, "--prompt")
                || flag_is(token, "--model")
                || flag_is(token, "-i")
                || flag_is(token, "--prompt-interactive")
            {
                return Err(CoordyError::invalid(format!(
                    "cli_args cannot override Antigravity launch contract: {token}"
                )));
            }
        }
    }
    if access == ToolAccess::Auto {
        for (index, token) in tokens.iter().enumerate() {
            let denied = match family {
                ProtocolFamily::Codex => {
                    flag_is(token, "--dangerously-bypass-approvals-and-sandbox")
                        || flag_is(token, "--approve-for-me")
                        || flag_is(token, "--ask-for-approval")
                        || flag_is(token, "--sandbox")
                        || flag_is(token, "--full-auto")
                        || flag_is(token, "--cd")
                        || flag_is(token, "--add-dir")
                        || flag_is(token, "--profile")
                        || short_option_is(token, "-s")
                        || short_option_is(token, "-a")
                        || short_option_is(token, "-C")
                        || short_option_is(token, "-p")
                        || codex_config_overrides_access(token, tokens.get(index + 1).copied())
                }
                ProtocolFamily::Claude => {
                    flag_is(token, "--permission-mode")
                        || flag_is(token, "--dangerously-skip-permissions")
                        || flag_is(token, "--allow-dangerously-skip-permissions")
                }
                ProtocolFamily::CodeBuddy => {
                    flag_is(token, "--permission-mode")
                        || flag_is(token, "--dangerously-skip-permissions")
                }
                ProtocolFamily::Gemini => {
                    flag_is(token, "--yolo") || flag_is(token, "--approval-mode") || *token == "-y"
                }
                ProtocolFamily::Copilot => flag_is(token, "--allow-all"),
                ProtocolFamily::OpenCode => flag_is(token, "--dangerously-skip-permissions"),
                ProtocolFamily::Cursor => flag_is(token, "--yolo") || flag_is(token, "--trust"),
                ProtocolFamily::DevEco => flag_is(token, "--dangerously-skip-permissions"),
                ProtocolFamily::Qwen => flag_is(token, "--yolo"),
                ProtocolFamily::OpenClaw | ProtocolFamily::Pi | ProtocolFamily::Dsh => false,
                ProtocolFamily::Antigravity => flag_is(token, "--dangerously-skip-permissions"),
                ProtocolFamily::Acp | ProtocolFamily::Stub => false,
            };
            if denied {
                return Err(CoordyError::invalid(format!(
                    "cli_args cannot override {family:?} tool access while tool_access is auto: {token}"
                )));
            }
        }
    }
    for token in tokens {
        if !token.is_empty() {
            args.push(token.to_string());
        }
    }
    Ok(())
}

fn fixed_contract_flag(family: ProtocolFamily, token: &str) -> bool {
    let owned: &[&str] = match family {
        ProtocolFamily::Claude | ProtocolFamily::CodeBuddy => {
            &["-p", "--output-format", "--input-format", "--verbose"]
        }
        ProtocolFamily::Codex => &["app-server", "--listen", "--enable"],
        ProtocolFamily::Copilot => &["-p", "--output-format", "--no-ask-user"],
        ProtocolFamily::OpenCode | ProtocolFamily::DevEco => &["run", "--format"],
        ProtocolFamily::Cursor => &["-p", "--output-format"],
        ProtocolFamily::Gemini => &["-p"],
        ProtocolFamily::OpenClaw => &["agent", "--json", "--session-id", "--message"],
        ProtocolFamily::Pi => &["-p", "--mode"],
        ProtocolFamily::Dsh => &["--profile", "--stdio", "--probe"],
        ProtocolFamily::Qwen => &["-p", "--output-format"],
        ProtocolFamily::Antigravity => &[
            "-p",
            "--print",
            "--prompt",
            "--print-timeout",
            "--log-file",
            "--add-dir",
        ],
        ProtocolFamily::Acp | ProtocolFamily::Stub => &[],
    };
    owned.iter().any(|flag| flag_is(token, flag))
}

fn flag_is(token: &str, flag: &str) -> bool {
    token == flag
        || token
            .strip_prefix(flag)
            .is_some_and(|rest| rest.starts_with('='))
}

fn short_option_is(token: &str, flag: &str) -> bool {
    token == flag
        || token
            .strip_prefix(flag)
            .is_some_and(|rest| !rest.is_empty())
}

fn codex_config_overrides_access(token: &str, next: Option<&str>) -> bool {
    let value = if token == "-c" || token == "--config" {
        next
    } else {
        token.strip_prefix("--config=").or_else(|| {
            token
                .strip_prefix("-c")
                .filter(|rest| !rest.is_empty())
                .map(|rest| rest.strip_prefix('=').unwrap_or(rest))
        })
    };
    let Some(key) = value.and_then(|value| value.split('=').next()) else {
        return false;
    };
    let key = key.trim().to_ascii_lowercase();
    key.contains("sandbox") || key.contains("approval")
}

pub fn resolve_builtin_bin(kind: &str) -> Option<std::path::PathBuf> {
    builtin(kind).and_then(|spec| spec.bins.iter().find_map(|name| which_bin(name)))
}
