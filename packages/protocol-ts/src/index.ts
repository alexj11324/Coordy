/** Generated-from-Rust protocol mirror. Do not invent fields here. */

export const PROTOCOL_VERSION = "coordy-local-v1";
export const HARNESS_SESSION_TOOL = "coordy.session";
export const ISSUE_BLOCKER_REASON = "waiting on unfinished blockers";

export type Actor =
  | { type: "principal"; id: string }
  | { type: "agent"; id: string; principal_id: string }
  | { type: "daemon" };

export type CustomFieldValue = { key: string; value: string };
export type Mention = { kind: string; id: string };

export type Command =
  | { type: "CreateWorkspace"; name: string }
  | {
      type: "UpdateWorkspace";
      workspace_id: string;
      name?: string | null;
      icon?: string | null;
      description?: string | null;
      context?: string | null;
      slug?: string | null;
      issue_prefix?: string | null;
    }
  | { type: "DeleteWorkspace"; workspace_id: string }
  | { type: "LeaveWorkspace"; workspace_id: string }
  | { type: "CreatePrincipal"; workspace_id: string; name: string }
  | { type: "UpdatePrincipal"; principal_id: string; name: string }
  | { type: "InvitePrincipal"; workspace_id: string; name: string; role?: string }
  | { type: "SetPrincipalRole"; principal_id: string; role: string }
  | { type: "CreateAgent"; workspace_id: string; principal_id: string; name: string; harness: string }
  | {
      type: "UpdateAgent";
      agent_id: string;
      name?: string | null;
      description?: string | null;
      instructions?: string | null;
      harness?: string | null;
      avatar?: string | null;
      model?: string | null;
      thinking?: string | null;
      speed?: string | null;
      access?: string | null;
      access_member_ids?: string[] | null;
      concurrency_limit?: number | null;
      cli_args?: string | null;
      tool_access?: string | null;
      mcp_servers?: string[] | null;
    }
  | { type: "ArchiveAgent"; agent_id: string }
  | { type: "DuplicateAgent"; agent_id: string }
  | { type: "Grant"; workspace_id: string; grantee_id: string; resource: string; action: string }
  | { type: "RevokeGrant"; grant_id: string }
  | { type: "Delegate"; workspace_id: string; from_actor_id: string; to_actor_id: string; resource: string; action: string }
  | { type: "CreateTask"; workspace_id: string; title: string; description?: string }
  | { type: "AssignTask"; task_id: string; agent_id: string }
  | {
      type: "AssignIssue";
      task_id: string;
      agent_id?: string | null;
      principal_id?: string | null;
      squad_id?: string | null;
      project_id?: string | null;
      parent_id?: string | null;
      stage?: string | null;
    }
  | {
      type: "UpdateTask";
      task_id: string;
      title?: string | null;
      description?: string | null;
      priority?: string | null;
      start_date?: string | null;
      due_date?: string | null;
      labels?: string[] | null;
      custom_fields?: CustomFieldValue[] | null;
      sort_key?: number | null;
    }
  | { type: "SetTaskStatus"; task_id: string; status: string }
  | { type: "DeleteTask"; task_id: string }
  | { type: "SubscribeTask"; task_id: string }
  | { type: "UnsubscribeTask"; task_id: string }
  | { type: "ReorderTasks"; workspace_id: string; status: string; task_ids: string[] }
  | { type: "AddAttachment"; task_id: string; name: string; path: string }
  | { type: "RemoveAttachment"; attachment_id: string }
  | { type: "BindRepository"; workspace_id: string; path: string }
  | { type: "CreateWorktree"; task_id: string }
  | {
      type: "UpsertCommitment";
      workspace_id: string;
      task_id?: string | null;
      commitment_type: string;
      claim: string;
      polarity: string;
      authority: string;
      scope: string;
    }
  | { type: "AppendMemory"; workspace_id: string; visibility: string; body: string; owner_actor_id?: string | null }
  | { type: "PublishMemory"; memory_id: string }
  | { type: "ShareMemory"; memory_id: string; to_principal_id: string }
  | { type: "AcceptShare"; memory_id: string }
  | { type: "ProposeContract"; workspace_id: string; title: string; body: string; participant_ids: string[] }
  | { type: "ApproveContract"; contract_id: string }
  | {
      type: "StartRun";
      task_id: string;
      source: RunSource;
      agent_id?: string | null;
      chat_id?: string | null;
      trigger?: string;
    }
  | { type: "CancelRun"; run_id: string }
  | { type: "IngestHarnessEvent"; run_id: string; event: HarnessEvent }
  | { type: "ApplyPatch"; task_id: string; patch: string }
  | {
      type: "DeclareDependency";
      workspace_id: string;
      from_id: string;
      to_id: string;
      entity: string;
    }
  | { type: "AddIssueBlocker"; task_id: string; blocker_id: string }
  | { type: "RemoveIssueBlocker"; task_id: string; blocker_id: string }
  | { type: "SetSettings"; workspace_id: string; llm_advisor_enabled: boolean }
  | { type: "DismissInbox"; item_id: string }
  | { type: "ArchiveInbox"; item_id: string }
  | { type: "SetInboxRead"; item_id: string; read: boolean }
  | { type: "SetNotificationPrefs"; workspace_id: string; kinds: string[] }
  | { type: "CreateProject"; workspace_id: string; name: string; icon?: string; description?: string }
  | {
      type: "UpdateProject";
      project_id: string;
      name?: string | null;
      icon?: string | null;
      description?: string | null;
      status?: string | null;
      priority?: string | null;
      lead_id?: string | null;
      start_date?: string | null;
      due_date?: string | null;
      resource?: string | null;
    }
  | { type: "DeleteProject"; project_id: string }
  | { type: "CreateSquad"; workspace_id: string; name: string; leader_agent_id: string }
  | { type: "UpdateSquad"; squad_id: string; name?: string | null; leader_agent_id?: string | null }
  | { type: "SetSquadMembers"; squad_id: string; agent_ids: string[] }
  | { type: "DeleteSquad"; squad_id: string }
  | { type: "CreateSkill"; workspace_id: string; name: string; body: string }
  | { type: "UpdateSkill"; skill_id: string; name?: string | null; body?: string | null }
  | { type: "DeleteSkill"; skill_id: string }
  | { type: "SetAgentSkills"; agent_id: string; skill_ids: string[] }
  | {
      type: "CreateAutomation";
      workspace_id: string;
      name: string;
      runbook: string;
      assignee_agent_id?: string | null;
      schedule?: string;
      create_issue?: boolean;
    }
  | {
      type: "UpdateAutomation";
      automation_id: string;
      name?: string | null;
      runbook?: string | null;
      assignee_agent_id?: string | null;
      schedule?: string | null;
      create_issue?: boolean | null;
    }
  | { type: "TriggerAutomation"; automation_id: string }
  | { type: "SweepAutomations"; now_ms: number }
  | { type: "DeleteAutomation"; automation_id: string }
  | { type: "AddComment"; task_id: string; body: string; parent_id?: string | null; mentions?: Mention[] }
  | { type: "ResolveComment"; comment_id: string; resolved: boolean }
  | { type: "SetCommentConclusion"; comment_id: string }
  | { type: "AddReaction"; target_id: string; emoji: string }
  | { type: "CreateChat"; workspace_id: string; agent_id: string; project_id?: string | null }
  | { type: "SendChatMessage"; chat_id: string; body: string }
  | { type: "StopChat"; chat_id: string }
  | { type: "ArchiveChat"; chat_id: string }
  | { type: "StartMentionRun"; task_id: string; agent_id: string; prompt: string }
  | { type: "RetryRun"; run_id: string }
  | { type: "SetDirectoryLock"; workspace_id: string; path: string; locked: boolean }
  | { type: "RegisterComputer"; workspace_id: string; name: string; kind?: string; concurrency_limit?: number }
  | { type: "CreateLabel"; workspace_id: string; name: string; color?: string }
  | { type: "DeleteLabel"; workspace_id: string; name: string }
  | { type: "SetCustomPropertyDef"; workspace_id: string; key: string; value_type: string }
  | { type: "LinkPullRequest"; task_id: string; number: number; url?: string }
  | { type: "UnlinkPullRequest"; task_id: string; number: number }
  | { type: "RefreshGithub"; workspace_id: string }
  | ({ type: "SyncGithubPullRequests" } & GithubSync)
  | { type: "SetIntegration"; workspace_id: string; kind: string; enabled: boolean; config?: string };

export type RunSource =
  | { type: "Jsonl"; path: string }
  | { type: "Codex"; prompt: string }
  | { type: "ClaudeCode"; prompt: string }
  | { type: "OpenCode"; prompt: string }
  | { type: "Acp"; prompt: string }
  | { type: "Fixture"; events: HarnessEvent[] };

export type HarnessEvent =
  | { type: "Message"; role: string; content: string }
  | { type: "Compaction"; summary: string }
  | { type: "Tool"; name: string; input: string; output: string; exit_code?: number | null }
  | { type: "Patch"; diff: string };

export type Query =
  | { type: "Health" }
  | { type: "Workspaces" }
  | { type: "Workspace"; workspace_id: string }
  | { type: "Board"; workspace_id: string }
  | { type: "Commitments"; workspace_id: string }
  | { type: "Principals"; workspace_id: string }
  | { type: "Agents"; workspace_id: string }
  | { type: "Authority"; workspace_id: string }
  | { type: "Memory"; workspace_id: string }
  | { type: "Contracts"; workspace_id: string }
  | { type: "Dependencies"; workspace_id: string }
  | { type: "Conflicts"; workspace_id: string }
  | { type: "Runs"; workspace_id: string }
  | { type: "Run"; run_id: string }
  | { type: "Inbox"; workspace_id: string }
  | { type: "Settings"; workspace_id: string }
  | { type: "AgentContext"; agent_id: string }
  | { type: "Projects"; workspace_id: string }
  | { type: "Squads"; workspace_id: string }
  | { type: "Skills"; workspace_id: string }
  | { type: "Automations"; workspace_id: string }
  | { type: "Comments"; task_id: string }
  | { type: "Chats"; workspace_id: string }
  | { type: "Chat"; chat_id: string }
  | { type: "Labels"; workspace_id: string }
  | { type: "Stats"; workspace_id: string }
  | { type: "Computers"; workspace_id: string }
  | { type: "Account" };

export type AuthenticatedCommand = { actor: Actor; command: Command };
export type AuthorizedQuery = { actor: Actor; query: Query };

export type Outcome = { message: string; ids: Record<string, unknown>; blocked: boolean };

export type HealthView = {
  status: string;
  version: string;
  protocol_version: string;
  pid: number;
  workspace_count: number;
};

export type WorkspaceView = {
  id: string;
  name: string;
  repo_path?: string | null;
  icon?: string;
  description?: string;
  context?: string;
  slug?: string;
  issue_prefix?: string;
  next_issue_number?: number;
};
export type AttachmentView = { id: string; name: string; path: string };
export type PullRequestView = {
  number: number;
  url?: string;
  title?: string;
  state?: string;
  repo?: string;
  branch?: string;
  author?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  mergeable?: string;
  merge_state?: string;
  checks_rollup?: string;
  checks_total?: number;
  checks_passed?: number;
  checks_failed?: number;
  checks_running?: number;
  failed_check_names?: string[];
  snapshot_available?: boolean;
  snapshot_stale?: boolean;
  snapshot_fetched_at?: string;
  linked_by?: string;
  close_intent?: boolean;
};
export type GithubPullRequestItem = {
  number: number;
  url?: string;
  title?: string;
  state?: string;
  repo?: string;
  branch?: string;
  author?: string;
  body?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  mergeable?: string;
  merge_state?: string;
  checks_rollup?: string;
  checks_total?: number;
  checks_passed?: number;
  checks_failed?: number;
  checks_running?: number;
  failed_check_names?: string[];
  snapshot_available?: boolean;
};
export type GithubSync = {
  workspace_id: string;
  cli_available?: boolean;
  authenticated?: boolean;
  account?: string;
  error?: string;
  fetched_at?: string;
  items?: GithubPullRequestItem[];
};
export type GithubView = {
  enabled?: boolean;
  pr_sidebar?: boolean;
  auto_link?: boolean;
  cli_available?: boolean;
  authenticated?: boolean;
  account?: string;
  last_error?: string;
  last_synced_at?: string;
};
export type TaskView = {
  id: string;
  workspace_id: string;
  title: string;
  description?: string | null;
  status: string;
  assignee_agent_id?: string | null;
  worktree_path?: string | null;
  blocked_reason?: string | null;
  identifier?: string;
  number?: number;
  priority?: string;
  start_date?: string | null;
  due_date?: string | null;
  labels?: string[];
  custom_fields?: CustomFieldValue[];
  assignee_principal_id?: string | null;
  assignee_squad_id?: string | null;
  project_id?: string | null;
  parent_id?: string | null;
  stage?: string;
  sort_key?: number;
  subscribed?: boolean;
  attachments?: AttachmentView[];
  pull_requests?: PullRequestView[];
  blocker_ids?: string[];
  blocking_ids?: string[];
  unresolved_blocker_ids?: string[];
};
export type CommitmentView = {
  id: string;
  workspace_id: string;
  task_id?: string | null;
  commitment_type: string;
  claim: string;
  polarity: string;
  authority: string;
  status: string;
};
export type PrincipalView = { id: string; workspace_id: string; name: string; role?: string };
export type AgentView = {
  id: string;
  workspace_id: string;
  principal_id: string;
  name: string;
  harness: string;
  description?: string;
  instructions?: string;
  avatar?: string;
  model?: string;
  thinking?: string;
  speed?: string;
  access?: string;
  access_member_ids?: string[];
  concurrency_limit?: number;
  cli_args?: string;
  tool_access?: string;
  mcp_servers?: string[];
  skill_ids?: string[];
};
export type GrantView = {
  id: string;
  grantor_id: string;
  grantee_id: string;
  resource: string;
  action: string;
  delegated: boolean;
  revoked: boolean;
};
export type MemoryView = {
  id: string;
  visibility: string;
  owner_actor_id: string;
  body: string;
  status: string;
};
export type ContractView = {
  id: string;
  title: string;
  body: string;
  status: string;
  participant_ids: string[];
  approvals: string[];
};
export type DependencyView = { id: string; from_id: string; to_id: string; entity: string; valid: boolean };
export type ConflictView = { id: string; summary: string; status: string };
export type RunView = {
  id: string;
  task_id: string;
  agent_id: string;
  status: string;
  harness: string;
  compaction_count: number;
  queue_status?: string;
  retry_count?: number;
  chat_id?: string | null;
  trigger?: string;
};
export type RunEventView = { seq: number; kind: string; payload: string };
export type InboxView = {
  id: string;
  kind: string;
  title: string;
  body: string;
  related_id?: string | null;
  read?: boolean;
  archived?: boolean;
};
export type ProjectView = {
  id: string;
  workspace_id: string;
  name: string;
  icon?: string;
  description?: string;
  status?: string;
  priority?: string;
  lead_id?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  resource?: string;
  progress?: number;
};
export type SquadView = {
  id: string;
  workspace_id: string;
  name: string;
  leader_agent_id: string;
  member_agent_ids?: string[];
};
export type SkillView = { id: string; workspace_id: string; name: string; body: string };
export type AutomationView = {
  id: string;
  workspace_id: string;
  name: string;
  runbook: string;
  assignee_agent_id?: string | null;
  schedule?: string;
  create_issue?: boolean;
  last_run_id?: string | null;
  run_count?: number;
  last_triggered_at?: string | null;
};
export type CommentView = {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  parent_id?: string | null;
  resolved?: boolean;
  conclusion?: boolean;
  reactions?: string[];
  mentions?: Mention[];
};
export type ChatView = {
  id: string;
  workspace_id: string;
  agent_id: string;
  owner_principal_id: string;
  project_id?: string | null;
  archived?: boolean;
  title?: string;
  task_id?: string | null;
};
export type ChatMessageView = {
  id: string;
  chat_id: string;
  role: string;
  body: string;
  run_id?: string | null;
};
export type LabelView = { name: string; color?: string };
export type ComputerView = {
  id: string;
  workspace_id: string;
  name: string;
  kind?: string;
  online?: boolean;
  concurrency_limit?: number;
};
export type StatsView = {
  issue_count: number;
  open_count: number;
  done_count: number;
  agent_count: number;
  run_count: number;
  project_count: number;
};
export type AccountView = { principal_id: string; name: string; notify_desktop?: boolean };
export type AgentContextView = { agent_id: string; commitments: string[]; memory: MemoryView[] };

export type View =
  | { type: "Health" } & HealthView
  | { type: "Workspaces"; items: WorkspaceView[] }
  | { type: "Board"; tasks: TaskView[] }
  | { type: "Commitments"; items: CommitmentView[] }
  | { type: "Principals"; items: PrincipalView[] }
  | { type: "Agents"; items: AgentView[] }
  | { type: "Authority"; grants: GrantView[] }
  | { type: "Memory"; items: MemoryView[] }
  | { type: "Contracts"; items: ContractView[] }
  | { type: "Dependencies"; items: DependencyView[] }
  | { type: "Conflicts"; items: ConflictView[] }
  | { type: "Runs"; items: RunView[] }
  | { type: "Run"; run: RunView; events: RunEventView[] }
  | { type: "Inbox"; items: InboxView[] }
  | {
      type: "Settings";
      daemon: HealthView;
      repo_path?: string | null;
      llm_advisor_enabled: boolean;
      notification_kinds?: string[];
      github?: GithubView;
    }
  | { type: "AgentContext"; context: AgentContextView }
  | { type: "Workspace" } & WorkspaceView
  | { type: "Projects"; items: ProjectView[] }
  | { type: "Squads"; items: SquadView[] }
  | { type: "Skills"; items: SkillView[] }
  | { type: "Automations"; items: AutomationView[] }
  | { type: "Comments"; items: CommentView[] }
  | { type: "Chats"; items: ChatView[] }
  | { type: "Chat"; chat: ChatView; messages: ChatMessageView[] }
  | { type: "Labels"; items: LabelView[] }
  | { type: "Stats"; stats: StatsView }
  | { type: "Computers"; items: ComputerView[] }
  | { type: "Account"; account: AccountView };

export type Effect =
  | { type: "Ready"; cursor: number }
  | { type: "InboxPosted"; item: InboxView }
  | { type: "RunEvent"; run_id: string; event: RunEventView }
  | { type: "Pause"; run_id: string; reason: string }
  | { type: "Replan"; run_id: string; reason: string }
  | { type: "StateChanged"; workspace_id: string };

export type CoordyError = { code: string; message: string };

export type AppInfo = { version: string; os: string; cliPath?: string; hostname?: string };
export type InstallCliResult = { ok: boolean; message: string };
export type DiscoveredAgentView = {
  id: string;
  name: string;
  installed: boolean;
  command: string;
  source: string;
  version?: string | null;
  protocol_family?: string | null;
};
export type ImportAgentsResult = { imported: string[]; skipped: string[] };
export type DraftCompletion = {
  kind: string;
  name?: string;
  description?: string;
  instructions?: string;
  titles?: string[];
};
export type DetectedHarnessView = { kind: string; binary: string };
export type SecretStatus = {
  provider: string;
  key_configured: boolean;
  base_url?: string | null;
  acp_command?: string | null;
  suggested_acp_command?: string | null;
  detected: DetectedHarnessView[];
};
export type SetSecretInput = {
  provider: string;
  api_key?: string | null;
  base_url?: string | null;
  acp_command?: string | null;
};
