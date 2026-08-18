//! Secret *references* and BYOK values. Keys are 0600 files, never SQLite.

use std::path::{Path, PathBuf};

use coordy_harness::{detect_on_path, SecretEnv};
use coordy_protocol::{CoordyError, DetectedHarnessView, SecretStatus};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
struct SecretMeta {
    #[serde(default)]
    provider: String,
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    acp_command: Option<String>,
}

pub struct SecretStore {
    dir: PathBuf,
}

impl SecretStore {
    pub fn open(data_dir: &Path) -> Self {
        Self {
            dir: data_dir.join("secrets"),
        }
    }

    fn meta_path(&self) -> PathBuf {
        self.dir.join("meta.json")
    }

    fn key_path(&self) -> PathBuf {
        self.dir.join("api_key")
    }

    fn load_meta(&self) -> SecretMeta {
        std::fs::read_to_string(self.meta_path())
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn write_meta(&self, meta: &SecretMeta) -> Result<(), CoordyError> {
        std::fs::create_dir_all(&self.dir)
            .map_err(|e| CoordyError::unavailable(format!("secrets dir: {e}")))?;
        std::fs::write(
            self.meta_path(),
            serde_json::to_vec_pretty(meta).unwrap_or_else(|_| b"{}".to_vec()),
        )
        .map_err(|e| CoordyError::unavailable(format!("write secret meta: {e}")))
    }

    fn write_key_file(&self, value: &str) -> Result<(), CoordyError> {
        std::fs::create_dir_all(&self.dir)
            .map_err(|e| CoordyError::unavailable(format!("secrets dir: {e}")))?;
        let path = self.key_path();
        std::fs::write(&path, value)
            .map_err(|e| CoordyError::unavailable(format!("write api key: {e}")))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    pub fn api_key(&self) -> Option<String> {
        std::fs::read_to_string(self.key_path())
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .or_else(|| {
                std::env::var("COORDY_ADVISOR_API_KEY")
                    .ok()
                    .filter(|v| !v.is_empty())
            })
            .or_else(|| {
                std::env::var("OPENAI_API_KEY")
                    .ok()
                    .filter(|v| !v.is_empty())
            })
            .or_else(|| {
                std::env::var("ANTHROPIC_API_KEY")
                    .ok()
                    .filter(|v| !v.is_empty())
            })
    }

    pub fn env(&self) -> SecretEnv {
        let meta = self.load_meta();
        SecretEnv {
            provider: if meta.provider.is_empty() {
                "openai".into()
            } else {
                meta.provider
            },
            api_key: self.api_key(),
            base_url: meta.base_url,
            acp_command: meta.acp_command,
        }
    }

    pub fn status(&self) -> SecretStatus {
        let meta = self.load_meta();
        SecretStatus {
            provider: if meta.provider.is_empty() {
                "openai".into()
            } else {
                meta.provider
            },
            key_configured: self.api_key().is_some(),
            base_url: meta.base_url,
            acp_command: meta.acp_command,
            suggested_acp_command: coordy_harness::suggested_acp_stub_command(),
            detected: detect_on_path()
                .into_iter()
                .map(|h| DetectedHarnessView {
                    kind: h.kind,
                    binary: h.binary,
                })
                .collect(),
        }
    }

    pub fn set(
        &self,
        provider: String,
        api_key: Option<String>,
        base_url: Option<String>,
        acp_command: Option<String>,
    ) -> Result<SecretStatus, CoordyError> {
        let mut meta = self.load_meta();
        if !provider.trim().is_empty() {
            meta.provider = provider;
        }
        if let Some(url) = base_url {
            meta.base_url = if url.trim().is_empty() {
                None
            } else {
                Some(url)
            };
        }
        if let Some(cmd) = acp_command {
            meta.acp_command = if cmd.trim().is_empty() {
                None
            } else {
                Some(cmd)
            };
        }
        self.write_meta(&meta)?;
        if let Some(key) = api_key {
            if key.trim().is_empty() {
                let _ = std::fs::remove_file(self.key_path());
            } else {
                self.write_key_file(key.trim())?;
            }
        }
        Ok(self.status())
    }

    pub fn clear(&self) -> Result<SecretStatus, CoordyError> {
        let _ = std::fs::remove_file(self.key_path());
        Ok(self.status())
    }
}

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
