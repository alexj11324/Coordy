use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use coordy_kernel::{sync_omits_private_memory, Kernel, World};
use coordy_protocol::{Actor, AuthenticatedCommand, Command, Outcome};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex as AsyncMutex;

use crate::auth::{TeamRole, VerifiedIdentity};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database error")]
    Database(#[from] rusqlite::Error),
    #[error("stored state is invalid")]
    State(#[from] serde_json::Error),
    #[error("team workspace was not provisioned")]
    NotFound,
    #[error("administrator role required")]
    Forbidden,
    #[error("stale workspace version")]
    Conflict,
    #[error("idempotency key was reused with different input")]
    IdempotencyConflict,
    #[error("shared-data policy rejected the request")]
    UnsafeData,
    #[error("kernel rejected the mutation")]
    Kernel,
}

#[derive(Clone)]
pub struct Store {
    path: Arc<PathBuf>,
    workspace_locks: Arc<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    pub id: String,
    pub version: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MutationResult {
    pub outcome: Outcome,
    pub version: i64,
    pub duplicate: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttachmentInput {
    pub name: String,
    pub content_type: String,
    pub content_base64: String,
    pub shared: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttachmentOutput {
    pub id: String,
    pub name: String,
    pub content_type: String,
    pub content_base64: String,
    pub version: i64,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let store = Self {
            path: Arc::new(path.as_ref().to_path_buf()),
            workspace_locks: Arc::new(Mutex::new(HashMap::new())),
        };
        let connection = store.connection()?;
        connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS tenants (
                org_id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL UNIQUE,
                state_json TEXT NOT NULL,
                version INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS principals (
                org_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                principal_id TEXT NOT NULL,
                role TEXT NOT NULL,
                PRIMARY KEY (org_id, user_id),
                FOREIGN KEY (org_id) REFERENCES tenants(org_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS idempotency (
                org_id TEXT NOT NULL,
                key TEXT NOT NULL,
                request_json TEXT NOT NULL,
                response_json TEXT NOT NULL,
                version INTEGER NOT NULL,
                PRIMARY KEY (org_id, key),
                FOREIGN KEY (org_id) REFERENCES tenants(org_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                principal_id TEXT NOT NULL,
                action TEXT NOT NULL,
                target TEXT NOT NULL,
                version INTEGER NOT NULL,
                at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS attachments (
                id TEXT PRIMARY KEY,
                org_id TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                name TEXT NOT NULL,
                content_type TEXT NOT NULL,
                body BLOB NOT NULL,
                created_by TEXT NOT NULL,
                version INTEGER NOT NULL,
                FOREIGN KEY (org_id) REFERENCES tenants(org_id) ON DELETE CASCADE
            );
            "#,
        )?;
        Ok(store)
    }

    fn connection(&self) -> Result<Connection, StoreError> {
        let connection = Connection::open(self.path.as_ref())?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA user_version=1;",
        )?;
        Ok(connection)
    }

    fn workspace_lock(&self, org_id: &str) -> Arc<AsyncMutex<()>> {
        let mut locks = self.workspace_locks.lock().expect("workspace lock map");
        locks
            .entry(org_id.to_string())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone()
    }

    pub fn list(&self, identity: &VerifiedIdentity) -> Result<Vec<WorkspaceInfo>, StoreError> {
        let connection = self.connection()?;
        let row = connection
            .query_row(
                "SELECT workspace_id, version FROM tenants WHERE org_id = ?1",
                params![identity.org_id],
                |row| {
                    Ok(WorkspaceInfo {
                        id: row.get(0)?,
                        version: row.get(1)?,
                    })
                },
            )
            .optional()?;
        Ok(row.into_iter().collect())
    }

    pub async fn provision(
        &self,
        identity: &VerifiedIdentity,
        name: &str,
    ) -> Result<WorkspaceInfo, StoreError> {
        if !identity.role.can_administer() {
            return Err(StoreError::Forbidden);
        }
        if name.trim().is_empty() || name.len() > 200 {
            return Err(StoreError::UnsafeData);
        }
        let lock = self.workspace_lock(&identity.org_id);
        let _guard = lock.lock().await;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(existing) = transaction
            .query_row(
                "SELECT workspace_id, version FROM tenants WHERE org_id = ?1",
                params![identity.org_id],
                |row| {
                    Ok(WorkspaceInfo {
                        id: row.get(0)?,
                        version: row.get(1)?,
                    })
                },
            )
            .optional()?
        {
            transaction.commit()?;
            return Ok(existing);
        }

        let kernel = Kernel::default_in_process();
        let workspace = kernel
            .submit_sync(AuthenticatedCommand {
                actor: Actor::Daemon,
                command: Command::CreateWorkspace {
                    name: name.trim().to_string(),
                },
            })
            .map_err(|_| StoreError::Kernel)?;
        let workspace_id = workspace.ids["workspace_id"]
            .as_str()
            .ok_or(StoreError::Kernel)?
            .to_string();
        let principal = kernel
            .submit_sync(AuthenticatedCommand {
                actor: Actor::Daemon,
                command: Command::CreatePrincipal {
                    workspace_id: workspace_id.clone(),
                    name: identity.user_id.clone(),
                },
            })
            .map_err(|_| StoreError::Kernel)?;
        let principal_id = principal.ids["principal_id"]
            .as_str()
            .ok_or(StoreError::Kernel)?;
        let world = kernel.export_world();
        validate_world_for_storage(&world)?;
        let state_json = serde_json::to_string(&world)?;
        transaction.execute(
            "INSERT INTO tenants (org_id, workspace_id, state_json, version) VALUES (?1, ?2, ?3, 1)",
            params![identity.org_id, workspace_id, state_json],
        )?;
        transaction.execute(
            "INSERT INTO principals (org_id, user_id, principal_id, role) VALUES (?1, ?2, ?3, ?4)",
            params![
                identity.org_id,
                identity.user_id,
                principal_id,
                identity.role.as_str()
            ],
        )?;
        insert_audit(
            &transaction,
            identity,
            principal_id,
            "workspace_provisioned",
            &workspace_id,
            1,
        )?;
        transaction.commit()?;
        Ok(WorkspaceInfo {
            id: workspace_id,
            version: 1,
        })
    }

    pub async fn session(
        &self,
        identity: &VerifiedIdentity,
    ) -> Result<(String, String, World, i64), StoreError> {
        let lock = self.workspace_lock(&identity.org_id);
        let _guard = lock.lock().await;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (workspace_id, state_json, mut version): (String, String, i64) = transaction
            .query_row(
                "SELECT workspace_id, state_json, version FROM tenants WHERE org_id = ?1",
                params![identity.org_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?
            .ok_or(StoreError::NotFound)?;
        let mut world: World = serde_json::from_str(&state_json)?;
        let principal = transaction
            .query_row(
                "SELECT principal_id FROM principals WHERE org_id = ?1 AND user_id = ?2",
                params![identity.org_id, identity.user_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let principal_id = if let Some(principal_id) = principal {
            transaction.execute(
                "UPDATE principals SET role = ?3 WHERE org_id = ?1 AND user_id = ?2",
                params![identity.org_id, identity.user_id, identity.role.as_str()],
            )?;
            principal_id
        } else {
            let kernel = Kernel::default_in_process();
            kernel.replace_world(world);
            let outcome = kernel
                .submit_sync(AuthenticatedCommand {
                    actor: Actor::Daemon,
                    command: Command::CreatePrincipal {
                        workspace_id: workspace_id.clone(),
                        name: identity.user_id.clone(),
                    },
                })
                .map_err(|_| StoreError::Kernel)?;
            let principal_id = outcome.ids["principal_id"]
                .as_str()
                .ok_or(StoreError::Kernel)?
                .to_string();
            world = kernel.export_world();
            validate_world_for_storage(&world)?;
            version += 1;
            transaction.execute(
                "UPDATE tenants SET state_json = ?2, version = ?3 WHERE org_id = ?1",
                params![identity.org_id, serde_json::to_string(&world)?, version],
            )?;
            transaction.execute(
                "INSERT INTO principals (org_id, user_id, principal_id, role) VALUES (?1, ?2, ?3, ?4)",
                params![identity.org_id, identity.user_id, principal_id, identity.role.as_str()],
            )?;
            insert_audit(
                &transaction,
                identity,
                &principal_id,
                "principal_provisioned",
                &workspace_id,
                version,
            )?;
            principal_id
        };
        transaction.commit()?;
        Ok((workspace_id, principal_id, world, version))
    }

    pub async fn mutate(
        &self,
        identity: &VerifiedIdentity,
        command: Command,
        idempotency_key: &str,
        expected_version: Option<i64>,
    ) -> Result<MutationResult, StoreError> {
        if idempotency_key.trim().is_empty() || idempotency_key.len() > 200 {
            return Err(StoreError::UnsafeData);
        }
        validate_shared_command(&command, &identity.role)?;
        let request_json = serde_json::to_string(&command)?;
        let lock = self.workspace_lock(&identity.org_id);
        let _guard = lock.lock().await;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some((stored_request, response_json, version)) = transaction
            .query_row(
                "SELECT request_json, response_json, version FROM idempotency WHERE org_id = ?1 AND key = ?2",
                params![identity.org_id, idempotency_key],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?)),
            )
            .optional()?
        {
            if stored_request != request_json {
                return Err(StoreError::IdempotencyConflict);
            }
            let outcome = serde_json::from_str(&response_json)?;
            return Ok(MutationResult { outcome, version, duplicate: true });
        }
        let (workspace_id, state_json, version): (String, String, i64) = transaction
            .query_row(
                "SELECT workspace_id, state_json, version FROM tenants WHERE org_id = ?1",
                params![identity.org_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?
            .ok_or(StoreError::NotFound)?;
        if expected_version.is_some_and(|expected| expected != version) {
            return Err(StoreError::Conflict);
        }
        let principal_id: String = transaction
            .query_row(
                "SELECT principal_id FROM principals WHERE org_id = ?1 AND user_id = ?2",
                params![identity.org_id, identity.user_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(StoreError::Forbidden)?;
        let world: World = serde_json::from_str(&state_json)?;
        let kernel = Kernel::default_in_process();
        kernel.replace_world(world);
        let action = command_name(&command);
        let outcome = kernel
            .submit_sync(AuthenticatedCommand {
                actor: Actor::Principal {
                    id: principal_id.clone(),
                },
                command,
            })
            .map_err(|_| StoreError::Kernel)?;
        let next_version = version + 1;
        let next_world = kernel.export_world();
        validate_world_for_storage(&next_world)?;
        let next_state = serde_json::to_string(&next_world)?;
        let updated = transaction.execute(
            "UPDATE tenants SET state_json = ?2, version = ?3 WHERE org_id = ?1 AND version = ?4",
            params![identity.org_id, next_state, next_version, version],
        )?;
        if updated != 1 {
            return Err(StoreError::Conflict);
        }
        let response_json = serde_json::to_string(&outcome)?;
        transaction.execute(
            "INSERT INTO idempotency (org_id, key, request_json, response_json, version) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![identity.org_id, idempotency_key, request_json, response_json, next_version],
        )?;
        insert_audit(
            &transaction,
            identity,
            &principal_id,
            action,
            &workspace_id,
            next_version,
        )?;
        transaction.commit()?;
        Ok(MutationResult {
            outcome,
            version: next_version,
            duplicate: false,
        })
    }

    pub fn audit(&self, identity: &VerifiedIdentity) -> Result<Vec<Value>, StoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT user_id, principal_id, action, target, version, at FROM audit WHERE org_id = ?1 ORDER BY id",
        )?;
        let rows = statement.query_map(params![identity.org_id], |row| {
            Ok(serde_json::json!({
                "user_id": row.get::<_, String>(0)?,
                "principal_id": row.get::<_, String>(1)?,
                "action": row.get::<_, String>(2)?,
                "target": row.get::<_, String>(3)?,
                "version": row.get::<_, i64>(4)?,
                "at": row.get::<_, String>(5)?,
            }))
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    pub async fn upload_attachment(
        &self,
        identity: &VerifiedIdentity,
        input: AttachmentInput,
    ) -> Result<AttachmentOutput, StoreError> {
        if !input.shared
            || input.name.is_empty()
            || input.name.len() > 255
            || input.name.contains(['/', '\\'])
            || input.name == "."
            || input.name == ".."
            || input.content_type.len() > 200
        {
            return Err(StoreError::UnsafeData);
        }
        let body = STANDARD
            .decode(&input.content_base64)
            .map_err(|_| StoreError::UnsafeData)?;
        if body.len() > 5 * 1024 * 1024 {
            return Err(StoreError::UnsafeData);
        }
        let (workspace_id, principal_id, _, version) = self.session(identity).await?;
        let id = format!("att_{}", uuid::Uuid::new_v4().simple());
        let next_version = version + 1;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO attachments (id, org_id, workspace_id, name, content_type, body, created_by, version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, identity.org_id, workspace_id, input.name, input.content_type, body, principal_id, next_version],
        )?;
        let updated = transaction.execute(
            "UPDATE tenants SET version = ?2 WHERE org_id = ?1 AND version = ?3",
            params![identity.org_id, next_version, version],
        )?;
        if updated != 1 {
            return Err(StoreError::Conflict);
        }
        insert_audit(
            &transaction,
            identity,
            &principal_id,
            "attachment_uploaded",
            &id,
            next_version,
        )?;
        transaction.commit()?;
        Ok(AttachmentOutput {
            id,
            name: input.name,
            content_type: input.content_type,
            content_base64: STANDARD.encode(body),
            version: next_version,
        })
    }

    pub fn attachment(
        &self,
        identity: &VerifiedIdentity,
        attachment_id: &str,
    ) -> Result<AttachmentOutput, StoreError> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT name, content_type, body, version FROM attachments WHERE id = ?1 AND org_id = ?2",
                params![attachment_id, identity.org_id],
                |row| {
                    let body: Vec<u8> = row.get(2)?;
                    Ok(AttachmentOutput {
                        id: attachment_id.to_string(),
                        name: row.get(0)?,
                        content_type: row.get(1)?,
                        content_base64: STANDARD.encode(body),
                        version: row.get(3)?,
                    })
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound)
    }
}

fn insert_audit(
    transaction: &rusqlite::Transaction<'_>,
    identity: &VerifiedIdentity,
    principal_id: &str,
    action: &str,
    target: &str,
    version: i64,
) -> Result<(), rusqlite::Error> {
    transaction.execute(
        "INSERT INTO audit (org_id, user_id, principal_id, action, target, version, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            identity.org_id,
            identity.user_id,
            principal_id,
            action,
            target,
            version,
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn validate_shared_command(command: &Command, role: &TeamRole) -> Result<(), StoreError> {
    let encoded = serde_json::to_value(command).map_err(StoreError::State)?;
    if contains_private_data(&encoded) {
        return Err(StoreError::UnsafeData);
    }
    let allowed = match command {
        Command::UpdateWorkspace { .. } => role.can_administer(),
        Command::CreateTask { .. }
        | Command::UpdateTask { .. }
        | Command::SetTaskStatus { .. }
        | Command::DeleteTask { .. }
        | Command::SubscribeTask { .. }
        | Command::UnsubscribeTask { .. }
        | Command::ReorderTasks { .. }
        | Command::UpsertCommitment { .. }
        | Command::ProposeContract { .. }
        | Command::ApproveContract { .. }
        | Command::ReaffirmDependency { .. }
        | Command::RemoveDependency { .. }
        | Command::AddIssueBlocker { .. }
        | Command::RemoveIssueBlocker { .. }
        | Command::SetNotificationPrefs { .. }
        | Command::CreateProject { .. }
        | Command::UpdateProject { .. }
        | Command::DeleteProject { .. }
        | Command::AddComment { .. }
        | Command::ResolveComment { .. }
        | Command::SetCommentConclusion { .. }
        | Command::AddReaction { .. }
        | Command::CreateLabel { .. }
        | Command::DeleteLabel { .. }
        | Command::SetCustomPropertyDef { .. }
        | Command::LinkPullRequest { .. }
        | Command::UnlinkPullRequest { .. } => true,
        Command::AppendMemory {
            visibility,
            owner_actor_id,
            ..
        } => visibility == "shared" && owner_actor_id.is_none(),
        Command::DeclareDependency { selector_path, .. } => selector_path.is_none(),
        _ => false,
    };
    if allowed {
        Ok(())
    } else if matches!(command, Command::UpdateWorkspace { .. }) {
        Err(StoreError::Forbidden)
    } else {
        Err(StoreError::UnsafeData)
    }
}

fn validate_world_for_storage(world: &World) -> Result<(), StoreError> {
    let encoded = serde_json::to_value(world).map_err(StoreError::State)?;
    if !sync_omits_private_memory(world) || contains_private_data(&encoded) {
        return Err(StoreError::UnsafeData);
    }
    Ok(())
}

fn contains_private_data(value: &Value) -> bool {
    match value {
        Value::Object(fields) => fields.iter().any(|(key, value)| {
            let forbidden_field = matches!(
                key.as_str(),
                "path"
                    | "repo_path"
                    | "worktree_path"
                    | "api_key"
                    | "token"
                    | "secret"
                    | "config"
                    | "cli_args"
                    | "mcp_servers"
                    | "tool_access"
                    | "acp_command"
            ) && !value.is_null()
                && value.as_str() != Some("")
                && value.as_array().is_none_or(|items| !items.is_empty());
            let private_visibility = key == "visibility" && value.as_str() != Some("shared");
            forbidden_field || private_visibility || contains_private_data(value)
        }),
        Value::Array(items) => items.iter().any(contains_private_data),
        Value::String(text) => {
            text.starts_with("/Users/")
                || text.starts_with("/home/")
                || text.starts_with("/etc/")
                || text.starts_with("file://")
                || (text.len() > 3
                    && text.as_bytes()[1] == b':'
                    && matches!(text.as_bytes()[2], b'\\' | b'/'))
                || text.contains("api_key=")
                || text.starts_with("sk_live_")
                || text.starts_with("sk_test_")
        }
        _ => false,
    }
}

fn command_name(command: &Command) -> &'static str {
    match command {
        Command::UpdateWorkspace { .. } => "update_workspace",
        Command::CreateTask { .. } => "create_task",
        Command::UpdateTask { .. } => "update_task",
        Command::SetTaskStatus { .. } => "set_task_status",
        Command::DeleteTask { .. } => "delete_task",
        Command::AppendMemory { .. } => "append_shared_memory",
        Command::CreateProject { .. } => "create_project",
        Command::AddComment { .. } => "add_comment",
        _ => "shared_mutation",
    }
}
