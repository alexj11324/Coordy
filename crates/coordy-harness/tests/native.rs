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
        r#"{"type":"tool_call","name":"Read","input":{"path":"src/lib.rs"}}"#,
    )
    .expect("parsed");
    assert!(matches!(
        event,
        HarnessEvent::Tool { name, input, .. }
            if name == "Read" && input.contains("src/lib.rs")
    ));
}

#[test]
fn jsonl_families_ignore_unparsed_lines() {
    assert!(parse_native_line(ProtocolFamily::Claude, "not json").is_none());
    assert!(parse_native_line(ProtocolFamily::Cursor, "").is_none());
}
