/** Generated-from-Rust protocol mirror. Do not invent fields here. */

export type Actor =
  | { type: "principal"; id: string }
  | { type: "agent"; id: string; principal_id: string }
  | { type: "daemon" };

export type Command =
  | { type: "CreateWorkspace"; name: string }
  | { type: "CreatePrincipal"; workspace_id: string; name: string }
  | { type: "CreateAgent"; workspace_id: string; principal_id: string; name: string; harness: string }
  | { type: "Grant"; workspace_id: string; grantee_id: string; resource: string; action: string }
  | { type: "RevokeGrant"; grant_id: string }
  | { type: "Delegate"; workspace_id: string; from_actor_id: string; to_actor_id: string; resource: string; action: string }
  | { type: "CreateTask"; workspace_id: string; title: string }
  | { type: "AssignTask"; task_id: string; agent_id: string }
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
  | { type: "StartRun"; task_id: string; source: RunSource }
  | { type: "IngestHarnessEvent"; run_id: string; event: HarnessEvent }
  | { type: "ApplyPatch"; task_id: string; patch: string }
  | {
      type: "DeclareDependency";
      workspace_id: string;
      from_id: string;
      to_id: string;
      entity: string;
    }
  | { type: "SetSettings"; workspace_id: string; llm_advisor_enabled: boolean }
  | { type: "DismissInbox"; item_id: string };

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
  | { type: "AgentContext"; agent_id: string };

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

export type WorkspaceView = { id: string; name: string; repo_path?: string | null };
export type TaskView = {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
  assignee_agent_id?: string | null;
  worktree_path?: string | null;
  blocked_reason?: string | null;
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
export type PrincipalView = { id: string; workspace_id: string; name: string };
export type AgentView = {
  id: string;
  workspace_id: string;
  principal_id: string;
  name: string;
  harness: string;
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
};
export type RunEventView = { seq: number; kind: string; payload: string };
export type InboxView = { id: string; kind: string; title: string; body: string; related_id?: string | null };
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
  | { type: "Settings"; daemon: HealthView; repo_path?: string | null; llm_advisor_enabled: boolean }
  | { type: "AgentContext"; context: AgentContextView };

export type Effect =
  | { type: "Ready"; cursor: number }
  | { type: "InboxPosted"; item: InboxView }
  | { type: "RunEvent"; run_id: string; event: RunEventView }
  | { type: "Pause"; run_id: string; reason: string }
  | { type: "Replan"; run_id: string; reason: string }
  | { type: "StateChanged"; workspace_id: string };

export type CoordyError = { code: string; message: string };

export type AppInfo = { version: string; os: string; cliPath?: string };
export type InstallCliResult = { ok: boolean; message: string };
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
