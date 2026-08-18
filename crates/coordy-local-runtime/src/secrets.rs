//! Secret *references* only. Values are resolved from the process environment
//! or an OS keychain lookup name; they are never written into SQLite.

use std::path::{Path, PathBuf};

use coordy_protocol::CoordyError;

pub fn write_secret_ref(dir: &Path, name: &str) -> Result<PathBuf, CoordyError> {
    std::fs::create_dir_all(dir).map_err(|e| CoordyError::unavailable(e.to_string()))?;
    let path = dir.join("advisor.keyref");
    std::fs::write(&path, name).map_err(|e| CoordyError::unavailable(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(path)
}

pub fn resolve_secret(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

pub fn advisor_key_from_env() -> Option<String> {
    resolve_secret("COORDY_ADVISOR_API_KEY")
}
