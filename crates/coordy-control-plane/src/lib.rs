//! Durable, Clerk-authenticated authority for explicitly shared team state.
//!
//! `coordyd` remains the local authority. This service accepts only the shared
//! command allowlist and never receives local Agent runtime state or secrets.

mod auth;
mod store;

use std::path::Path;
use std::sync::Arc;

use axum::extract::{Path as AxumPath, Query as AxumQuery, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use coordy_kernel::Kernel;
use coordy_protocol::{
    Actor, AuthorizedQuery, Command, HandshakeAck, Query, PRODUCT_VERSION, PROTOCOL_VERSION,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub use auth::{
    validate_claims, Audience, AuthError, ClerkConfig, ClerkMembershipVerifier, ClerkVerifier,
    OrganizationClaims, SessionClaims, TeamRole, VerifiedIdentity,
};
pub use store::{
    AttachmentInput, AttachmentOutput, MutationResult, Store, StoreError, WorkspaceInfo,
};

#[derive(Clone)]
pub struct ControlPlane {
    auth: Arc<ClerkVerifier>,
    membership: Option<Arc<ClerkMembershipVerifier>>,
    store: Store,
}

impl ControlPlane {
    pub fn open(
        database_path: impl AsRef<Path>,
        clerk: ClerkConfig,
        clerk_secret_key: String,
    ) -> Result<Self, ControlPlaneError> {
        Ok(Self {
            auth: Arc::new(ClerkVerifier::new(clerk)?),
            membership: Some(Arc::new(ClerkMembershipVerifier::new(clerk_secret_key)?)),
            store: Store::open(database_path)?,
        })
    }

    pub fn from_parts(auth: ClerkVerifier, store: Store) -> Self {
        Self {
            auth: Arc::new(auth),
            membership: None,
            store,
        }
    }

    async fn identity(&self, headers: &HeaderMap) -> Result<VerifiedIdentity, ApiError> {
        let authorization = headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok());
        let identity = self
            .auth
            .verify_bearer(authorization)
            .await
            .map_err(ApiError::Auth)?;
        match &self.membership {
            Some(membership) => membership.verify(identity).await.map_err(ApiError::Auth),
            None => Ok(identity),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ControlPlaneError {
    #[error(transparent)]
    Auth(#[from] AuthError),
    #[error(transparent)]
    Store(#[from] StoreError),
}

#[derive(Debug)]
enum ApiError {
    Auth(AuthError),
    Store(StoreError),
    BadRequest(&'static str),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, detail) = match self {
            Self::Auth(AuthError::Keys | AuthError::MembershipUnavailable) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "auth_keys_unavailable",
                "auth_keys_unavailable",
            ),
            Self::Auth(AuthError::Configuration(_)) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "auth_configuration",
                "auth_configuration",
            ),
            Self::Auth(_) => (StatusCode::UNAUTHORIZED, "unauthorized", "unauthorized"),
            Self::Store(StoreError::Forbidden) => (StatusCode::FORBIDDEN, "forbidden", "forbidden"),
            Self::Store(StoreError::NotFound) => (StatusCode::NOT_FOUND, "not_found", "not_found"),
            Self::Store(StoreError::Conflict) => {
                (StatusCode::CONFLICT, "version_conflict", "version_conflict")
            }
            Self::Store(StoreError::IdempotencyConflict) => (
                StatusCode::CONFLICT,
                "idempotency_conflict",
                "idempotency_conflict",
            ),
            Self::Store(StoreError::UnsafeData) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "unsafe_shared_data",
                "unsafe_shared_data",
            ),
            Self::Store(StoreError::Kernel) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "kernel_rejected",
                "kernel_rejected",
            ),
            Self::Store(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "storage_error",
                "storage_error",
            ),
            Self::BadRequest(detail) => (StatusCode::BAD_REQUEST, "bad_request", detail),
        };
        (
            status,
            Json(json!({ "ok": false, "error": { "code": code, "detail": detail } })),
        )
            .into_response()
    }
}

impl From<StoreError> for ApiError {
    fn from(value: StoreError) -> Self {
        Self::Store(value)
    }
}

#[derive(Deserialize)]
struct ProvisionRequest {
    name: String,
}

#[derive(Deserialize)]
struct SubmitRequest {
    command: Command,
    idempotency_key: String,
    #[serde(default)]
    expected_version: Option<i64>,
}

#[derive(Deserialize)]
struct ViewRequest {
    query: Query,
}

#[derive(Deserialize)]
struct WatchRequest {
    #[serde(default)]
    cursor: Option<u64>,
}

#[derive(Serialize)]
struct Versioned<T> {
    ok: bool,
    version: i64,
    data: T,
}

pub fn router(state: ControlPlane) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/config", get(config))
        .route("/v1/workspaces", get(workspaces))
        .route("/v1/workspaces/provision", post(provision))
        .route("/v1/submit", post(submit))
        .route("/v1/view", post(view))
        .route("/v1/watch", get(watch))
        .route("/v1/audit", get(audit))
        .route("/v1/attachments", post(upload_attachment))
        .route("/v1/attachments/:id", get(download_attachment))
        .with_state(state)
}

async fn health() -> Json<HandshakeAck> {
    Json(HandshakeAck {
        ok: true,
        version: PRODUCT_VERSION.into(),
        protocol: PROTOCOL_VERSION.into(),
    })
}

async fn config() -> Json<Value> {
    Json(json!({
        "auth": "clerk_oauth_pkce",
        "active_organization_required": true,
        "membership_authority": "clerk_backend_api",
        "idempotency_required": true,
    }))
}

async fn workspaces(
    State(state): State<ControlPlane>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let identity = state.identity(&headers).await?;
    let items = state.store.list(&identity)?;
    Ok(Json(json!({ "ok": true, "items": items })))
}

async fn provision(
    State(state): State<ControlPlane>,
    headers: HeaderMap,
    Json(body): Json<ProvisionRequest>,
) -> Result<Json<Value>, ApiError> {
    let identity = state.identity(&headers).await?;
    let workspace = state.store.provision(&identity, &body.name).await?;
    Ok(Json(json!({ "ok": true, "workspace": workspace })))
}

async fn submit(
    State(state): State<ControlPlane>,
    headers: HeaderMap,
    Json(body): Json<SubmitRequest>,
) -> Result<Json<Versioned<Value>>, ApiError> {
    let identity = state.identity(&headers).await?;
    state.store.session(&identity).await?;
    let result = state
        .store
        .mutate(
            &identity,
            body.command,
            &body.idempotency_key,
            body.expected_version,
        )
        .await?;
    Ok(Json(Versioned {
        ok: true,
        version: result.version,
        data: json!({ "outcome": result.outcome, "duplicate": result.duplicate }),
    }))
}

async fn view(
    State(state): State<ControlPlane>,
    headers: HeaderMap,
    Json(body): Json<ViewRequest>,
) -> Result<Json<Versioned<Value>>, ApiError> {
    let identity = state.identity(&headers).await?;
    let (_, principal_id, world, version) = state.store.session(&identity).await?;
    let kernel = Kernel::default_in_process();
    kernel.replace_world(world);
    let result = kernel
        .view_sync(AuthorizedQuery {
            actor: Actor::Principal { id: principal_id },
            query: body.query,
        })
        .map_err(|_| ApiError::BadRequest("kernel rejected query"))?;
    Ok(Json(Versioned {
        ok: true,
        version,
        data: serde_json::to_value(result).map_err(StoreError::from)?,
    }))
}

async fn watch(
    State(state): State<ControlPlane>,
    headers: HeaderMap,
    AxumQuery(body): AxumQuery<WatchRequest>,
) -> Result<Json<Versioned<Value>>, ApiError> {
    let identity = state.identity(&headers).await?;
    let (_, _, world, version) = state.store.session(&identity).await?;
    let kernel = Kernel::default_in_process();
    kernel.replace_world(world);
    Ok(Json(Versioned {
        ok: true,
        version,
        data: json!({ "effects": kernel.watch(body.cursor) }),
    }))
}

async fn audit(
    State(state): State<ControlPlane>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let identity = state.identity(&headers).await?;
    let entries = state.store.audit(&identity)?;
    Ok(Json(json!({ "ok": true, "audit": entries })))
}

async fn upload_attachment(
    State(state): State<ControlPlane>,
    headers: HeaderMap,
    Json(body): Json<AttachmentInput>,
) -> Result<Json<Value>, ApiError> {
    let identity = state.identity(&headers).await?;
    let attachment = state.store.upload_attachment(&identity, body).await?;
    Ok(Json(json!({ "ok": true, "attachment": attachment })))
}

async fn download_attachment(
    State(state): State<ControlPlane>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, ApiError> {
    let identity = state.identity(&headers).await?;
    let attachment = state.store.attachment(&identity, &id)?;
    Ok(Json(json!({ "ok": true, "attachment": attachment })))
}

pub async fn serve(bind: &str, state: ControlPlane) -> Result<(), std::io::Error> {
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, router(state)).await
}
