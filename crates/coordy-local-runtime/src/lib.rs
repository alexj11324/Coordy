//! Local IPC, SQLite persistence, Git worktrees, and harness process control.

mod discovery;
mod draft;
mod git;
mod ipc;
mod live;
mod secrets;
mod sqlite;

pub use discovery::{import_agents, list_agents};
pub use git::GitPorts;
pub use ipc::{connect, serve, RpcClient};
pub use secrets::{advisor_key_from_env, resolve_secret, write_secret_ref, SecretStore};
pub use sqlite::SqliteStore;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

use coordy_advisor::{Advisor, DeterministicAdvisor, LlmAdvisor};
use coordy_kernel::{Kernel, Ports};
use coordy_protocol::{Actor, AuthenticatedCommand, Command, CoordyError, HarnessEvent};

use crate::live::LivePorts;

pub struct Runtime {
    pub kernel: Arc<Kernel>,
    pub data_dir: PathBuf,
    pub socket_path: PathBuf,
    pub token: String,
}

impl Runtime {
    pub fn open(data_dir: &Path, socket_path: &Path, token: String) -> Result<Self, CoordyError> {
        std::fs::create_dir_all(data_dir)
            .map_err(|e| CoordyError::unavailable(format!("data dir: {e}")))?;
        let db_path = data_dir.join("coordy.sqlite");
        let store = SqliteStore::open(&db_path)?;
        let world = store.load()?;
        let secrets = SecretStore::open(data_dir);
        let env = secrets.env();
        let advisor: Arc<dyn Advisor> = Arc::new(LlmAdvisor::from_key(env.api_key, env.base_url));
        let (tx, rx) = std::sync::mpsc::channel::<(String, HarnessEvent)>();
        let ports: Arc<dyn Ports> = Arc::new(LivePorts::new(data_dir, tx));
        let kernel = Arc::new(Kernel::with_world(world, ports, advisor));
        let ingest_kernel = Arc::clone(&kernel);
        let persist_path = db_path.clone();
        thread::spawn(move || {
            while let Ok((run_id, event)) = rx.recv() {
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
        thread::spawn(move || loop {
            thread::sleep(std::time::Duration::from_secs(30));
            let now_ms = chrono::Utc::now().timestamp_millis();
            let _ = sweep_kernel.submit_sync(AuthenticatedCommand {
                actor: Actor::Daemon,
                command: Command::SweepAutomations { now_ms },
            });
            if let Ok(store) = SqliteStore::open(&sweep_persist) {
                let _ = store.save(&sweep_kernel.export_world());
            }
        });
        let _ = crate::write_secret_ref(data_dir, "COORDY_ADVISOR_API_KEY");
        Ok(Self {
            kernel,
            data_dir: data_dir.to_path_buf(),
            socket_path: socket_path.to_path_buf(),
            token,
        })
    }

    pub fn persist(&self) -> Result<(), CoordyError> {
        let db_path = self.data_dir.join("coordy.sqlite");
        let store = SqliteStore::open(&db_path)?;
        store.save(&self.kernel.export_world())
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
