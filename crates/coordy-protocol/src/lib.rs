//! Shared DTOs. No business rules.

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: &str = "coordy-local-v1";
pub const PRODUCT_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Live harnesses emit this tool when an ACP/CLI session ends so the kernel
/// can mark the run complete and return the task for review.
pub const HARNESS_SESSION_TOOL: &str = "coordy.session";
/// `blocked_reason` written when a task is held by unfinished issue blockers.
pub const ISSUE_BLOCKER_REASON: &str = "waiting on unfinished blockers";
/// `blocked_reason` / StartRun gate when a consumer dependency is `valid = false`.
pub const STALE_DEPENDENCY_REASON: &str = "依赖已失效，须先确认或重规划";
/// Provider-neutral fenced artifact version understood by chat planning.
pub const TASK_PLAN_VERSION: &str = "COORDY_TASK_PLAN_V1";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum TaskPlanParent {
    Create {
        title: String,
        #[serde(default)]
        description: String,
        #[serde(default)]
        project_id: Option<String>,
    },
    Existing {
        task_id: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum TaskPlanAssignee {
    Agent { id: String },
    Squad { id: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskPlanChild {
    pub key: String,
    pub title: String,
    pub description: String,
    pub acceptance_criteria: Vec<String>,
    pub priority: String,
    pub stage: u32,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub assignee: Option<TaskPlanAssignee>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskPlanDraft {
    pub version: String,
    pub workspace_id: String,
    pub chat_id: String,
    pub source_run_id: String,
    pub source_agent_id: String,
    pub parent: TaskPlanParent,
    pub children: Vec<TaskPlanChild>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskPlanApplyMode {
    CreateOnly,
    ConfirmAndStart,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskPlanProposalView {
    pub id: String,
    pub revision: u64,
    pub created_by: String,
    pub created_at: String,
    pub draft: TaskPlanDraft,
}

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
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Task,
    Agent,
    Contract,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeRef {
    pub kind: NodeKind,
    pub id: String,
}

impl NodeRef {
    pub fn task(id: impl Into<String>) -> Self {
        Self {
            kind: NodeKind::Task,
            id: id.into(),
        }
    }

    pub fn agent(id: impl Into<String>) -> Self {
        Self {
            kind: NodeKind::Agent,
            id: id.into(),
        }
    }

    pub fn contract(id: impl Into<String>) -> Self {
        Self {
            kind: NodeKind::Contract,
            id: id.into(),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GraphEdgeKind {
    Precedence,
    #[default]
    Consumes,
    AssignedTo,
    Produces,
    RequiresApproval,
    Authority,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunRole {
    #[default]
    Executor,
    Validator,
    ConductorReview,
    HumanApproval,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ValidationChoice {
    Reaffirm,
    Hold,
    Remove,
    Replan,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReviewPacket {
    pub dependency_id: String,
    pub reason: String,
    pub invalidation_event: Option<String>,
    pub old_version: Option<u64>,
    pub new_version: Option<u64>,
    pub changed_files: Vec<String>,
    pub diff_ref: Option<String>,
    pub diff_missing_reason: Option<String>,
    pub consumer_plan: String,
    pub deterministic_checks: Vec<String>,
    pub generation: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GraphEdgeState {
    Active,
    Stale,
    PendingValidation,
    Rejected,
    Superseded,
}

impl GraphEdgeState {
    pub fn is_active(&self) -> bool {
        matches!(self, Self::Active)
    }

    pub fn blocks_consumer(&self) -> bool {
        !matches!(self, Self::Active | Self::Superseded)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum Command {
    CreateWorkspace {
        name: String,
    },
    UpdateWorkspace {
        workspace_id: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        icon: Option<String>,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        context: Option<String>,
        #[serde(default)]
        slug: Option<String>,
        #[serde(default)]
        issue_prefix: Option<String>,
        #[serde(default)]
        conductor_agent_id: Option<String>,
    },
    DeleteWorkspace {
        workspace_id: String,
    },
    LeaveWorkspace {
        workspace_id: String,
    },
    CreatePrincipal {
        workspace_id: String,
        name: String,
    },
    UpdatePrincipal {
        principal_id: String,
        name: String,
    },
    InvitePrincipal {
        workspace_id: String,
        name: String,
        #[serde(default)]
        role: String,
    },
    SetPrincipalRole {
        principal_id: String,
        role: String,
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
        #[serde(default)]
        avatar: Option<String>,
        #[serde(default)]
        model: Option<String>,
        #[serde(default)]
        thinking: Option<String>,
        #[serde(default)]
        speed: Option<String>,
        #[serde(default)]
        access: Option<String>,
        #[serde(default)]
        access_member_ids: Option<Vec<String>>,
        #[serde(default)]
        concurrency_limit: Option<u32>,
        #[serde(default)]
        cli_args: Option<String>,
        #[serde(default)]
        tool_access: Option<String>,
        #[serde(default)]
        mcp_servers: Option<Vec<String>>,
    },
    ArchiveAgent {
        agent_id: String,
    },
    DuplicateAgent {
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
    SaveTaskPlanProposal {
        #[serde(default)]
        proposal_id: Option<String>,
        #[serde(default)]
        expected_revision: Option<u64>,
        draft: TaskPlanDraft,
    },
    ApplyTaskPlan {
        proposal_id: String,
        expected_revision: u64,
        idempotency_key: String,
        mode: TaskPlanApplyMode,
    },
    AssignTask {
        task_id: String,
        agent_id: String,
    },
    AssignIssue {
        task_id: String,
        #[serde(default)]
        agent_id: Option<String>,
        #[serde(default)]
        principal_id: Option<String>,
        #[serde(default)]
        squad_id: Option<String>,
        #[serde(default)]
        project_id: Option<String>,
        #[serde(default)]
        parent_id: Option<String>,
        #[serde(default)]
        stage: Option<String>,
    },
    UpdateTask {
        task_id: String,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        priority: Option<String>,
        #[serde(default)]
        start_date: Option<String>,
        #[serde(default)]
        due_date: Option<String>,
        #[serde(default)]
        labels: Option<Vec<String>>,
        #[serde(default)]
        custom_fields: Option<Vec<CustomFieldValue>>,
        #[serde(default)]
        sort_key: Option<i64>,
    },
    SetTaskStatus {
        task_id: String,
        status: String,
    },
    DeleteTask {
        task_id: String,
    },
    SubscribeTask {
        task_id: String,
    },
    UnsubscribeTask {
        task_id: String,
    },
    ReorderTasks {
        workspace_id: String,
        status: String,
        task_ids: Vec<String>,
    },
    AddAttachment {
        task_id: String,
        name: String,
        path: String,
    },
    RemoveAttachment {
        attachment_id: String,
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
        #[serde(default)]
        agent_id: Option<String>,
        #[serde(default)]
        chat_id: Option<String>,
        #[serde(default)]
        trigger: String,
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
        #[serde(default)]
        source: Option<NodeRef>,
        #[serde(default)]
        target: Option<NodeRef>,
        /// Legacy consumer id (`target`); prefer `source` / `target`.
        #[serde(default)]
        from_id: String,
        /// Legacy producer id (`source`); prefer `source` / `target`.
        #[serde(default)]
        to_id: String,
        #[serde(default)]
        kind: GraphEdgeKind,
        entity: String,
        #[serde(default)]
        reason: Option<String>,
        #[serde(default)]
        origin_run_id: Option<String>,
        #[serde(default)]
        selector_path: Option<String>,
    },
    ReaffirmDependency {
        dependency_id: String,
        expected_generation: u64,
    },
    RemoveDependency {
        dependency_id: String,
    },
    SetWorkspaceConductor {
        workspace_id: String,
        agent_id: Option<String>,
    },
    ValidationDecision {
        dependency_id: String,
        expected_generation: u64,
        decision: ValidationChoice,
        #[serde(default)]
        evidence_refs: Vec<String>,
        #[serde(default)]
        rationale: String,
        #[serde(default)]
        validator_run_id: Option<String>,
    },
    AddIssueBlocker {
        task_id: String,
        blocker_id: String,
    },
    RemoveIssueBlocker {
        task_id: String,
        blocker_id: String,
    },
    SetSettings {
        workspace_id: String,
        llm_advisor_enabled: bool,
    },
    DismissInbox {
        item_id: String,
    },
    ArchiveInbox {
        item_id: String,
    },
    SetInboxRead {
        item_id: String,
        read: bool,
    },
    SetNotificationPrefs {
        workspace_id: String,
        kinds: Vec<String>,
    },
    CreateProject {
        workspace_id: String,
        name: String,
        #[serde(default)]
        icon: String,
        #[serde(default)]
        description: String,
    },
    UpdateProject {
        project_id: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        icon: Option<String>,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        status: Option<String>,
        #[serde(default)]
        priority: Option<String>,
        #[serde(default)]
        lead_id: Option<String>,
        #[serde(default)]
        start_date: Option<String>,
        #[serde(default)]
        due_date: Option<String>,
        #[serde(default)]
        resource: Option<String>,
    },
    DeleteProject {
        project_id: String,
    },
    CreateSquad {
        workspace_id: String,
        name: String,
        leader_agent_id: String,
    },
    UpdateSquad {
        squad_id: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        leader_agent_id: Option<String>,
    },
    SetSquadMembers {
        squad_id: String,
        agent_ids: Vec<String>,
    },
    DeleteSquad {
        squad_id: String,
    },
    CreateSkill {
        workspace_id: String,
        name: String,
        body: String,
    },
    UpdateSkill {
        skill_id: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        body: Option<String>,
    },
    DeleteSkill {
        skill_id: String,
    },
    SetAgentSkills {
        agent_id: String,
        skill_ids: Vec<String>,
    },
    CreateAutomation {
        workspace_id: String,
        name: String,
        runbook: String,
        #[serde(default)]
        assignee_agent_id: Option<String>,
        #[serde(default)]
        schedule: String,
        #[serde(default)]
        create_issue: bool,
    },
    UpdateAutomation {
        automation_id: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        runbook: Option<String>,
        #[serde(default)]
        assignee_agent_id: Option<String>,
        #[serde(default)]
        schedule: Option<String>,
        #[serde(default)]
        create_issue: Option<bool>,
    },
    TriggerAutomation {
        automation_id: String,
    },
    SweepAutomations {
        now_ms: i64,
    },
    DeleteAutomation {
        automation_id: String,
    },
    AddComment {
        task_id: String,
        body: String,
        #[serde(default)]
        parent_id: Option<String>,
        #[serde(default)]
        mentions: Vec<Mention>,
    },
    ResolveComment {
        comment_id: String,
        resolved: bool,
    },
    SetCommentConclusion {
        comment_id: String,
    },
    AddReaction {
        target_id: String,
        emoji: String,
    },
    CreateChat {
        workspace_id: String,
        agent_id: String,
        #[serde(default)]
        project_id: Option<String>,
    },
    SendChatMessage {
        chat_id: String,
        body: String,
    },
    StopChat {
        chat_id: String,
    },
    ArchiveChat {
        chat_id: String,
    },
    StartMentionRun {
        task_id: String,
        agent_id: String,
        prompt: String,
    },
    RetryRun {
        run_id: String,
    },
    SetDirectoryLock {
        workspace_id: String,
        path: String,
        locked: bool,
    },
    RegisterComputer {
        workspace_id: String,
        name: String,
        #[serde(default)]
        kind: String,
        #[serde(default)]
        concurrency_limit: u32,
    },
    CreateLabel {
        workspace_id: String,
        name: String,
        #[serde(default)]
        color: String,
    },
    DeleteLabel {
        workspace_id: String,
        name: String,
    },
    SetCustomPropertyDef {
        workspace_id: String,
        key: String,
        value_type: String,
    },
    LinkPullRequest {
        task_id: String,
        number: u32,
        #[serde(default)]
        url: String,
    },
    UnlinkPullRequest {
        task_id: String,
        number: u32,
    },
    RefreshGithub {
        workspace_id: String,
    },
    SyncGithubPullRequests(Box<GithubSync>),
    SetIntegration {
        workspace_id: String,
        kind: String,
        enabled: bool,
        #[serde(default)]
        config: String,
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
pub struct CustomFieldValue {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Mention {
    pub kind: String,
    pub id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum Query {
    Health,
    Board { workspace_id: String },
    TaskPlan { proposal_id: String },
    Commitments { workspace_id: String },
    Principals { workspace_id: String },
    Agents { workspace_id: String },
    Authority { workspace_id: String },
    Memory { workspace_id: String },
    Contracts { workspace_id: String },
    Dependencies { workspace_id: String },
    GraphSnapshot { workspace_id: String },
    GraphEvaluation { workspace_id: String },
    Conflicts { workspace_id: String },
    Runs { workspace_id: String },
    Run { run_id: String },
    Inbox { workspace_id: String },
    Settings { workspace_id: String },
    AgentContext { agent_id: String },
    Workspaces,
    Workspace { workspace_id: String },
    Projects { workspace_id: String },
    Squads { workspace_id: String },
    Skills { workspace_id: String },
    Automations { workspace_id: String },
    Comments { task_id: String },
    Chats { workspace_id: String },
    Chat { chat_id: String },
    Labels { workspace_id: String },
    Stats { workspace_id: String },
    Computers { workspace_id: String },
    Account,
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
    TaskPlan {
        proposal: Box<TaskPlanProposalView>,
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
    GraphSnapshot {
        workspace_id: String,
        revision: u64,
        event_cursor: u64,
        nodes: Vec<GraphNodeView>,
        edges: Vec<GraphEdgeView>,
        materializations: Vec<NodeMaterializationView>,
        health: GraphHealthView,
        #[serde(default)]
        events: Vec<GraphTimelineEventView>,
        #[serde(default)]
        evaluation: GraphEvaluationView,
    },
    GraphEvaluation(GraphEvaluationView),
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
        #[serde(default)]
        notification_kinds: Vec<String>,
        #[serde(default)]
        github: GithubView,
    },
    AgentContext {
        context: AgentContextView,
    },
    Workspace(WorkspaceView),
    Projects {
        items: Vec<ProjectView>,
    },
    Squads {
        items: Vec<SquadView>,
    },
    Skills {
        items: Vec<SkillView>,
    },
    Automations {
        items: Vec<AutomationView>,
    },
    Comments {
        items: Vec<CommentView>,
    },
    Chats {
        items: Vec<ChatView>,
    },
    Chat {
        chat: ChatView,
        messages: Vec<ChatMessageView>,
        #[serde(default)]
        task_plan: Option<Box<TaskPlanProposalView>>,
        #[serde(default)]
        task_plan_error: Option<String>,
    },
    Labels {
        items: Vec<LabelView>,
    },
    Stats {
        stats: StatsView,
    },
    Computers {
        items: Vec<ComputerView>,
    },
    Account {
        account: AccountView,
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
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub context: String,
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub issue_prefix: String,
    #[serde(default)]
    pub next_issue_number: u64,
    #[serde(default)]
    pub conductor_agent_id: Option<String>,
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
    #[serde(default)]
    pub identifier: String,
    #[serde(default)]
    pub number: u64,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub custom_fields: Vec<CustomFieldValue>,
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
    pub subscribed: bool,
    #[serde(default)]
    pub attachments: Vec<AttachmentView>,
    #[serde(default)]
    pub pull_requests: Vec<PullRequestView>,
    /// Issues that must finish before this one can start or complete.
    #[serde(default)]
    pub blocker_ids: Vec<String>,
    /// Issues waiting on this one.
    #[serde(default)]
    pub blocking_ids: Vec<String>,
    /// Declared blockers that are not yet `done` or `cancelled`.
    #[serde(default)]
    pub unresolved_blocker_ids: Vec<String>,
    #[serde(default)]
    pub task_plan_progress: Option<TaskPlanProgressView>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskPlanProgressView {
    pub total: u32,
    pub done: u32,
    pub running: u32,
    pub blocked: u32,
    pub remaining: u32,
    #[serde(default)]
    pub current_stage: Option<u32>,
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
    #[serde(default)]
    pub role: String,
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
    #[serde(default)]
    pub avatar: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub thinking: String,
    #[serde(default)]
    pub speed: String,
    #[serde(default)]
    pub access: String,
    #[serde(default)]
    pub access_member_ids: Vec<String>,
    #[serde(default)]
    pub concurrency_limit: u32,
    #[serde(default)]
    pub cli_args: String,
    #[serde(default)]
    pub tool_access: String,
    #[serde(default)]
    pub mcp_servers: Vec<String>,
    #[serde(default)]
    pub skill_ids: Vec<String>,
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
    pub source: NodeRef,
    pub target: NodeRef,
    pub entity: String,
    pub kind: GraphEdgeKind,
    pub state: GraphEdgeState,
    pub generation: u64,
    #[serde(default)]
    pub origin_run_id: Option<String>,
    #[serde(default)]
    pub actor_id: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub selector_path: Option<String>,
    #[serde(default)]
    pub observed_version: Option<u64>,
    #[serde(default)]
    pub current_version: Option<u64>,
    /// Compatibility: consumer id (`target`).
    pub from_id: String,
    /// Compatibility: producer id (`source`).
    pub to_id: String,
    pub valid: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphNodeView {
    pub id: String,
    pub kind: NodeKind,
    pub title: String,
    pub status: String,
    pub workspace_id: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub assignee_agent_id: Option<String>,
    #[serde(default)]
    pub blocked_reason: Option<String>,
    #[serde(default)]
    pub replan: bool,
    #[serde(default)]
    pub harness: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphEdgeView {
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
    pub valid: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeMaterializationView {
    pub node: NodeRef,
    pub workspace_id: String,
    pub state: GraphEdgeState,
    pub artifact_revision: u64,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphHealthView {
    pub consistent: bool,
    pub lag: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct BlockedNodeView {
    pub node_id: String,
    pub reasons: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphEvaluationView {
    pub graph_revision: u64,
    pub ready_nodes: Vec<String>,
    pub blocked_nodes: Vec<BlockedNodeView>,
    pub stale_nodes: Vec<String>,
    pub required_validations: Vec<String>,
    pub diagnostics: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphTimelineEventView {
    pub id: String,
    pub kind: String,
    pub at: String,
    #[serde(default)]
    pub edge_id: Option<String>,
    #[serde(default)]
    pub node_id: Option<String>,
    pub summary: String,
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
    #[serde(default)]
    pub queue_status: String,
    #[serde(default)]
    pub retry_count: u32,
    #[serde(default)]
    pub chat_id: Option<String>,
    #[serde(default)]
    pub trigger: String,
    #[serde(default)]
    pub role: RunRole,
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
    #[serde(default)]
    pub read: bool,
    #[serde(default)]
    pub archived: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectView {
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
    #[serde(default)]
    pub progress: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SquadView {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub leader_agent_id: String,
    #[serde(default)]
    pub member_agent_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillView {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub body: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AutomationView {
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommentView {
    pub id: String,
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
    pub reactions: Vec<String>,
    #[serde(default)]
    pub mentions: Vec<Mention>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatView {
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatMessageView {
    pub id: String,
    pub chat_id: String,
    pub role: String,
    pub body: String,
    #[serde(default)]
    pub run_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct LabelView {
    pub name: String,
    #[serde(default)]
    pub color: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttachmentView {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct PullRequestView {
    pub number: u32,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub repo: String,
    #[serde(default)]
    pub branch: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub additions: u32,
    #[serde(default)]
    pub deletions: u32,
    #[serde(default)]
    pub changed_files: u32,
    #[serde(default)]
    pub mergeable: String,
    #[serde(default)]
    pub merge_state: String,
    #[serde(default)]
    pub checks_rollup: String,
    #[serde(default)]
    pub checks_total: u32,
    #[serde(default)]
    pub checks_passed: u32,
    #[serde(default)]
    pub checks_failed: u32,
    #[serde(default)]
    pub checks_running: u32,
    #[serde(default)]
    pub failed_check_names: Vec<String>,
    #[serde(default)]
    pub snapshot_available: bool,
    #[serde(default)]
    pub snapshot_stale: bool,
    #[serde(default)]
    pub snapshot_fetched_at: String,
    #[serde(default)]
    pub linked_by: String,
    #[serde(default)]
    pub close_intent: bool,
}

impl PullRequestView {
    pub fn manual(number: u32, url: String) -> Self {
        Self {
            number,
            url,
            linked_by: "manual".into(),
            ..Self::default()
        }
    }
}

/// Snapshot collected from the local GitHub CLI. Kernel matches identifiers.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct GithubPullRequestItem {
    pub number: u32,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub repo: String,
    #[serde(default)]
    pub branch: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub additions: u32,
    #[serde(default)]
    pub deletions: u32,
    #[serde(default)]
    pub changed_files: u32,
    #[serde(default)]
    pub mergeable: String,
    #[serde(default)]
    pub merge_state: String,
    #[serde(default)]
    pub checks_rollup: String,
    #[serde(default)]
    pub checks_total: u32,
    #[serde(default)]
    pub checks_passed: u32,
    #[serde(default)]
    pub checks_failed: u32,
    #[serde(default)]
    pub checks_running: u32,
    #[serde(default)]
    pub failed_check_names: Vec<String>,
    #[serde(default)]
    pub snapshot_available: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct GithubSync {
    pub workspace_id: String,
    #[serde(default)]
    pub cli_available: bool,
    #[serde(default)]
    pub authenticated: bool,
    #[serde(default)]
    pub account: String,
    #[serde(default)]
    pub error: String,
    #[serde(default)]
    pub fetched_at: String,
    #[serde(default)]
    pub items: Vec<GithubPullRequestItem>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct GithubView {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub pr_sidebar: bool,
    #[serde(default = "default_true")]
    pub auto_link: bool,
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

fn default_true() -> bool {
    true
}

impl Default for GithubView {
    fn default() -> Self {
        Self {
            enabled: true,
            pr_sidebar: true,
            auto_link: true,
            cli_available: false,
            authenticated: false,
            account: String::new(),
            last_error: String::new(),
            last_synced_at: String::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ComputerView {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub online: bool,
    #[serde(default)]
    pub concurrency_limit: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct StatsView {
    pub issue_count: usize,
    pub open_count: usize,
    pub done_count: usize,
    pub agent_count: usize,
    pub run_count: usize,
    pub project_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountView {
    pub principal_id: String,
    pub name: String,
    #[serde(default)]
    pub notify_desktop: bool,
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
    Ready {
        cursor: u64,
    },
    InboxPosted {
        item: InboxView,
    },
    RunEvent {
        run_id: String,
        event: RunEventView,
    },
    Pause {
        run_id: String,
        reason: String,
    },
    Replan {
        run_id: String,
        reason: String,
    },
    StateChanged {
        workspace_id: String,
    },
    GraphDelta {
        workspace_id: String,
        revision: u64,
        cursor: u64,
    },
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
        command: Box<AuthenticatedCommand>,
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
    CompleteDraft {
        id: String,
        kind: String,
        prompt: String,
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
    /// Native CLI family (`claude`, `codex`, …) or `acp` / `stub`.
    #[serde(default)]
    pub protocol_family: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportAgentsResult {
    pub imported: Vec<String>,
    pub skipped: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct DraftCompletion {
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub titles: Vec<String>,
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
