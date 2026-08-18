import type {
  AgentView,
  CommitmentView,
  ConflictView,
  ContractView,
  DependencyView,
  GrantView,
  InboxView,
  MemoryView,
  PrincipalView,
  RunEventView,
  RunView,
  TaskView,
  View,
} from "@coordy/protocol";

export function asTasks(view: View | undefined): TaskView[] {
  return view?.type === "Board" ? view.tasks : [];
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

export function asConflicts(view: View | undefined): ConflictView[] {
  return view?.type === "Conflicts" ? view.items : [];
}

export function asRuns(view: View | undefined): RunView[] {
  return view?.type === "Runs" ? view.items : [];
}

export function asRunDetail(
  view: View | undefined,
): { run: RunView; events: RunEventView[] } | null {
  return view?.type === "Run" ? { run: view.run, events: view.events } : null;
}

export function asInbox(view: View | undefined): InboxView[] {
  return view?.type === "Inbox" ? view.items : [];
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

export type BoardColumn = "open" | "running" | "review" | "blocked";

export function boardColumn(status: string): BoardColumn {
  switch (status) {
    case "running":
      return "running";
    case "blocked":
      return "blocked";
    case "review":
    case "completed":
      return "review";
    default:
      return "open";
  }
}
