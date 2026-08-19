use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use coordy_harness::{canonical_harness_id, discover, kill_child, SecretEnv};
use coordy_protocol::{
    Actor, AgentView, AuthorizedQuery, CoordyError, HarnessEvent, Query, TaskSplitSuggestion, View,
};
use serde_json::Value;

use crate::live::run_kind;
use crate::{Runtime, SecretStore};

const SUGGEST_TIMEOUT: Duration = Duration::from_secs(120);

pub async fn suggest_task_split(
    runtime: &Runtime,
    workspace_id: &str,
    task_id: &str,
    principal_id: &str,
) -> Result<TaskSplitSuggestion, CoordyError> {
    let actor = Actor::Principal {
        id: principal_id.to_string(),
    };
    let tasks = match runtime
        .kernel
        .view(AuthorizedQuery {
            actor: actor.clone(),
            query: Query::Board {
                workspace_id: workspace_id.to_string(),
            },
        })
        .await?
    {
        View::Board { tasks } => tasks,
        _ => return Err(CoordyError::unavailable("unexpected task view")),
    };
    let task = tasks
        .into_iter()
        .find(|task| task.id == task_id)
        .ok_or_else(|| CoordyError::not_found("task not found"))?;
    let agents = match runtime
        .kernel
        .view(AuthorizedQuery {
            actor: actor.clone(),
            query: Query::Agents {
                workspace_id: workspace_id.to_string(),
            },
        })
        .await?
    {
        View::Agents { items } => items,
        _ => return Err(CoordyError::unavailable("unexpected agent view")),
    };
    let agent = resolve_assigned_agent(task.assignee_agent_id.as_deref(), &agents)?.clone();
    if !runtime.kernel.can_command_agent(&actor, &agent.id) {
        return Err(CoordyError::denied("cannot command this agent"));
    }
    ensure_installed(&runtime.data_dir, &agent)?;

    let prompt = split_prompt(&task.title, &task.description);
    let data_dir = runtime.data_dir.clone();
    let run_id = format!("task-split-{}", uuid::Uuid::new_v4());
    let timeout_id = run_id.clone();
    let handle =
        tokio::task::spawn_blocking(move || run_advisory(&data_dir, &agent, &prompt, &run_id));
    match tokio::time::timeout(SUGGEST_TIMEOUT, handle).await {
        Ok(joined) => {
            joined.map_err(|error| CoordyError::unavailable(format!("拆分执行异常：{error}")))?
        }
        Err(_) => {
            let _ = kill_child(&timeout_id);
            Err(CoordyError::unavailable("拆分建议超时，请稍后重试。"))
        }
    }
}

fn resolve_assigned_agent<'a>(
    assignee_id: Option<&str>,
    agents: &'a [AgentView],
) -> Result<&'a AgentView, CoordyError> {
    let assignee_id = assignee_id
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| CoordyError::invalid("请先为任务分配智能体。"))?;
    agents
        .iter()
        .find(|agent| agent.id == assignee_id)
        .ok_or_else(|| CoordyError::not_found("任务负责人不存在或已归档。"))
}

fn ensure_installed(data_dir: &Path, agent: &AgentView) -> Result<(), CoordyError> {
    let registry = std::fs::read_to_string(data_dir.join("cache/acp-registry.json")).ok();
    let wanted = canonical_harness_id(&agent.harness);
    let installed = discover(registry.as_deref())
        .into_iter()
        .any(|item| canonical_harness_id(&item.id) == wanted && item.installed);
    if installed {
        Ok(())
    } else {
        Err(CoordyError::unavailable(format!(
            "{} 尚未安装，无法生成拆分建议。",
            agent.name
        )))
    }
}

fn run_advisory(
    data_dir: &Path,
    agent: &AgentView,
    prompt: &str,
    run_id: &str,
) -> Result<TaskSplitSuggestion, CoordyError> {
    let workdir = AdvisoryDir::create(data_dir, run_id)?;
    let stored = SecretStore::open(data_dir).env();
    let secrets = SecretEnv {
        acp_command: stored.acp_command,
        ..SecretEnv::default()
    };
    let registry = std::fs::read_to_string(data_dir.join("cache/acp-registry.json")).ok();
    let mut messages = Vec::new();
    run_kind(
        &agent.harness,
        workdir.path().to_string_lossy().as_ref(),
        prompt,
        &agent.model,
        &agent.thinking,
        &agent.speed,
        &agent.cli_args,
        "auto",
        run_id,
        &secrets,
        registry.as_deref(),
        |event| {
            if let HarnessEvent::Message { role, content } = event {
                if role == "assistant" && !content.starts_with("thinking:") {
                    messages.push(content);
                }
            }
        },
    )?;
    parse_titles(&messages.join(""))
}

fn split_prompt(title: &str, description: &str) -> String {
    format!(
        "把以下任务拆成 2 到 5 个可独立执行的子事项。只返回 JSON，不要 Markdown，不要解释。格式：{{\"titles\":[\"子事项一\",\"子事项二\"]}}\n\n任务标题：{}\n任务描述：{}",
        title.trim(),
        description.trim()
    )
}

fn parse_titles(text: &str) -> Result<TaskSplitSuggestion, CoordyError> {
    let trimmed = text.trim();
    let json = if trimmed.starts_with("```") {
        let body = trimmed
            .strip_prefix("```json")
            .or_else(|| trimmed.strip_prefix("```"))
            .ok_or_else(|| CoordyError::invalid("智能体没有返回有效的拆分结果。"))?;
        body.trim()
            .strip_suffix("```")
            .ok_or_else(|| CoordyError::invalid("智能体没有返回有效的拆分结果。"))?
            .trim()
    } else {
        trimmed
    };
    let value: Value = serde_json::from_str(json)
        .map_err(|_| CoordyError::invalid("智能体没有返回有效的拆分结果。"))?;
    let raw = value
        .get("titles")
        .and_then(Value::as_array)
        .ok_or_else(|| CoordyError::invalid("拆分结果缺少 titles。"))?;
    let mut seen = HashSet::new();
    let mut titles = Vec::new();
    for item in raw {
        let title = item
            .as_str()
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .ok_or_else(|| CoordyError::invalid("拆分标题不能为空。"))?;
        if seen.insert(title.to_string()) {
            titles.push(title.to_string());
        }
    }
    if !(2..=5).contains(&titles.len()) {
        return Err(CoordyError::invalid("拆分结果必须包含 2 到 5 个不同标题。"));
    }
    Ok(TaskSplitSuggestion { titles })
}

struct AdvisoryDir(PathBuf);

impl AdvisoryDir {
    fn create(data_dir: &Path, run_id: &str) -> Result<Self, CoordyError> {
        let path = data_dir.join("tmp").join(run_id);
        std::fs::create_dir_all(&path)
            .map_err(|error| CoordyError::unavailable(format!("创建临时目录：{error}")))?;
        Ok(Self(path))
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for AdvisoryDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_titles, resolve_assigned_agent, split_prompt, suggest_task_split};
    use crate::Runtime;
    use coordy_protocol::{Actor, AgentView, AuthenticatedCommand, Command};

    fn agent(id: &str) -> AgentView {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "workspace_id": "ws",
            "principal_id": "principal",
            "name": "执行者",
            "harness": "codex"
        }))
        .unwrap()
    }

    #[test]
    fn parses_strict_and_fenced_title_lists() {
        assert_eq!(
            parse_titles(r#"{"titles":["调研","实现","实现"]}"#)
                .unwrap()
                .titles,
            vec!["调研", "实现"]
        );
        assert_eq!(
            parse_titles("```json\n{\"titles\":[\"A\",\"B\"]}\n```")
                .unwrap()
                .titles,
            vec!["A", "B"]
        );
    }

    #[test]
    fn rejects_malformed_or_out_of_range_results() {
        assert!(parse_titles("not json").is_err());
        assert!(parse_titles("结果如下：{\"titles\":[\"A\",\"B\"]}").is_err());
        assert!(parse_titles("```json\n{\"titles\":[\"A\",\"B\"]}").is_err());
        assert!(parse_titles(r#"{"titles":["only one"]}"#).is_err());
        assert!(parse_titles(r#"{"titles":["A",2]}"#).is_err());
    }

    #[test]
    fn resolves_only_the_task_assignee() {
        let agents = vec![agent("a1"), agent("a2")];
        assert_eq!(
            resolve_assigned_agent(Some("a2"), &agents).unwrap().id,
            "a2"
        );
        assert!(resolve_assigned_agent(None, &agents).is_err());
        assert!(resolve_assigned_agent(Some("archived"), &agents).is_err());
    }

    #[test]
    fn prompt_requests_json_without_api_credentials() {
        let prompt = split_prompt("任务", "说明");
        assert!(prompt.contains("只返回 JSON"));
        assert!(!prompt.to_lowercase().contains("api key"));
    }

    #[tokio::test]
    async fn rejects_a_workspace_peer_who_cannot_command_the_assigned_agent() {
        let dir = std::env::temp_dir().join(format!(
            "coordy-suggest-auth-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let runtime = Runtime::open(&dir, &dir.join("unused.sock"), "tok".into()).unwrap();
        let submit =
            |actor, command| runtime.submit_and_persist(AuthenticatedCommand { actor, command });
        let workspace_id = submit(
            Actor::Daemon,
            Command::CreateWorkspace {
                name: "restricted".into(),
            },
        )
        .unwrap()
        .ids["workspace_id"]
            .as_str()
            .unwrap()
            .to_string();
        let owner_id = submit(
            Actor::Daemon,
            Command::CreatePrincipal {
                workspace_id: workspace_id.clone(),
                name: "Owner".into(),
            },
        )
        .unwrap()
        .ids["principal_id"]
            .as_str()
            .unwrap()
            .to_string();
        let peer_id = submit(
            Actor::Daemon,
            Command::CreatePrincipal {
                workspace_id: workspace_id.clone(),
                name: "Peer".into(),
            },
        )
        .unwrap()
        .ids["principal_id"]
            .as_str()
            .unwrap()
            .to_string();
        let owner = Actor::Principal {
            id: owner_id.clone(),
        };
        let agent_id = submit(
            owner.clone(),
            Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: owner_id,
                name: "Private".into(),
                harness: "definitely-not-installed".into(),
            },
        )
        .unwrap()
        .ids["agent_id"]
            .as_str()
            .unwrap()
            .to_string();
        let task_id = submit(
            owner.clone(),
            Command::CreateTask {
                workspace_id: workspace_id.clone(),
                title: "Split me".into(),
                description: String::new(),
            },
        )
        .unwrap()
        .ids["task_id"]
            .as_str()
            .unwrap()
            .to_string();
        submit(
            owner,
            Command::AssignTask {
                task_id: task_id.clone(),
                agent_id,
            },
        )
        .unwrap();

        let error = suggest_task_split(&runtime, &workspace_id, &task_id, &peer_id)
            .await
            .expect_err("workspace peers cannot run owner-only agents");
        assert_eq!(error.code, "denied");
        assert_eq!(error.message, "cannot command this agent");
        assert!(
            !dir.join("tmp").exists(),
            "authorization must precede spawn"
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
