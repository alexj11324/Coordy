//! Local IPC, SQLite persistence, Git worktrees, and harness process control.

mod git;
mod ipc;
mod secrets;
mod sqlite;

pub use git::GitPorts;
pub use ipc::{connect, serve, RpcClient};
pub use secrets::{advisor_key_from_env, resolve_secret, write_secret_ref};
pub use sqlite::SqliteStore;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use coordy_advisor::{Advisor, DeterministicAdvisor, LlmAdvisor};
use coordy_kernel::{Kernel, Ports};
use coordy_protocol::CoordyError;

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
        let advisor: Arc<dyn Advisor> = Arc::new(LlmAdvisor::from_env());
        let ports: Arc<dyn Ports> = Arc::new(GitPorts);
        let kernel = Arc::new(Kernel::with_world(world, ports, advisor));
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
