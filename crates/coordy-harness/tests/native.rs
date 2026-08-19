use coordy_harness::{parse_native_line, ProtocolFamily};
use coordy_protocol::HarnessEvent;

#[test]
fn claude_stream_json_assistant_text() {
    let event = parse_native_line(
        ProtocolFamily::Claude,
        r#"{"type":"assistant","message":{"content":[{"type":"text","text":"hello native"}]}}"#,
    )
    .expect("parsed");
    assert!(matches!(
        event,
        HarnessEvent::Message { role, content }
            if role == "assistant" && content == "hello native"
    ));
}

#[test]
fn cursor_stream_json_tool_use() {
    let event = parse_native_line(
        ProtocolFamily::Cursor,
        r#"{"type":"tool_call","subtype":"started","call_id":"call-1","tool_call":{"readToolCall":{"args":{"path":"src/lib.rs"}}}}"#,
    )
    .expect("parsed");
    assert!(matches!(
        event,
        HarnessEvent::Tool { name, input, .. }
            if name == "read" && input.contains("src/lib.rs")
    ));
}

#[test]
fn provider_specific_envelopes_map_without_generic_message_fallbacks() {
    let copilot = parse_native_line(
        ProtocolFamily::Copilot,
        r#"{"type":"assistant.message","data":{"content":"copilot text"}}"#,
    )
    .expect("copilot dotted event");
    assert!(matches!(copilot, HarnessEvent::Message { content, .. } if content == "copilot text"));

    let opencode = parse_native_line(
        ProtocolFamily::OpenCode,
        r#"{"type":"text","part":{"text":"opencode text"}}"#,
    )
    .expect("opencode part");
    assert!(
        matches!(opencode, HarnessEvent::Message { content, .. } if content == "opencode text")
    );

    let pi = parse_native_line(
        ProtocolFamily::Pi,
        r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"pi text"}}"#,
    )
    .expect("pi assistant message event");
    assert!(matches!(pi, HarnessEvent::Message { content, .. } if content == "pi text"));
}

#[test]
fn jsonl_families_ignore_unparsed_lines() {
    assert!(parse_native_line(ProtocolFamily::Claude, "not json").is_none());
    assert!(parse_native_line(ProtocolFamily::Cursor, "").is_none());
}
