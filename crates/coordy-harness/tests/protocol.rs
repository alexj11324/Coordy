use coordy_harness::{
    canonical_harness_id, display_args, native_launch_args, parse_tool_access, protocol_family,
    ProtocolFamily, ToolAccess, BUILTINS, MULTICA_RUNTIME_IDS,
};

#[test]
fn first_class_schema_covers_each_multica_identity_exactly_once_plus_gemini() {
    assert_eq!(MULTICA_RUNTIME_IDS.len(), 23);
    let mut expected = MULTICA_RUNTIME_IDS.to_vec();
    expected.sort_unstable();
    expected.dedup();
    assert_eq!(
        expected.len(),
        23,
        "frozen Multica identity schema contains duplicates"
    );

    let mut actual: Vec<_> = BUILTINS
        .iter()
        .filter(|runtime| runtime.id != "gemini")
        .map(|runtime| runtime.id)
        .collect();
    actual.sort_unstable();
    assert_eq!(actual, expected);
    assert_eq!(
        BUILTINS
            .iter()
            .filter(|runtime| runtime.id == "gemini")
            .count(),
        1
    );
    for runtime in BUILTINS {
        assert!(
            !runtime.bins.is_empty(),
            "{} has no binary contract",
            runtime.id
        );
        assert!(
            !runtime.name.trim().is_empty(),
            "{} has no display identity",
            runtime.id
        );
        assert_ne!(
            runtime.family,
            ProtocolFamily::Stub,
            "{} cannot use the demo protocol",
            runtime.id
        );
    }
}

fn launch(
    family: ProtocolFamily,
    prompt: &str,
    model: &str,
    thinking: &str,
    speed: &str,
) -> Vec<String> {
    native_launch_args(family, prompt, model, thinking, speed, "auto")
}

fn launch_full(family: ProtocolFamily, prompt: &str) -> Vec<String> {
    native_launch_args(family, prompt, "", "", "", "full_access")
}

#[test]
fn tool_access_fails_closed_for_noncanonical_values() {
    assert_eq!(parse_tool_access("full_access"), ToolAccess::FullAccess);
    for value in [
        "",
        "auto",
        "full-access",
        "bypass",
        "FULL_ACCESS",
        "unknown",
    ] {
        assert_eq!(parse_tool_access(value), ToolAccess::Auto, "{value}");
    }
}

#[test]
fn leftover_acp_ids_collapse_onto_native_catalog() {
    assert_eq!(canonical_harness_id("claude-acp"), "claude");
    assert_eq!(canonical_harness_id("claude_code"), "claude");
    assert_eq!(canonical_harness_id("codebuddy-code"), "codebuddy");
    assert_eq!(canonical_harness_id("codex-acp"), "codex");
    assert_eq!(canonical_harness_id("github-copilot-cli"), "copilot");
    assert_eq!(canonical_harness_id("gemini-cli"), "gemini");
    assert_eq!(canonical_harness_id("grok-build"), "grok");
    assert_eq!(canonical_harness_id("pi-acp"), "pi");
    assert_eq!(canonical_harness_id("qwen-code"), "qwen");
    assert_eq!(canonical_harness_id("cursor"), "cursor");
    assert_eq!(canonical_harness_id("coordy-stub"), "coordy-stub");
}

#[test]
fn known_clis_use_native_families_not_acp() {
    assert_eq!(protocol_family("claude-acp"), ProtocolFamily::Claude);
    assert_eq!(protocol_family("codex"), ProtocolFamily::Codex);
    assert_eq!(
        protocol_family("github-copilot-cli"),
        ProtocolFamily::Copilot
    );
    assert_eq!(protocol_family("opencode"), ProtocolFamily::OpenCode);
    assert_eq!(protocol_family("cursor"), ProtocolFamily::Cursor);
    assert_eq!(protocol_family("gemini-cli"), ProtocolFamily::Gemini);
    assert_eq!(protocol_family("antigravity"), ProtocolFamily::Antigravity);
    assert!(protocol_family("hermes").uses_acp());
    assert!(protocol_family("grok-build").uses_acp());
    assert!(!protocol_family("claude").uses_acp());
    assert!(protocol_family("coordy-stub").uses_acp());
    assert!(protocol_family("made-up-acp").uses_acp());
}

#[test]
fn native_launch_args_put_the_prompt_where_each_cli_expects_it() {
    let claude = launch(ProtocolFamily::Claude, "review this", "opus", "", "");
    assert_eq!(claude[0], "-p");
    assert!(!claude.iter().any(|arg| arg == "review this"));
    assert!(claude
        .windows(2)
        .any(|w| w == ["--output-format", "stream-json"]));
    assert!(claude.windows(2).any(|w| w == ["--model", "opus"]));
    assert!(!claude.iter().any(|a| a == "acp" || a == "--acp"));
    assert!(!claude.iter().any(|a| a == "--effort"));

    let cursor = launch(ProtocolFamily::Cursor, "review this", "", "", "");
    assert_eq!(cursor[0], "-p");
    assert!(!cursor.iter().any(|arg| arg == "review this"));
    assert!(cursor
        .windows(2)
        .any(|w| w == ["--output-format", "stream-json"]));

    let codex = launch(ProtocolFamily::Codex, "review this", "gpt-5.4", "", "");
    assert_eq!(codex[0], "app-server");
    assert!(codex.windows(2).any(|w| w == ["--listen", "stdio://"]));
    assert!(!codex.iter().any(|a| a == "review this" || a == "gpt-5.4"));
    assert!(!codex
        .iter()
        .any(|a| a.starts_with("model_reasoning_effort=")));
    assert!(!codex.iter().any(|a| a.starts_with("service_tier=")));

    let gemini = launch(
        ProtocolFamily::Gemini,
        "review this",
        "gemini-2.5-pro",
        "",
        "",
    );
    assert_eq!(gemini[0], "-p");
    assert_eq!(gemini[1], "review this");
    assert!(gemini.windows(2).any(|w| w == ["-m", "gemini-2.5-pro"]));

    let antigravity = launch(
        ProtocolFamily::Antigravity,
        "review this",
        "gemini-3.6-flash-high",
        "",
        "",
    );
    assert_eq!(antigravity[0..2], ["-p", "review this"]);
    assert!(antigravity
        .windows(2)
        .any(|w| w == ["--model", "gemini-3.6-flash-high"]));
}

#[test]
fn auto_keeps_safety_checks_full_access_skips_them() {
    let claude_auto = launch(ProtocolFamily::Claude, "review this", "", "", "");
    assert!(claude_auto
        .windows(2)
        .any(|w| w == ["--permission-mode", "auto"]));
    assert!(!claude_auto
        .iter()
        .any(|a| a == "bypassPermissions" || a == "--dangerously-skip-permissions"));

    let claude_full = launch_full(ProtocolFamily::Claude, "review this");
    assert!(claude_full
        .windows(2)
        .any(|w| w == ["--permission-mode", "bypassPermissions"]));
    assert!(!claude_full
        .windows(2)
        .any(|w| w == ["--permission-mode", "auto"]));

    let codex_auto = launch(ProtocolFamily::Codex, "review this", "", "", "");
    assert_eq!(&codex_auto[..3], ["app-server", "--listen", "stdio://"]);
    assert!(!codex_auto.iter().any(|a| a == "danger-full-access"));
    assert!(!codex_auto.iter().any(|a| a == "--ask-for-approval"));

    let codex_full = launch_full(ProtocolFamily::Codex, "review this");
    assert_eq!(&codex_full[..3], ["app-server", "--listen", "stdio://"]);

    let gemini_auto = launch(ProtocolFamily::Gemini, "review this", "", "", "");
    assert!(gemini_auto
        .windows(2)
        .any(|w| w == ["--approval-mode", "auto_edit"]));
    assert!(!gemini_auto.iter().any(|a| a == "--yolo"));

    let gemini_full = launch_full(ProtocolFamily::Gemini, "review this");
    assert!(gemini_full.iter().any(|a| a == "--yolo"));

    let opencode_auto = launch(ProtocolFamily::OpenCode, "review this", "", "", "");
    assert!(!opencode_auto
        .iter()
        .any(|a| a == "--dangerously-skip-permissions"));
    let opencode_full = launch_full(ProtocolFamily::OpenCode, "review this");
    assert!(opencode_full
        .iter()
        .any(|a| a == "--dangerously-skip-permissions"));

    assert!(!launch(ProtocolFamily::Copilot, "review this", "", "", "")
        .iter()
        .any(|a| a == "--allow-all"));
    assert!(launch_full(ProtocolFamily::Copilot, "review this")
        .iter()
        .any(|a| a == "--allow-all"));

    assert!(!launch(ProtocolFamily::Cursor, "review this", "", "", "")
        .iter()
        .any(|a| a == "--yolo"));
    assert!(launch_full(ProtocolFamily::Cursor, "review this")
        .iter()
        .any(|a| a == "--yolo"));

    assert!(
        !launch(ProtocolFamily::Antigravity, "review this", "", "", "")
            .iter()
            .any(|a| a == "--dangerously-skip-permissions")
    );
    assert!(launch_full(ProtocolFamily::Antigravity, "review this")
        .iter()
        .any(|a| a == "--dangerously-skip-permissions"));
}

#[test]
fn catalog_display_args_are_present_on_spawn() {
    for family in [
        ProtocolFamily::Claude,
        ProtocolFamily::Codex,
        ProtocolFamily::Copilot,
        ProtocolFamily::OpenCode,
        ProtocolFamily::Cursor,
        ProtocolFamily::Gemini,
        ProtocolFamily::Antigravity,
    ] {
        let launched = launch(family, "review this", "", "", "");
        for flag in display_args(family) {
            assert!(
                launched.iter().any(|a| a == flag),
                "{family:?} spawn missing catalog flag {flag}: {launched:?}"
            );
        }
    }
    assert!(display_args(ProtocolFamily::Acp).is_empty());
}

#[test]
fn native_launch_args_inject_vendor_thinking_and_speed_tokens() {
    let claude = launch(
        ProtocolFamily::Claude,
        "review this",
        "claude-opus-4-8",
        "xhigh",
        "fast",
    );
    assert!(claude
        .windows(2)
        .any(|w| w == ["--model", "claude-opus-4-8"]));
    assert!(claude.windows(2).any(|w| w == ["--effort", "xhigh"]));
    assert!(!claude.iter().any(|a| a.contains("service_tier")));

    let codex = launch(
        ProtocolFamily::Codex,
        "review this",
        "gpt-5.6-sol",
        "high",
        "fast",
    );
    assert!(!codex
        .iter()
        .any(|arg| arg == "gpt-5.6-sol" || arg == "high"));
    assert!(codex.windows(2).any(|w| w == ["--enable", "fast_mode"]));

    let opencode = launch(
        ProtocolFamily::OpenCode,
        "review this",
        "anthropic/claude-sonnet-4-6",
        "max",
        "",
    );
    assert!(opencode
        .windows(2)
        .any(|w| w == ["--model", "anthropic/claude-sonnet-4-6"]));
    assert!(opencode.windows(2).any(|w| w == ["--variant", "max"]));
    assert!(!opencode.iter().any(|arg| arg == "review this"));
}

#[test]
fn pi_model_contract_splits_provider_and_model_id() {
    let args = launch(
        ProtocolFamily::Pi,
        "review this",
        "anthropic/claude-sonnet",
        "high",
        "",
    );
    assert!(args.windows(2).any(|w| w == ["--provider", "anthropic"]));
    assert!(args.windows(2).any(|w| w == ["--model", "claude-sonnet"]));
    assert!(args.windows(2).any(|w| w == ["--thinking", "high"]));
}

#[test]
fn native_launch_args_append_cli_args_except_acp() {
    let mut claude = launch(ProtocolFamily::Claude, "review this", "", "", "");
    coordy_harness::append_cli_args(
        ProtocolFamily::Claude,
        ToolAccess::Auto,
        &mut claude,
        "--foo bar",
    )
    .unwrap();
    assert!(claude.windows(2).any(|w| w == ["--foo", "bar"]));

    let mut acp = launch(ProtocolFamily::Acp, "review this", "", "", "");
    coordy_harness::append_cli_args(ProtocolFamily::Acp, ToolAccess::Auto, &mut acp, "--foo bar")
        .unwrap();
    assert!(acp.is_empty());
}

#[test]
fn user_cli_args_cannot_replace_protocol_owned_flags() {
    for (family, cli_arg) in [
        (ProtocolFamily::Claude, "--output-format text"),
        (ProtocolFamily::Codex, "--listen tcp://127.0.0.1:9"),
        (ProtocolFamily::OpenCode, "--format text"),
        (ProtocolFamily::OpenClaw, "--message replacement"),
        (ProtocolFamily::Pi, "--mode text"),
        (ProtocolFamily::Dsh, "--profile unsafe"),
        (ProtocolFamily::Qwen, "--output-format text"),
    ] {
        let mut args = launch(family, "review this", "", "", "");
        let error = coordy_harness::append_cli_args(family, ToolAccess::Auto, &mut args, cli_arg)
            .expect_err("protocol-owned flag must fail closed");
        assert_eq!(error.code, "invalid", "{family:?} {cli_arg}");
        assert!(
            error.message.contains("launch contract"),
            "{}",
            error.message
        );
    }
}

#[test]
fn auto_cli_args_cannot_override_provider_tool_access() {
    let denied = [
        (
            ProtocolFamily::Codex,
            "--dangerously-bypass-approvals-and-sandbox",
        ),
        (ProtocolFamily::Codex, "--sandbox=danger-full-access"),
        (ProtocolFamily::Codex, "-s=danger-full-access"),
        (ProtocolFamily::Codex, "-sdanger-full-access"),
        (ProtocolFamily::Codex, "-a=never"),
        (ProtocolFamily::Codex, "-anever"),
        (ProtocolFamily::Codex, "-c approval_policy=never"),
        (ProtocolFamily::Codex, "-capproval_policy=never"),
        (ProtocolFamily::Codex, "-c=sandbox=\"danger-full-access\""),
        (
            ProtocolFamily::Codex,
            "--config=sandbox=\"danger-full-access\"",
        ),
        (ProtocolFamily::Codex, "--cd /tmp/outside"),
        (ProtocolFamily::Codex, "--cd=/tmp/outside"),
        (ProtocolFamily::Codex, "-C /tmp/outside"),
        (ProtocolFamily::Codex, "-C=/tmp/outside"),
        (ProtocolFamily::Codex, "-C/tmp/outside"),
        (ProtocolFamily::Codex, "--add-dir /tmp/outside"),
        (ProtocolFamily::Codex, "--add-dir=/tmp/outside"),
        (ProtocolFamily::Codex, "--profile unsafe"),
        (ProtocolFamily::Codex, "--profile=unsafe"),
        (ProtocolFamily::Codex, "-punsafe"),
        (
            ProtocolFamily::Claude,
            "--permission-mode bypassPermissions",
        ),
        (ProtocolFamily::Claude, "--dangerously-skip-permissions"),
        (ProtocolFamily::Gemini, "--yolo"),
        (ProtocolFamily::Gemini, "--approval-mode yolo"),
        (ProtocolFamily::Copilot, "--allow-all"),
        (ProtocolFamily::OpenCode, "--dangerously-skip-permissions"),
        (ProtocolFamily::Cursor, "--trust"),
        (ProtocolFamily::Cursor, "--yolo"),
        (
            ProtocolFamily::Antigravity,
            "--dangerously-skip-permissions",
        ),
    ];
    for (family, cli_args) in denied {
        let mut args = launch(family, "review this", "", "", "");
        let err = coordy_harness::append_cli_args(family, ToolAccess::Auto, &mut args, cli_args)
            .unwrap_err();
        assert_eq!(err.code, "invalid", "{family:?}: {cli_args}");
    }

    let mut benign = launch(ProtocolFamily::Codex, "review this", "", "", "");
    coordy_harness::append_cli_args(
        ProtocolFamily::Codex,
        ToolAccess::Auto,
        &mut benign,
        "--ephemeral --color never -cservice_tier=fast",
    )
    .unwrap();
    assert!(benign.iter().any(|arg| arg == "--ephemeral"));
    assert!(benign.iter().any(|arg| arg == "-cservice_tier=fast"));

    let mut full = launch_full(ProtocolFamily::Claude, "review this");
    coordy_harness::append_cli_args(
        ProtocolFamily::Claude,
        ToolAccess::FullAccess,
        &mut full,
        "--dangerously-skip-permissions",
    )
    .unwrap();
    assert!(full
        .iter()
        .any(|arg| arg == "--dangerously-skip-permissions"));
}

#[test]
fn antigravity_cli_args_cannot_replace_fixed_prompt_or_model() {
    for access in [ToolAccess::Auto, ToolAccess::FullAccess] {
        for cli_args in ["-p stolen", "--prompt=stolen", "--model other", "-i"] {
            let mut args = native_launch_args(
                ProtocolFamily::Antigravity,
                "review this",
                "model-x",
                "",
                "",
                if access == ToolAccess::Auto {
                    "auto"
                } else {
                    "full_access"
                },
            );
            assert!(
                coordy_harness::append_cli_args(
                    ProtocolFamily::Antigravity,
                    access,
                    &mut args,
                    cli_args,
                )
                .is_err(),
                "{access:?}: {cli_args}"
            );
        }
    }
}
