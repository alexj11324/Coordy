//! Local IPC, SQLite persistence, Git worktrees, and harness process control.

mod discovery;
mod draft;
mod git;
mod github;
mod ipc;
mod live;
mod secrets;
mod sqlite;

pub use discovery::{import_agents, list_agents};
pub use git::GitPorts;
pub use github::{collect, parse_github_remote, parse_pr_list};
pub use ipc::{connect, serve, RpcClient};
pub use secrets::{advisor_key_from_env, resolve_secret, write_secret_ref, SecretStore};
pub use sqlite::SqliteStore;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;

use coordy_advisor::{Advisor, DeterministicAdvisor, LlmAdvisor};
use coordy_kernel::{Kernel, Ports};
use coordy_protocol::{
    Actor, AuthenticatedCommand, AuthorizedQuery, Command, CoordyError, HarnessEvent, Outcome,
    Query, View,
};

use crate::live::LivePorts;

pub struct Runtime {
    pub kernel: Arc<Kernel>,
    pub data_dir: PathBuf,
    pub socket_path: PathBuf,
    pub token: String,
    persist_gate: Arc<Mutex<()>>,
}

impl Runtime {
    pub fn open(data_dir: &Path, socket_path: &Path, token: String) -> Result<Self, CoordyError> {
        std::fs::create_dir_all(data_dir)
            .map_err(|e| CoordyError::unavailable(format!("data dir: {e}")))?;
        let db_path = data_dir.join("coordy.sqlite");
        let store = SqliteStore::open(&db_path)?;
        let mut world = store.load()?;
        if interrupt_orphaned_executions(&mut world) {
            store.save(&world)?;
        }
        let secrets = SecretStore::open(data_dir);
        let env = secrets.env();
        let advisor: Arc<dyn Advisor> = Arc::new(LlmAdvisor::from_key(env.api_key, env.base_url));
        let (tx, rx) = std::sync::mpsc::channel::<(String, HarnessEvent)>();
        let ports: Arc<dyn Ports> = Arc::new(LivePorts::new(data_dir, tx));
        let kernel = Arc::new(Kernel::with_world(world, ports, advisor));
        let persist_gate = Arc::new(Mutex::new(()));
        let ingest_kernel = Arc::clone(&kernel);
        let persist_path = db_path.clone();
        let ingest_gate = Arc::clone(&persist_gate);
        thread::spawn(move || {
            while let Ok((run_id, event)) = rx.recv() {
                let _gate = ingest_gate.lock().expect("persist gate");
                let _ = ingest_kernel.submit_sync(AuthenticatedCommand {
                    actor: Actor::Daemon,
                    command: Command::IngestHarnessEvent { run_id, event },
                });
                if let Ok(store) = SqliteStore::open(&persist_path) {
                    let _ = store.save(&ingest_kernel.export_world());
                }
            }
        });
        let sweep_kernel = Arc::clone(&kernel);
        let sweep_persist = db_path.clone();
        let sweep_gate = Arc::clone(&persist_gate);
        thread::spawn(move || loop {
            thread::sleep(std::time::Duration::from_secs(30));
            let now_ms = chrono::Utc::now().timestamp_millis();
            let _gate = sweep_gate.lock().expect("persist gate");
            let outcome = sweep_kernel.submit_sync(AuthenticatedCommand {
                actor: Actor::Daemon,
                command: Command::SweepAutomations { now_ms },
            });
            if outcome.as_ref().is_ok_and(automation_sweep_mutated) {
                if let Ok(store) = SqliteStore::open(&sweep_persist) {
                    let _ = store.save(&sweep_kernel.export_world());
                }
            }
            drop(_gate);
            refresh_github_workspaces(&sweep_kernel, &sweep_persist, sweep_gate.as_ref());
        });
        let _ = crate::write_secret_ref(data_dir, "COORDY_ADVISOR_API_KEY");
        Ok(Self {
            kernel,
            data_dir: data_dir.to_path_buf(),
            socket_path: socket_path.to_path_buf(),
            token,
            persist_gate,
        })
    }

    pub fn persist(&self) -> Result<(), CoordyError> {
        let _gate = self.persist_gate.lock().expect("persist gate");
        self.persist_unlocked()
    }

    fn persist_unlocked(&self) -> Result<(), CoordyError> {
        let db_path = self.data_dir.join("coordy.sqlite");
        let store = SqliteStore::open(&db_path)?;
        store.save(&self.kernel.export_world())
    }

    pub fn submit_and_persist(
        &self,
        command: AuthenticatedCommand,
    ) -> Result<Outcome, CoordyError> {
        let command = self.expand_github_refresh(command)?;
        let _gate = self.persist_gate.lock().expect("persist gate");
        let snapshot = self.kernel.export_world();
        match self.kernel.submit_sync(command) {
            Ok(outcome) => {
                if let Err(err) = self.persist_unlocked() {
                    self.kernel.replace_world(snapshot);
                    return Err(err);
                }
                Ok(outcome)
            }
            Err(err) => Err(err),
        }
    }

    fn expand_github_refresh(
        &self,
        command: AuthenticatedCommand,
    ) -> Result<AuthenticatedCommand, CoordyError> {
        let Command::RefreshGithub { workspace_id } = &command.command else {
            return Ok(command);
        };
        if command.actor.is_agent() {
            return Err(CoordyError::denied("agent cannot do this"));
        }
        let workspace_id = workspace_id.clone();
        let settings = self.kernel.view_sync(AuthorizedQuery {
            actor: command.actor,
            query: Query::Settings {
                workspace_id: workspace_id.clone(),
            },
        })?;
        let View::Settings {
            repo_path: repo, ..
        } = settings
        else {
            return Err(CoordyError::unavailable("unexpected settings view"));
        };
        Ok(AuthenticatedCommand {
            actor: Actor::Daemon,
            command: crate::github::collect(repo.as_deref()).into_command(workspace_id),
        })
    }
}

fn interrupt_orphaned_executions(world: &mut coordy_kernel::World) -> bool {
    let mut changed = false;
    for run in &mut world.runs {
        if run.status == "running" {
            run.status = "interrupted".into();
            run.queue_status = "interrupted".into();
            changed = true;
        }
    }
    for attempt in &mut world.node_attempts {
        if matches!(attempt.lease_status.as_str(), "claimed" | "running") {
            attempt.lease_status = "interrupted".into();
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    use coordy_kernel::World;
    use serde_json::json;

    #[test]
    fn open_interrupts_and_persists_orphaned_execution_state() {
        let dir = std::env::temp_dir().join(format!(
            "coordy-interrupted-recovery-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("coordy.sqlite");
        let store = SqliteStore::open(&db_path).unwrap();
        let mut encoded = serde_json::to_value(World::default()).unwrap();
        encoded["runs"] = json!([{
            "id": "run-orphan",
            "workspace_id": "ws-1",
            "task_id": "task-1",
            "agent_id": "agent-1",
            "status": "running",
            "harness": "claude",
            "compaction_count": 0,
            "after_compaction": false,
            "queue_status": "dispatched",
            "retry_count": 0,
            "chat_id": null,
            "trigger": "graph_execute",
            "prompt": "continue",
            "role": "executor"
        }]);
        encoded["node_attempts"] = json!([
            {
                "id": "attempt-bound",
                "graph_run_id": "graph-run-1",
                "workspace_id": "ws-1",
                "node_id": "task-1",
                "role": "executor",
                "input_fingerprint": "fp-bound",
                "lease_status": "running",
                "run_id": "run-orphan"
            },
            {
                "id": "attempt-unbound",
                "graph_run_id": "graph-run-1",
                "workspace_id": "ws-1",
                "node_id": "task-2",
                "role": "executor",
                "input_fingerprint": "fp-unbound",
                "lease_status": "claimed",
                "run_id": null
            }
        ]);
        let world: World = serde_json::from_value(encoded).unwrap();
        store.save(&world).unwrap();
        drop(store);

        let runtime = Runtime::open(&dir, &dir.join("unused.sock"), "tok".into()).unwrap();
        let recovered = runtime.kernel.export_world();
        assert_eq!(recovered.runs[0].status, "interrupted");
        assert_eq!(recovered.runs[0].queue_status, "interrupted");
        assert!(recovered
            .node_attempts
            .iter()
            .all(|attempt| attempt.lease_status == "interrupted"));

        let persisted = SqliteStore::open(&db_path).unwrap().load().unwrap();
        assert_eq!(persisted.runs[0].status, "interrupted");
        assert!(persisted
            .node_attempts
            .iter()
            .all(|attempt| attempt.lease_status == "interrupted"));
    }
}

fn automation_sweep_mutated(outcome: &Outcome) -> bool {
    let armed = outcome
        .ids
        .get("armed")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    let triggered = outcome
        .ids
        .get("triggered")
        .and_then(|value| value.as_array())
        .is_some_and(|rows| !rows.is_empty());
    armed > 0 || triggered
}

fn github_enabled(world: &coordy_kernel::World, workspace_id: &str) -> bool {
    world
        .integrations
        .iter()
        .find(|row| row.workspace_id == workspace_id && row.kind == "github")
        .map(|row| row.enabled)
        .unwrap_or(true)
}

fn refresh_github_workspaces(kernel: &Kernel, persist_path: &Path, gate: &Mutex<()>) {
    let world = kernel.export_world();
    let jobs: Vec<(String, Option<String>)> = world
        .workspaces
        .iter()
        .filter(|ws| {
            !ws.archived
                && github_enabled(&world, &ws.id)
                && ws.repo_path.as_deref().is_some_and(|path| !path.is_empty())
        })
        .map(|ws| (ws.id.clone(), ws.repo_path.clone()))
        .collect();
    for (workspace_id, repo) in jobs {
        let fetched = crate::github::collect(repo.as_deref());
        let _gate = gate.lock().expect("persist gate");
        let outcome = kernel.submit_sync(AuthenticatedCommand {
            actor: Actor::Daemon,
            command: fetched.into_command(workspace_id),
        });
        if outcome.is_ok() {
            if let Ok(store) = SqliteStore::open(persist_path) {
                let _ = store.save(&kernel.export_world());
            }
        }
    }
}

pub fn default_paths() -> Result<(PathBuf, PathBuf), CoordyError> {
    let data = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("coordy");
    #[cfg(windows)]
    {
        let sock = PathBuf::from(format!(
            r"\\.\pipe\coordy-{}",
            std::env::var("USERNAME").unwrap_or_else(|_| "local".into())
        ));
        return Ok((data, sock));
    }
    #[cfg(not(windows))]
    {
        let runtime_dir = std::env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join(format!("coordy-{}", std::process::id())));
        let sock = runtime_dir.join("coordy").join("coordyd.sock");
        Ok((data, sock))
    }
}

pub const ACTIVE_SOCKET_FILE: &str = "daemon.socket";

pub fn write_active_socket(data_dir: &Path, socket: &Path) -> Result<PathBuf, CoordyError> {
    std::fs::create_dir_all(data_dir).map_err(|e| CoordyError::unavailable(e.to_string()))?;
    let path = data_dir.join(ACTIVE_SOCKET_FILE);
    std::fs::write(&path, socket.to_string_lossy().as_bytes())
        .map_err(|e| CoordyError::unavailable(format!("active socket: {e}")))?;
    Ok(path)
}

pub fn read_active_socket(data_dir: &Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(data_dir.join(ACTIVE_SOCKET_FILE)).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

pub fn resolve_cli_socket(
    explicit: Option<PathBuf>,
    data_dir: &Path,
    default_sock: PathBuf,
) -> PathBuf {
    if let Some(socket) = explicit {
        return socket;
    }
    read_active_socket(data_dir).unwrap_or(default_sock)
}

pub fn write_token_file(dir: &Path, token: &str) -> Result<PathBuf, CoordyError> {
    std::fs::create_dir_all(dir).map_err(|e| CoordyError::unavailable(e.to_string()))?;
    let path = dir.join("coordyd.token");
    std::fs::write(&path, token).map_err(|e| CoordyError::unavailable(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(path)
}

pub fn generate_token() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn in_process_kernel() -> Kernel {
    Kernel::new(Arc::new(GitPorts), Arc::new(DeterministicAdvisor))
}
