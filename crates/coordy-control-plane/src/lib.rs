//! Shared control plane. Private memory never enters the sync batch.
//!
//! Local single-player mode does not need this process. When it is running,
//! the in-memory snapshot is the shared-contract authority for connected
//! daemons. PostgreSQL is intentionally not required for this experiment.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use coordy_kernel::{parse_sync_projection, sync_batch, sync_omits_private_memory, World};
use coordy_protocol::{CoordyError, HandshakeAck, PRODUCT_VERSION, PROTOCOL_VERSION};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Default)]
pub struct SharedState {
    inner: Arc<Mutex<SharedWorld>>,
}

#[derive(Default)]
struct SharedWorld {
    membership: HashMap<String, Vec<String>>,
    snapshots: HashMap<String, Value>,
    audit: Vec<Value>,
    invalidations: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SyncPush {
    pub workspace_id: String,
    pub principal_id: String,
    pub batch: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InvalidateReq {
    pub workspace_id: String,
    pub entity: String,
    pub reason: String,
}

impl SharedState {
    pub fn admit(
        &self,
        world: &World,
        workspace_id: &str,
        principal_id: &str,
    ) -> Result<Value, CoordyError> {
        if !sync_omits_private_memory(world) {
            return Err(CoordyError::denied("sync batch contained private memory"));
        }
        let batch = sync_batch(world);
        let encoded = serde_json::to_string(&batch).unwrap_or_default();
        if encoded.contains("agent_private") {
            return Err(CoordyError::denied("private memory leaked into sync batch"));
        }
        let mut inner = self.inner.lock().expect("shared lock");
        let members = inner.membership.entry(workspace_id.into()).or_default();
        if !members.iter().any(|m| m == principal_id) {
            members.push(principal_id.into());
        }
        inner.snapshots.insert(workspace_id.into(), batch.clone());
        inner.audit.push(serde_json::json!({
            "action": "sync_push",
            "workspace_id": workspace_id,
            "principal_id": principal_id,
        }));
        Ok(batch)
    }

    pub fn snapshot(&self, workspace_id: &str) -> Option<Value> {
        self.inner
            .lock()
            .expect("shared lock")
            .snapshots
            .get(workspace_id)
            .cloned()
    }

    pub fn members(&self, workspace_id: &str) -> Vec<String> {
        self.inner
            .lock()
            .expect("shared lock")
            .membership
            .get(workspace_id)
            .cloned()
            .unwrap_or_default()
    }

    pub fn audit(&self) -> Vec<Value> {
        self.inner.lock().expect("shared lock").audit.clone()
    }

    pub fn push_sync(&self, body: SyncPush) -> Result<PushOutcome, CoordyError> {
        match serde_json::from_value::<World>(body.batch.clone()) {
            Ok(parsed) => {
                let batch = self.admit(&parsed, &body.workspace_id, &body.principal_id)?;
                Ok(PushOutcome::World { batch })
            }
            Err(_) => {
                let projection = parse_sync_projection(&body.batch)?;
                let mut inner = self.inner.lock().expect("shared lock");
                inner
                    .snapshots
                    .insert(body.workspace_id.clone(), projection);
                inner.audit.push(serde_json::json!({
                    "action": "sync_push",
                    "workspace_id": body.workspace_id,
                    "principal_id": body.principal_id,
                    "mode": "projection",
                }));
                Ok(PushOutcome::Projection)
            }
        }
    }

    pub fn invalidate(&self, req: InvalidateReq) {
        let mut inner = self.inner.lock().expect("shared lock");
        inner.audit.push(serde_json::json!({
            "action": "invalidate",
            "workspace_id": req.workspace_id,
            "entity": req.entity,
            "reason": req.reason,
        }));
        inner
            .invalidations
            .push(serde_json::to_value(&req).unwrap());
    }

    pub fn invalidations(&self) -> Vec<Value> {
        self.inner
            .lock()
            .expect("shared lock")
            .invalidations
            .clone()
    }
}

#[derive(Clone, Debug)]
pub enum PushOutcome {
    World { batch: Value },
    Projection,
}

pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/sync/push", post(push))
        .route("/v1/sync/pull", post(pull))
        .route("/v1/members", post(members))
        .route("/v1/audit", get(audit))
        .route("/v1/invalidate", post(invalidate))
        .with_state(state)
}

async fn health() -> Json<HandshakeAck> {
    Json(HandshakeAck {
        ok: true,
        version: PRODUCT_VERSION.into(),
        protocol: PROTOCOL_VERSION.into(),
    })
}

async fn push(State(state): State<SharedState>, Json(body): Json<SyncPush>) -> Json<Value> {
    match state.push_sync(body) {
        Ok(PushOutcome::World { batch }) => Json(serde_json::json!({ "ok": true, "batch": batch })),
        Ok(PushOutcome::Projection) => {
            Json(serde_json::json!({ "ok": true, "mode": "projection" }))
        }
        Err(err) => Json(serde_json::json!({ "ok": false, "error": err })),
    }
}

#[derive(Deserialize)]
struct PullReq {
    workspace_id: String,
}

async fn pull(State(state): State<SharedState>, Json(body): Json<PullReq>) -> Json<Value> {
    Json(serde_json::json!({
        "ok": true,
        "batch": state.snapshot(&body.workspace_id),
        "members": state.members(&body.workspace_id),
    }))
}

#[derive(Deserialize)]
struct MembersReq {
    workspace_id: String,
}

async fn members(State(state): State<SharedState>, Json(body): Json<MembersReq>) -> Json<Value> {
    Json(serde_json::json!({
        "ok": true,
        "members": state.members(&body.workspace_id),
    }))
}

async fn audit(State(state): State<SharedState>) -> Json<Value> {
    Json(serde_json::json!({ "ok": true, "audit": state.audit() }))
}

async fn invalidate(
    State(state): State<SharedState>,
    Json(body): Json<InvalidateReq>,
) -> Json<Value> {
    state.invalidate(body);
    Json(serde_json::json!({ "ok": true }))
}

pub async fn serve(bind: &str, state: SharedState) -> Result<(), std::io::Error> {
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, router(state)).await
}
