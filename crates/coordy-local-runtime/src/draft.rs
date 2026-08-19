//! BYOK JSON completions for Agent Builder and issue split suggestions.

use coordy_protocol::{CoordyError, DraftCompletion};
use serde_json::{json, Value};

use crate::secrets::SecretStore;

pub async fn complete_draft(
    store: &SecretStore,
    kind: &str,
    prompt: &str,
) -> Result<DraftCompletion, CoordyError> {
    let env = store.env();
    let api_key = env.api_key.filter(|key| !key.is_empty()).ok_or_else(|| {
        CoordyError::unavailable("未配置模型密钥。请在设置 → 模型密钥中填写后再使用对话起草。")
    })?;
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err(CoordyError::invalid("prompt cannot be empty"));
    }
    let (system, user) = match kind {
        "agent" => (
            "You draft a local coding agent. Reply with JSON only: {\"name\",\"description\",\"instructions\"}. No markdown.",
            prompt,
        ),
        "subtasks" => (
            "Split the issue into concrete child titles. Reply with JSON only: {\"titles\":[\"...\"]}. 3 to 6 short titles. No markdown.",
            prompt,
        ),
        other => {
            return Err(CoordyError::invalid(format!("unknown draft kind: {other}")));
        }
    };
    let text = if env.provider == "anthropic" {
        call_anthropic(&api_key, env.base_url.as_deref(), system, user).await?
    } else {
        call_openai(&api_key, env.base_url.as_deref(), system, user).await?
    };
    parse_draft(kind, &text)
}

fn parse_draft(kind: &str, text: &str) -> Result<DraftCompletion, CoordyError> {
    let json_text =
        extract_json(text).ok_or_else(|| CoordyError::unavailable("model did not return JSON"))?;
    let value: Value = serde_json::from_str(json_text)
        .map_err(|err| CoordyError::unavailable(format!("model JSON: {err}")))?;
    let mut out = DraftCompletion {
        kind: kind.into(),
        ..DraftCompletion::default()
    };
    out.name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    out.description = value
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    out.instructions = value
        .get("instructions")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if let Some(titles) = value.get("titles").and_then(Value::as_array) {
        out.titles = titles
            .iter()
            .filter_map(Value::as_str)
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect();
    }
    if kind == "agent" && out.name.is_empty() && out.instructions.is_empty() {
        return Err(CoordyError::unavailable(
            "model did not fill an agent draft",
        ));
    }
    if kind == "subtasks" && out.titles.is_empty() {
        return Err(CoordyError::unavailable("model did not return titles"));
    }
    Ok(out)
}

fn extract_json(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end < start {
        return None;
    }
    Some(&text[start..=end])
}

async fn call_openai(
    api_key: &str,
    base_url: Option<&str>,
    system: &str,
    user: &str,
) -> Result<String, CoordyError> {
    let base = base_url
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .unwrap_or("https://api.openai.com/v1");
    let url = format!("{}/chat/completions", base.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&json!({
            "model": "gpt-4.1-mini",
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user}
            ]
        }))
        .send()
        .await
        .map_err(|err| CoordyError::unavailable(format!("llm request: {err}")))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(CoordyError::unavailable(format!("llm {status}: {body}")));
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|err| CoordyError::unavailable(format!("llm decode: {err}")))?;
    payload
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| CoordyError::unavailable("llm returned an empty completion"))
}

async fn call_anthropic(
    api_key: &str,
    base_url: Option<&str>,
    system: &str,
    user: &str,
) -> Result<String, CoordyError> {
    let base = base_url
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .unwrap_or("https://api.anthropic.com");
    let url = format!("{}/v1/messages", base.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({
            "model": "claude-sonnet-4-6",
            "max_tokens": 800,
            "system": system,
            "messages": [{"role": "user", "content": user}]
        }))
        .send()
        .await
        .map_err(|err| CoordyError::unavailable(format!("llm request: {err}")))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(CoordyError::unavailable(format!("llm {status}: {body}")));
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|err| CoordyError::unavailable(format!("llm decode: {err}")))?;
    payload
        .pointer("/content/0/text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| CoordyError::unavailable("llm returned an empty completion"))
}

#[cfg(test)]
mod tests {
    use super::parse_draft;

    #[test]
    fn parse_agent_json() {
        let draft = parse_draft(
            "agent",
            "```json\n{\"name\":\"审查员\",\"description\":\"看 PR\",\"instructions\":\"只评论\"}\n```",
        )
        .unwrap();
        assert_eq!(draft.name, "审查员");
        assert_eq!(draft.instructions, "只评论");
    }

    #[test]
    fn parse_subtask_titles() {
        let draft = parse_draft("subtasks", "{\"titles\":[\"拆登录\",\"写测试\"]}").unwrap();
        assert_eq!(draft.titles, vec!["拆登录", "写测试"]);
    }
}
