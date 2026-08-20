use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use coordy_protocol::{GraphEdgeKind, GraphEdgeState, NodeRef};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EffectRecord {
    pub cursor: u64,
    pub effect: coordy_protocol::Effect,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct World {
    pub workspaces: Vec<Workspace>,
    pub principals: Vec<Principal>,
    pub agents: Vec<Agent>,
    pub grants: Vec<Grant>,
    pub commitments: Vec<Commitment>,
    pub memories: Vec<MemoryRecord>,
    pub tasks: Vec<Task>,
    pub contracts: Vec<Contract>,
    pub dependencies: Vec<GraphEdge>,
    pub conflicts: Vec<Conflict>,
    pub runs: Vec<Run>,
    pub run_events: Vec<RunEvent>,
    pub inbox: Vec<InboxItem>,
    pub audit: Vec<AuditEntry>,
    pub snapshots: Vec<CompactionSnapshot>,
    pub effects: Vec<EffectRecord>,
    pub paused_runs: Vec<String>,
    #[serde(default)]
    pub llm_advisor_enabled: bool,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub squads: Vec<Squad>,
    #[serde(default)]
    pub skills: Vec<Skill>,
    #[serde(default)]
    pub automations: Vec<Automation>,
    #[serde(default)]
    pub comments: Vec<Comment>,
    #[serde(default)]
    pub chats: Vec<Chat>,
    #[serde(default)]
    pub chat_messages: Vec<ChatMessage>,
    #[serde(default)]
    pub labels: Vec<WorkspaceLabel>,
    #[serde(default)]
    pub custom_property_defs: Vec<CustomPropertyDef>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub subscriptions: Vec<TaskSubscription>,
    #[serde(default)]
    pub computers: Vec<Computer>,
    #[serde(default)]
    pub directory_locks: Vec<DirectoryLock>,
    #[serde(default)]
    pub integrations: Vec<Integration>,
    #[serde(default)]
    pub github: Vec<GithubState>,
    #[serde(default)]
    pub notification_kinds: Vec<String>,
    #[serde(default)]
    pub reactions: Vec<Reaction>,
    #[serde(default)]
    pub issue_blockers: Vec<IssueBlockerEdge>,
    #[serde(default)]
    pub materializations: Vec<NodeMaterialization>,
    #[serde(default)]
    pub node_artifacts: HashMap<String, u64>,
    #[serde(default)]
    pub graph_events: Vec<GraphEvent>,
    #[serde(default)]
    pub graph_revision: u64,
    #[serde(default)]
    pub graph_runs: Vec<GraphRun>,
    #[serde(default)]
    pub node_attempts: Vec<NodeAttempt>,
    #[serde(default)]
    pub task_plan_proposals: Vec<TaskPlanProposalRecord>,
    #[serde(default)]
    pub task_plan_applications: Vec<TaskPlanApplication>,
    #[serde(default)]
    pub task_plan_auto_completed_parent_ids: Vec<String>,
    #[serde(default)]
    pub task_plan_artifact_errors: Vec<TaskPlanArtifactError>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskPlanArtifactError {
    pub chat_id: String,
    pub run_id: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskPlanProposalRecord {
    pub id: String,
    pub revision: u64,
    pub created_by: String,
    pub created_at: String,
    pub draft: coordy_protocol::TaskPlanDraft,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskPlanApplication {
    pub proposal_id: String,
    pub proposal_revision: u64,
    pub idempotency_key: String,
    pub applied_by: String,
    pub applied_at: String,
    pub mode: coordy_protocol::TaskPlanApplyMode,
    pub parent_task_id: String,
    pub child_task_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub repo_path: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub context: String,
    #[serde(default)]
    pub slug: String,
    #[serde(default = "default_issue_prefix")]
    pub issue_prefix: String,
    #[serde(default = "default_next_issue")]
    pub next_issue_number: u64,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub conductor_agent_id: Option<String>,
}

fn default_issue_prefix() -> String {
    "COOR".into()
}

fn default_next_issue() -> u64 {
    1
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Principal {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    #[serde(default = "default_member_role")]
    pub role: String,
}

fn default_member_role() -> String {
    "member".into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub workspace_id: String,
    pub principal_id: String,
    pub name: String,
    pub harness: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub avatar: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub thinking: String,
    #[serde(default)]
    pub speed: String,
    #[serde(default = "default_access")]
    pub access: String,
    #[serde(default)]
    pub access_member_ids: Vec<String>,
    #[serde(default = "default_agent_concurrency")]
    pub concurrency_limit: u32,
    #[serde(default)]
    pub cli_args: String,
    #[serde(default = "default_tool_access")]
    pub tool_access: String,
    #[serde(default)]
    pub mcp_servers: Vec<String>,
    #[serde(default)]
    pub skill_ids: Vec<String>,
}

fn default_access() -> String {
    "owner".into()
}

fn default_agent_concurrency() -> u32 {
    6
}

fn default_tool_access() -> String {
    "auto".into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Grant {
    pub id: String,
    pub workspace_id: String,
    pub grantor_id: String,
    pub grantee_id: String,
    pub resource: String,
    pub action: String,
    pub delegated: bool,
    pub revoked: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Commitment {
    pub id: String,
    pub workspace_id: String,
    pub task_id: Option<String>,
    pub commitment_type: String,
    pub claim: String,
    pub polarity: String,
    pub authority: String,
    pub status: String,
    pub scope: String,
    pub owner_actor_id: String,
    pub superseded_by: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MemoryRecord {
    pub id: String,
    pub workspace_id: String,
    pub visibility: String,
    pub owner_actor_id: String,
    pub body: String,
    pub status: String,
    pub share_to: Option<String>,
    pub source_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub status: String,
    pub assignee_agent_id: Option<String>,
    pub worktree_path: Option<String>,
    pub blocked_reason: Option<String>,
    #[serde(default)]
    pub identifier: String,
    #[serde(default)]
    pub number: u64,
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub custom_fields: Vec<coordy_protocol::CustomFieldValue>,
    #[serde(default)]
    pub assignee_principal_id: Option<String>,
    #[serde(default)]
    pub assignee_squad_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub stage: String,
    #[serde(default)]
    pub sort_key: i64,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub pull_requests: Vec<coordy_protocol::PullRequestView>,
}

fn default_priority() -> String {
    "none".into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Contract {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub body: String,
    pub status: String,
    pub participant_ids: Vec<String>,
    pub approvals: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(from = "GraphEdgeWire")]
pub struct GraphEdge {
    pub id: String,
    pub workspace_id: String,
    pub source: NodeRef,
    pub target: NodeRef,
    pub kind: GraphEdgeKind,
    pub entity: String,
    pub state: GraphEdgeState,
    pub generation: u64,
    #[serde(default)]
    pub origin_run_id: Option<String>,
    #[serde(default)]
    pub actor_id: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub source_event: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub selector_path: Option<String>,
    #[serde(default)]
    pub observed_version: Option<u64>,
    #[serde(default)]
    pub current_version: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
struct GraphEdgeWire {
    id: String,
    workspace_id: String,
    #[serde(default)]
    source: Option<NodeRef>,
    #[serde(default)]
    target: Option<NodeRef>,
    #[serde(default)]
    from_id: Option<String>,
    #[serde(default)]
    to_id: Option<String>,
    #[serde(default)]
    kind: Option<GraphEdgeKind>,
    entity: String,
    #[serde(default)]
    valid: Option<bool>,
    #[serde(default)]
    state: Option<GraphEdgeState>,
    #[serde(default)]
    generation: Option<u64>,
    #[serde(default)]
    origin_run_id: Option<String>,
    #[serde(default)]
    actor_id: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    source_event: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    selector_path: Option<String>,
    #[serde(default)]
    observed_version: Option<u64>,
    #[serde(default)]
    current_version: Option<u64>,
}

impl From<GraphEdgeWire> for GraphEdge {
    fn from(wire: GraphEdgeWire) -> Self {
        let source = wire
            .source
            .unwrap_or_else(|| NodeRef::task(wire.to_id.clone().unwrap_or_default()));
        let target = wire
            .target
            .unwrap_or_else(|| NodeRef::task(wire.from_id.clone().unwrap_or_default()));
        let state = wire.state.unwrap_or_else(|| {
            if wire.valid.unwrap_or(true) {
                GraphEdgeState::Active
            } else {
                GraphEdgeState::Stale
            }
        });
        Self {
            id: wire.id,
            workspace_id: wire.workspace_id,
            source,
            target,
            kind: wire.kind.unwrap_or(GraphEdgeKind::Consumes),
            entity: wire.entity,
            state,
            generation: wire.generation.unwrap_or(1),
            origin_run_id: wire.origin_run_id,
            actor_id: wire.actor_id,
            reason: wire.reason,
            source_event: wire.source_event,
            created_at: wire.created_at.unwrap_or_default(),
            selector_path: wire.selector_path,
            observed_version: wire.observed_version,
            current_version: wire.current_version,
        }
    }
}

impl GraphEdge {
    pub fn valid(&self) -> bool {
        self.state.is_active()
    }

    pub fn source_id(&self) -> &str {
        &self.source.id
    }

    pub fn target_id(&self) -> &str {
        &self.target.id
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeMaterialization {
    pub workspace_id: String,
    pub node: NodeRef,
    pub state: GraphEdgeState,
    pub artifact_revision: u64,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GraphRun {
    pub id: String,
    pub workspace_id: String,
    pub revision: u64,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeAttempt {
    pub id: String,
    pub graph_run_id: String,
    pub workspace_id: String,
    pub node_id: String,
    pub role: coordy_protocol::RunRole,
    pub input_fingerprint: String,
    pub lease_status: String,
    pub run_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GraphEvent {
    pub id: String,
    pub workspace_id: String,
    pub kind: String,
    pub at: String,
    #[serde(default)]
    pub edge_id: Option<String>,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default)]
    pub payload: serde_json::Value,
}

/// B waits on A: `task_id` is B, `blocker_id` is A.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IssueBlockerEdge {
    pub id: String,
    pub workspace_id: String,
    pub task_id: String,
    pub blocker_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Conflict {
    pub id: String,
    pub workspace_id: String,
    pub summary: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    pub workspace_id: String,
    pub task_id: String,
    pub agent_id: String,
    pub status: String,
    pub harness: String,
    pub compaction_count: usize,
    pub after_compaction: bool,
    #[serde(default)]
    pub queue_status: String,
    #[serde(default)]
    pub retry_count: u32,
    #[serde(default)]
    pub chat_id: Option<String>,
    #[serde(default)]
    pub trigger: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub role: coordy_protocol::RunRole,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunEvent {
    pub run_id: String,
    pub seq: u32,
    pub kind: String,
    pub payload: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InboxItem {
    pub id: String,
    pub workspace_id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub related_id: Option<String>,
    pub dismissed: bool,
    #[serde(default)]
    pub read: bool,
    #[serde(default)]
    pub archived: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuditEntry {
    pub at: String,
    pub actor: String,
    pub action: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CompactionSnapshot {
    pub run_id: String,
    pub task_id: String,
    pub claims: Vec<String>,
    #[serde(default)]
    pub rejected: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub lead_id: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub resource: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Squad {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub leader_agent_id: String,
    #[serde(default)]
    pub member_agent_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub body: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Automation {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub runbook: String,
    #[serde(default)]
    pub assignee_agent_id: Option<String>,
    #[serde(default)]
    pub schedule: String,
    #[serde(default)]
    pub create_issue: bool,
    #[serde(default)]
    pub last_run_id: Option<String>,
    #[serde(default)]
    pub run_count: u32,
    #[serde(default)]
    pub last_triggered_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Comment {
    pub id: String,
    pub workspace_id: String,
    pub task_id: String,
    pub author_id: String,
    pub body: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub resolved: bool,
    #[serde(default)]
    pub conclusion: bool,
    #[serde(default)]
    pub mentions: Vec<coordy_protocol::Mention>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Chat {
    pub id: String,
    pub workspace_id: String,
    pub agent_id: String,
    pub owner_principal_id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub task_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub chat_id: String,
    pub role: String,
    pub body: String,
    #[serde(default)]
    pub run_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkspaceLabel {
    pub workspace_id: String,
    pub name: String,
    #[serde(default)]
    pub color: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CustomPropertyDef {
    pub workspace_id: String,
    pub key: String,
    pub value_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub task_id: String,
    pub name: String,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskSubscription {
    pub task_id: String,
    pub principal_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Computer {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    #[serde(default)]
    pub kind: String,
    /// Set at registration. Not a heartbeat; UI must not treat this as liveness.
    #[serde(default)]
    pub online: bool,
    #[serde(default)]
    pub concurrency_limit: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DirectoryLock {
    pub workspace_id: String,
    pub path: String,
    #[serde(default)]
    pub holder_run_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Integration {
    pub workspace_id: String,
    pub kind: String,
    pub enabled: bool,
    #[serde(default)]
    pub config: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct GithubState {
    pub workspace_id: String,
    #[serde(default)]
    pub cli_available: bool,
    #[serde(default)]
    pub authenticated: bool,
    #[serde(default)]
    pub account: String,
    #[serde(default)]
    pub last_error: String,
    #[serde(default)]
    pub last_synced_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Reaction {
    pub target_id: String,
    pub actor_id: String,
    pub emoji: String,
}

impl World {
    pub fn workspace(&self, id: &str) -> Option<&Workspace> {
        self.workspaces.iter().find(|w| w.id == id)
    }

    pub fn principal(&self, id: &str) -> Option<&Principal> {
        self.principals.iter().find(|p| p.id == id)
    }

    pub fn agent(&self, id: &str) -> Option<&Agent> {
        self.agents.iter().find(|a| a.id == id)
    }

    pub fn task(&self, id: &str) -> Option<&Task> {
        self.tasks.iter().find(|t| t.id == id)
    }

    pub fn task_mut(&mut self, id: &str) -> Option<&mut Task> {
        self.tasks.iter_mut().find(|t| t.id == id)
    }

    pub fn run(&self, id: &str) -> Option<&Run> {
        self.runs.iter().find(|r| r.id == id)
    }

    pub fn run_mut(&mut self, id: &str) -> Option<&mut Run> {
        self.runs.iter_mut().find(|r| r.id == id)
    }

    pub fn memory(&self, id: &str) -> Option<&MemoryRecord> {
        self.memories.iter().find(|m| m.id == id)
    }

    pub fn memory_mut(&mut self, id: &str) -> Option<&mut MemoryRecord> {
        self.memories.iter_mut().find(|m| m.id == id)
    }

    pub fn agents_of(&self, principal_id: &str) -> Vec<&Agent> {
        self.agents
            .iter()
            .filter(|a| a.principal_id == principal_id)
            .collect()
    }

    pub fn next_effect_cursor(&self) -> u64 {
        self.effects.len() as u64
    }

    pub fn project(&self, id: &str) -> Option<&Project> {
        self.projects.iter().find(|p| p.id == id)
    }

    pub fn squad(&self, id: &str) -> Option<&Squad> {
        self.squads.iter().find(|s| s.id == id)
    }

    pub fn skill(&self, id: &str) -> Option<&Skill> {
        self.skills.iter().find(|s| s.id == id)
    }

    pub fn automation(&self, id: &str) -> Option<&Automation> {
        self.automations.iter().find(|a| a.id == id)
    }

    pub fn comment(&self, id: &str) -> Option<&Comment> {
        self.comments.iter().find(|c| c.id == id)
    }

    pub fn chat(&self, id: &str) -> Option<&Chat> {
        self.chats.iter().find(|c| c.id == id)
    }
}
