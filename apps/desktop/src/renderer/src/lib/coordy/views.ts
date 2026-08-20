import type {
  AccountView,
  AgentView,
  AutomationView,
  ChatMessageView,
  ChatView,
  CommentView,
  ComputerView,
  CommitmentView,
  ConflictView,
  ContractView,
  DependencyView,
  GraphSnapshotView,
  GrantView,
  HealthView,
  InboxView,
  LabelView,
  MemoryView,
  PrincipalView,
  ProjectView,
  RunEventView,
  RunView,
  SkillView,
  SquadView,
  StatsView,
  TaskView,
  View,
  WorkspaceView,
} from "@coordy/protocol";

export function asTasks(view: View | undefined): TaskView[] {
  return view?.type === "Board" ? view.tasks : [];
}

export function asWorkspaces(view: View | undefined): WorkspaceView[] {
  return view?.type === "Workspaces" ? view.items : [];
}

export function asWorkspace(view: View | undefined): WorkspaceView | null {
  return view?.type === "Workspace" ? view : null;
}

export function asCommitments(view: View | undefined): CommitmentView[] {
  return view?.type === "Commitments" ? view.items : [];
}

export function asPrincipals(view: View | undefined): PrincipalView[] {
  return view?.type === "Principals" ? view.items : [];
}

export function asAgents(view: View | undefined): AgentView[] {
  return view?.type === "Agents" ? view.items : [];
}

export function asGrants(view: View | undefined): GrantView[] {
  return view?.type === "Authority" ? view.grants : [];
}

export function asMemory(view: View | undefined): MemoryView[] {
  return view?.type === "Memory" ? view.items : [];
}

export function asContracts(view: View | undefined): ContractView[] {
  return view?.type === "Contracts" ? view.items : [];
}

export function asDependencies(view: View | undefined): DependencyView[] {
  return view?.type === "Dependencies" ? view.items : [];
}

export function asGraphSnapshot(view: View | undefined): GraphSnapshotView | null {
  return view?.type === "GraphSnapshot" ? view : null;
}

export function asConflicts(view: View | undefined): ConflictView[] {
  return view?.type === "Conflicts" ? view.items : [];
}

export function asRuns(view: View | undefined): RunView[] {
  return view?.type === "Runs" ? view.items : [];
}

export function activeHomeRun(runs: RunView[], pinnedRunId: string | null): RunView | undefined {
  if (pinnedRunId) return runs.find((run) => run.id === pinnedRunId);
  return runs.at(-1);
}

export function asRunDetail(
  view: View | undefined,
): { run: RunView; events: RunEventView[] } | null {
  return view?.type === "Run" ? { run: view.run, events: view.events } : null;
}

export function asInbox(view: View | undefined): InboxView[] {
  return view?.type === "Inbox" ? view.items : [];
}

export function asProjects(view: View | undefined): ProjectView[] {
  return view?.type === "Projects" ? view.items : [];
}

export function asSquads(view: View | undefined): SquadView[] {
  return view?.type === "Squads" ? view.items : [];
}

export function asSkills(view: View | undefined): SkillView[] {
  return view?.type === "Skills" ? view.items : [];
}

export function asAutomations(view: View | undefined): AutomationView[] {
  return view?.type === "Automations" ? view.items : [];
}

export function asComments(view: View | undefined): CommentView[] {
  return view?.type === "Comments" ? view.items : [];
}

export function asChats(view: View | undefined): ChatView[] {
  return view?.type === "Chats" ? view.items : [];
}

export function asChatDetail(
  view: View | undefined,
): { chat: ChatView; messages: ChatMessageView[] } | null {
  return view?.type === "Chat" ? { chat: view.chat, messages: view.messages } : null;
}

export function asLabels(view: View | undefined): LabelView[] {
  return view?.type === "Labels" ? view.items : [];
}

export function asStats(view: View | undefined): StatsView | null {
  return view?.type === "Stats" ? view.stats : null;
}

export function asComputers(view: View | undefined): ComputerView[] {
  return view?.type === "Computers" ? view.items : [];
}

export function asHealth(view: View | undefined): HealthView | null {
  if (view?.type === "Health") {
    return {
      status: view.status,
      version: view.version,
      protocol_version: view.protocol_version,
      pid: view.pid,
      workspace_count: view.workspace_count,
    };
  }
  if (view?.type === "Settings") return view.daemon;
  return null;
}

export function asAccount(view: View | undefined): AccountView | null {
  return view?.type === "Account" ? view.account : null;
}

export function outcomeId(ids: Record<string, unknown>, key: string): string {
  const value = ids[key];
  return value == null ? "" : String(value);
}

export function isPlaceholderHarness(harness: string): boolean {
  return harness === "jsonl" || harness === "acp";
}

export function latestRunForTask(runs: RunView[], taskId: string): RunView | undefined {
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    if (runs[i]?.task_id === taskId) return runs[i];
  }
  return undefined;
}

export type BoardColumn = "open" | "running" | "review" | "blocked" | "done";

export function boardColumn(status: string): BoardColumn {
  switch (status) {
    case "running":
      return "running";
    case "blocked":
      return "blocked";
    case "review":
    case "completed":
      return "review";
    case "done":
    case "cancelled":
      return "done";
    default:
      return "open";
  }
}
