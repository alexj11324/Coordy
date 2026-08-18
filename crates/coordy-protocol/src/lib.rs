//! Shared DTOs. No business rules.

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: &str = "coordy-local-v1";
pub const PRODUCT_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Live harnesses emit this tool when an ACP/CLI session ends so the kernel
/// can mark the run complete and return the task for review.
pub const HARNESS_SESSION_TOOL: &str = "coordy.session";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Actor {
    Principal { id: String },
    Agent { id: String, principal_id: String },
    Daemon,
}

impl Actor {
    pub fn id(&self) -> &str {
        match self {
            Actor::Principal { id } => id,
            Actor::Agent { id, .. } => id,
            Actor::Daemon => "daemon",
        }
    }

    pub fn principal_id(&self) -> Option<&str> {
        match self {
            Actor::Principal { id } => Some(id),
            Actor::Agent { principal_id, .. } => Some(principal_id),
            Actor::Daemon => None,
        }
    }

    pub fn is_agent(&self) -> bool {
        matches!(self, Actor::Agent { .. })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthenticatedCommand {
    pub actor: Actor,
    pub command: Command,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthorizedQuery {
    pub actor: Actor,
    pub query: Query,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum Command {
    CreateWorkspace {
        name: String,
    },
    CreatePrincipal {
        workspace_id: String,
        name: String,
    },
    CreateAgent {
        workspace_id: String,
        principal_id: String,
        name: String,
        harness: String,
    },
    UpdateAgent {
        agent_id: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        instructions: Option<String>,
        #[serde(default)]
        harness: Option<String>,
    },
    ArchiveAgent {
        agent_id: String,
    },
    Grant {
        workspace_id: String,
        grantee_id: String,
        resource: String,
        action: String,
    },
    RevokeGrant {
        grant_id: String,
    },
    Delegate {
        workspace_id: String,
        from_actor_id: String,
        to_actor_id: String,
        resource: String,
        action: String,
    },
    CreateTask {
        workspace_id: String,
        title: String,
        #[serde(default)]
        description: String,
    },
    AssignTask {
        task_id: String,
        agent_id: String,
    },
    UpdateTask {
        task_id: String,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        description: Option<String>,
    },
    SetTaskStatus {
        task_id: String,
        status: String,
    },
    BindRepository {
        workspace_id: String,
        path: String,
    },
    CreateWorktree {
        task_id: String,
    },
    UpsertCommitment {
        workspace_id: String,
        task_id: Option<String>,
        commitment_type: String,
        claim: String,
        polarity: String,
        authority: String,
        scope: String,
    },
    AppendMemory {
        workspace_id: String,
        visibility: String,
        body: String,
        owner_actor_id: Option<String>,
    },
    PublishMemory {
        memory_id: String,
    },
    ShareMemory {
        memory_id: String,
        to_principal_id: String,
    },
    AcceptShare {
        memory_id: String,
    },
    ProposeContract {
        workspace_id: String,
        title: String,
        body: String,
        participant_ids: Vec<String>,
    },
    ApproveContract {
        contract_id: String,
    },
    StartRun {
        task_id: String,
        source: RunSource,
    },
    CancelRun {
        run_id: String,
    },
    IngestHarnessEvent {
        run_id: String,
        event: HarnessEvent,
    },
    ApplyPatch {
        task_id: String,
        patch: String,
    },
    DeclareDependency {
        workspace_id: String,
        from_id: String,
        to_id: String,
        entity: String,
    },
    SetSettings {
        workspace_id: String,
        llm_advisor_enabled: bool,
    },
    DismissInbox {
        item_id: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum RunSource {
    Jsonl { path: String },
    Codex { prompt: String },
    ClaudeCode { prompt: String },
    OpenCode { prompt: String },
    Acp { prompt: String },
    Fixture { events: Vec<HarnessEvent> },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum HarnessEvent {
    Message {
        role: String,
        content: String,
    },
    Compaction {
        summary: String,
    },
    Tool {
        name: String,
        input: String,
        output: String,
        exit_code: Option<i32>,
    },
    Patch {
        diff: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum Query {
    Health,
    Board { workspace_id: String },
    Commitments { workspace_id: String },
    Principals { workspace_id: String },
    Agents { workspace_id: String },
    Authority { workspace_id: String },
    Memory { workspace_id: String },
    Contracts { workspace_id: String },
    Dependencies { workspace_id: String },
    Conflicts { workspace_id: String },
    Runs { workspace_id: String },
    Run { run_id: String },
    Inbox { workspace_id: String },
    Settings { workspace_id: String },
    AgentContext { agent_id: String },
    Workspaces,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Outcome {
    pub message: String,
    pub ids: serde_json::Value,
    pub blocked: bool,
}

impl Outcome {
    pub fn ok(message: impl Into<String>, ids: serde_json::Value) -> Self {
        Self {
            message: message.into(),
            ids,
            blocked: false,
        }
    }

    pub fn blocked(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            ids: serde_json::json!({}),
            blocked: true,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum View {
    Health(HealthView),
    Workspaces {
        items: Vec<WorkspaceView>,
    },
    Board {
        tasks: Vec<TaskView>,
    },
    Commitments {
        items: Vec<CommitmentView>,
    },
    Principals {
        items: Vec<PrincipalView>,
    },
    Agents {
        items: Vec<AgentView>,
    },
    Authority {
        grants: Vec<GrantView>,
    },
    Memory {
        items: Vec<MemoryView>,
    },
    Contracts {
        items: Vec<ContractView>,
    },
    Dependencies {
        items: Vec<DependencyView>,
    },
    Conflicts {
        items: Vec<ConflictView>,
    },
    Runs {
        items: Vec<RunView>,
    },
    Run {
        run: RunView,
        events: Vec<RunEventView>,
    },
    Inbox {
        items: Vec<InboxView>,
    },
    Settings {
        daemon: HealthView,
        repo_path: Option<String>,
        llm_advisor_enabled: bool,
    },
    AgentContext {
        context: AgentContextView,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct HealthView {
    pub status: String,
    pub version: String,
    pub protocol_version: String,
    pub pid: u32,
    pub workspace_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceView {
    pub id: String,
    pub name: String,
    pub repo_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskView {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub status: String,
    pub assignee_agent_id: Option<String>,
    pub worktree_path: Option<String>,
    pub blocked_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommitmentView {
    pub id: String,
    pub workspace_id: String,
    pub task_id: Option<String>,
    pub commitment_type: String,
    pub claim: String,
    pub polarity: String,
    pub authority: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PrincipalView {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentView {
    pub id: String,
    pub workspace_id: String,
    pub principal_id: String,
    pub name: String,
    pub harness: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub instructions: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct GrantView {
    pub id: String,
    pub grantor_id: String,
    pub grantee_id: String,
    pub resource: String,
    pub action: String,
    pub delegated: bool,
    pub revoked: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemoryView {
    pub id: String,
    pub visibility: String,
    pub owner_actor_id: String,
    pub body: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractView {
    pub id: String,
    pub title: String,
    pub body: String,
    pub status: String,
    pub participant_ids: Vec<String>,
    pub approvals: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct DependencyView {
    pub id: String,
    pub from_id: String,
    pub to_id: String,
    pub entity: String,
    pub valid: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConflictView {
    pub id: String,
    pub summary: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunView {
    pub id: String,
    pub task_id: String,
    pub agent_id: String,
    pub status: String,
    pub harness: String,
    pub compaction_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunEventView {
    pub seq: u32,
    pub kind: String,
    pub payload: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct InboxView {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub related_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentContextView {
    pub agent_id: String,
    pub commitments: Vec<String>,
    pub memory: Vec<MemoryView>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum Effect {
    Ready { cursor: u64 },
    InboxPosted { item: InboxView },
    RunEvent { run_id: String, event: RunEventView },
    Pause { run_id: String, reason: String },
    Replan { run_id: String, reason: String },
    StateChanged { workspace_id: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoordyError {
    pub code: String,
    pub message: String,
}

impl CoordyError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn denied(message: impl Into<String>) -> Self {
        Self::new("denied", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", message)
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid", message)
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new("unavailable", message)
    }
}

impl std::fmt::Display for CoordyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for CoordyError {}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum RpcRequest {
    Submit {
        id: String,
        command: AuthenticatedCommand,
    },
    View {
        id: String,
        query: AuthorizedQuery,
    },
    Subscribe {
        id: String,
        cursor: Option<u64>,
    },
    Health {
        id: String,
    },
    Shutdown {
        id: String,
    },
    SecretsStatus {
        id: String,
    },
    SetSecret {
        id: String,
        provider: String,
        api_key: Option<String>,
        base_url: Option<String>,
        acp_command: Option<String>,
    },
    ClearSecret {
        id: String,
    },
    DiscoverAgents {
        id: String,
        refresh: bool,
    },
    ImportDiscoveredAgents {
        id: String,
        workspace_id: String,
        principal_id: String,
        ids: Option<Vec<String>>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecretStatus {
    pub provider: String,
    pub key_configured: bool,
    pub base_url: Option<String>,
    pub acp_command: Option<String>,
    pub suggested_acp_command: Option<String>,
    pub detected: Vec<DetectedHarnessView>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct DetectedHarnessView {
    pub kind: String,
    pub binary: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct DiscoveredAgentView {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub command: String,
    pub source: String,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportAgentsResult {
    pub imported: Vec<String>,
    pub skipped: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RpcResponse {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<CoordyError>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Handshake {
    pub protocol: String,
    pub token: String,
    pub client: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct HandshakeAck {
    pub ok: bool,
    pub version: String,
    pub protocol: String,
}
