use coordy_harness::{canonical_harness_id, native_launch_args, protocol_family, ProtocolFamily};

#[test]
fn leftover_acp_ids_collapse_onto_native_catalog() {
    assert_eq!(canonical_harness_id("claude-acp"), "claude");
    assert_eq!(canonical_harness_id("claude_code"), "claude");
    assert_eq!(canonical_harness_id("codex-acp"), "codex");
    assert_eq!(canonical_harness_id("github-copilot-cli"), "copilot");
    assert_eq!(canonical_harness_id("gemini-cli"), "gemini");
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
    assert!(!protocol_family("claude").uses_acp());
    assert!(protocol_family("coordy-stub").uses_acp());
    assert!(protocol_family("made-up-acp").uses_acp());
}

#[test]
fn native_launch_args_put_the_prompt_where_each_cli_expects_it() {
    let claude = native_launch_args(ProtocolFamily::Claude, "review this", "opus", "", "");
    assert_eq!(claude[0], "-p");
    assert_eq!(claude[1], "review this");
    assert!(claude
        .windows(2)
        .any(|w| w == ["--output-format", "stream-json"]));
    assert!(claude.windows(2).any(|w| w == ["--model", "opus"]));
    assert!(!claude.iter().any(|a| a == "acp" || a == "--acp"));
    assert!(!claude.iter().any(|a| a == "--effort"));

    let cursor = native_launch_args(ProtocolFamily::Cursor, "review this", "", "", "");
    assert_eq!(cursor[0], "-p");
    assert_eq!(cursor.last().map(String::as_str), Some("review this"));
    assert!(cursor
        .windows(2)
        .any(|w| w == ["--output-format", "stream-json"]));

    let codex = native_launch_args(ProtocolFamily::Codex, "review this", "gpt-5.4", "", "");
    assert_eq!(codex[0], "exec");
    assert!(codex.iter().any(|a| a == "--json"));
    assert_eq!(codex.last().map(String::as_str), Some("review this"));
    assert!(!codex
        .iter()
        .any(|a| a.starts_with("model_reasoning_effort=")));
    assert!(!codex.iter().any(|a| a.starts_with("service_tier=")));

    let gemini = native_launch_args(
        ProtocolFamily::Gemini,
        "review this",
        "gemini-2.5-pro",
        "",
        "",
    );
    assert_eq!(gemini[0], "-p");
    assert_eq!(gemini[1], "review this");
    assert!(gemini.windows(2).any(|w| w == ["-m", "gemini-2.5-pro"]));
}

#[test]
fn native_launch_args_inject_vendor_thinking_and_speed_tokens() {
    let claude = native_launch_args(
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

    let codex = native_launch_args(
        ProtocolFamily::Codex,
        "review this",
        "gpt-5.6-sol",
        "high",
        "fast",
    );
    assert!(codex.windows(2).any(|w| w == ["--model", "gpt-5.6-sol"]));
    assert!(codex
        .windows(2)
        .any(|w| w == ["-c", "model_reasoning_effort=high"]));
    assert!(codex.windows(2).any(|w| w == ["-c", "service_tier=fast"]));
    assert_eq!(codex.last().map(String::as_str), Some("review this"));

    let opencode = native_launch_args(
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
    assert_eq!(opencode.last().map(String::as_str), Some("review this"));
}

#[test]
fn native_launch_args_append_cli_args_except_acp() {
    let mut claude = native_launch_args(ProtocolFamily::Claude, "review this", "", "", "");
    coordy_harness::append_cli_args(ProtocolFamily::Claude, &mut claude, "--foo bar");
    assert!(claude.windows(2).any(|w| w == ["--foo", "bar"]));

    let mut acp = native_launch_args(ProtocolFamily::Acp, "review this", "", "", "");
    coordy_harness::append_cli_args(ProtocolFamily::Acp, &mut acp, "--foo bar");
    assert!(acp.is_empty());
}
