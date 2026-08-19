//! ACP registry fetch + import of discovered agents into the kernel.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use coordy_harness::{canonical_harness_id, discover};
use coordy_protocol::{
    Actor, AuthenticatedCommand, AuthorizedQuery, Command, CoordyError, DiscoveredAgentView,
    ImportAgentsResult, Query, View,
};

use crate::Runtime;

const REGISTRY_URL: &str = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const CACHE_NAME: &str = "acp-registry.json";
const CACHE_META: &str = "acp-registry.fetched";
const CACHE_TTL_SECS: u64 = 6 * 3600;

fn cache_dir(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("cache")
}

fn load_cached_registry(data_dir: &Path) -> Option<String> {
    std::fs::read_to_string(cache_dir(data_dir).join(CACHE_NAME))
        .ok()
        .filter(|text| !text.trim().is_empty())
}

fn cache_is_fresh(data_dir: &Path) -> bool {
    let meta = cache_dir(data_dir).join(CACHE_META);
    let Ok(text) = std::fs::read_to_string(meta) else {
        return false;
    };
    let Ok(saved) = text.trim().parse::<u64>() else {
        return false;
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    now.saturating_sub(saved) < CACHE_TTL_SECS
}

fn store_cache(data_dir: &Path, body: &str) {
    let dir = cache_dir(data_dir);
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(dir.join(CACHE_NAME), body);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = std::fs::write(dir.join(CACHE_META), now.to_string());
}

async fn fetch_registry(data_dir: &Path, refresh: bool) -> Option<String> {
    if let Ok(path) = std::env::var("COORDY_ACP_REGISTRY_PATH") {
        return std::fs::read_to_string(path).ok();
    }
    if !refresh && cache_is_fresh(data_dir) {
        if let Some(cached) = load_cached_registry(data_dir) {
            return Some(cached);
        }
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .build()
        .ok()?;
    let body = client
        .get(REGISTRY_URL)
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    if body.contains("\"agents\"") {
        store_cache(data_dir, &body);
        return Some(body);
    }
    load_cached_registry(data_dir)
}

pub async fn list_agents(data_dir: &Path, refresh: bool) -> Vec<DiscoveredAgentView> {
    let registry = fetch_registry(data_dir, refresh).await;
    discover(registry.as_deref())
}

pub async fn import_agents(
    runtime: &Runtime,
    workspace_id: String,
    principal_id: String,
    ids: Option<Vec<String>>,
) -> Result<ImportAgentsResult, CoordyError> {
    let catalog = list_agents(&runtime.data_dir, false).await;
    let existing = match runtime.kernel.view_sync(AuthorizedQuery {
        actor: Actor::Daemon,
        query: Query::Agents {
            workspace_id: workspace_id.clone(),
        },
    })? {
        View::Agents { items } => items,
        _ => Vec::new(),
    };
    let wanted: Vec<&DiscoveredAgentView> = match ids {
        Some(list) if !list.is_empty() => catalog
            .iter()
            .filter(|agent| {
                agent.installed
                    && !agent.command.trim().is_empty()
                    && list.iter().any(|id| id == &agent.id)
            })
            .collect(),
        _ => catalog
            .iter()
            .filter(|agent| agent.installed && !agent.command.trim().is_empty())
            .collect(),
    };
    let mut imported = Vec::new();
    let mut skipped = Vec::new();
    if !wanted.is_empty() {
        for agent in &existing {
            if matches!(agent.harness.as_str(), "acp" | "jsonl") {
                let _ = runtime.kernel.submit_sync(AuthenticatedCommand {
                    actor: Actor::Daemon,
                    command: Command::ArchiveAgent {
                        agent_id: agent.id.clone(),
                    },
                });
            }
        }
    }
    for agent in wanted {
        if existing
            .iter()
            .any(|item| canonical_harness_id(&item.harness) == canonical_harness_id(&agent.id))
        {
            skipped.push(agent.id.clone());
            continue;
        }
        runtime.kernel.submit_sync(AuthenticatedCommand {
            actor: Actor::Daemon,
            command: Command::CreateAgent {
                workspace_id: workspace_id.clone(),
                principal_id: principal_id.clone(),
                name: agent.name.clone(),
                harness: agent.id.clone(),
            },
        })?;
        imported.push(agent.id.clone());
    }
    runtime.persist()?;
    Ok(ImportAgentsResult { imported, skipped })
}
