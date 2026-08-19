use coordy_protocol::CoordyError;
use coordy_protocol::HarnessEvent;

pub fn read_jsonl(path: &str) -> Result<Vec<HarnessEvent>, CoordyError> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| CoordyError::invalid(format!("jsonl read {path}: {e}")))?;
    parse_jsonl(&text)
}

pub fn parse_jsonl(text: &str) -> Result<Vec<HarnessEvent>, CoordyError> {
    let mut events = Vec::new();
    for (i, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let ev: HarnessEvent = serde_json::from_str(line)
            .map_err(|e| CoordyError::invalid(format!("jsonl line {}: {e}", i + 1)))?;
        events.push(ev);
    }
    Ok(events)
}
