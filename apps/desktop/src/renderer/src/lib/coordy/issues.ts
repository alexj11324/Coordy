import { ISSUE_BLOCKER_REASON, type TaskView } from "@coordy/protocol";
import { boardColumn } from "./views";

export const ISSUE_BOARD_COLUMNS = [
  { id: "backlog", title: "待规划" },
  { id: "open", title: "待办" },
  { id: "running", title: "进行中" },
  { id: "review", title: "审核中" },
  { id: "blocked", title: "受阻" },
  { id: "done", title: "已完成" },
] as const;

export const ISSUE_LIST_GROUPS = [
  ...ISSUE_BOARD_COLUMNS,
  { id: "cancelled", title: "已取消" },
] as const;

export const PRIORITY_ITEMS: Record<string, string> = {
  urgent: "紧急",
  high: "高",
  medium: "中",
  low: "低",
  none: "无",
};

export function isChatIssue(task: TaskView): boolean {
  return task.stage === "chat" || (task.labels ?? []).includes("chat");
}

export function boardIssues(tasks: TaskView[]): TaskView[] {
  return tasks.filter((task) => !isChatIssue(task));
}

export function taskIdentifier(task: string | { id: string; identifier?: string | null }): string {
  if (typeof task === "string") return taskIdentifier({ id: task });
  if (task.identifier?.trim()) return task.identifier.trim();
  const raw = task.id.trim();
  const body = raw.includes("_") ? raw.slice(raw.indexOf("_") + 1) : raw;
  const token = body.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  return token ? `COOR-${token}` : "COOR";
}

export function statusTone(status: string): string {
  switch (status) {
    case "running":
      return "text-sky-500";
    case "review":
      return "text-violet-500";
    case "blocked":
      return "text-amber-500";
    case "done":
      return "text-emerald-500";
    case "cancelled":
    case "backlog":
      return "text-muted-foreground/60";
    default:
      return "text-muted-foreground";
  }
}

export function priorityTone(priority: string | undefined): string {
  switch (priority) {
    case "urgent":
      return "text-red-500";
    case "high":
      return "text-orange-500";
    case "medium":
      return "text-amber-500";
    case "low":
      return "text-sky-500";
    default:
      return "text-muted-foreground";
  }
}

export type IssueFilters = {
  query: string;
  status: string;
  assignee: string;
  project: string;
  priority: string;
};

export function filterIssues(tasks: TaskView[], filters: IssueFilters | string, status?: string): TaskView[] {
  const parsed: IssueFilters =
    typeof filters === "string"
      ? { query: filters, status: status ?? "all", assignee: "all", project: "all", priority: "all" }
      : filters;
  const needle = parsed.query.trim().toLowerCase();
  return tasks.filter((task) => {
    if (parsed.status !== "all" && task.status !== parsed.status) return false;
    if (parsed.priority !== "all" && (task.priority || "none") !== parsed.priority) return false;
    if (parsed.project !== "all" && (task.project_id || "") !== parsed.project) return false;
    if (parsed.assignee !== "all") {
      if (parsed.assignee === "none" && (task.assignee_agent_id || task.assignee_principal_id || task.assignee_squad_id)) {
        return false;
      }
      if (parsed.assignee === "members") {
        if (!task.assignee_principal_id) return false;
      } else if (parsed.assignee === "agents") {
        if (!task.assignee_agent_id) return false;
      } else if (
        parsed.assignee !== "none" &&
        task.assignee_agent_id !== parsed.assignee &&
        task.assignee_principal_id !== parsed.assignee &&
        task.assignee_squad_id !== parsed.assignee
      ) {
        return false;
      }
    }
    if (!needle) return true;
    return (
      task.title.toLowerCase().includes(needle) ||
      taskIdentifier(task).toLowerCase().includes(needle) ||
      (task.description ?? "").toLowerCase().includes(needle) ||
      (task.labels ?? []).some((label) => label.toLowerCase().includes(needle))
    );
  });
}

export function tasksAssignedToMe(
  tasks: TaskView[],
  ids: { principalId?: string | null; agentId?: string | null },
): TaskView[] {
  const principalId = ids.principalId ?? null;
  const agentId = ids.agentId ?? null;
  if (!principalId && !agentId) return [];
  return tasks.filter((task) => {
    if (agentId && task.assignee_agent_id === agentId) return true;
    if (principalId && task.assignee_principal_id === principalId) return true;
    return false;
  });
}

export function issuesInColumn(tasks: TaskView[], columnId: string): TaskView[] {
  if (columnId === "cancelled") return tasks.filter((task) => task.status === "cancelled");
  if (columnId === "backlog") return tasks.filter((task) => task.status === "backlog");
  return tasks.filter((task) => boardColumn(task.status) === columnId && task.status !== "backlog");
}

export function sortIssues(tasks: TaskView[], sort: string): TaskView[] {
  const copy = [...tasks];
  copy.sort((a, b) => {
    if (sort === "priority") {
      const rank = (value?: string) => ["urgent", "high", "medium", "low", "none"].indexOf(value || "none");
      return rank(a.priority) - rank(b.priority);
    }
    if (sort === "due") {
      return (a.due_date || "9999").localeCompare(b.due_date || "9999");
    }
    if (sort === "identifier") {
      return (a.number ?? 0) - (b.number ?? 0);
    }
    return (a.sort_key ?? 0) - (b.sort_key ?? 0);
  });
  return copy;
}

export type IssueViewMode = "board" | "list" | "table" | "gantt" | "swimlane";

const VIEW_KEY = "coordy.issue-view";

export function readIssueViewMode(): IssueViewMode {
  if (typeof window === "undefined") return "board";
  const value = window.localStorage.getItem(VIEW_KEY);
  if (value === "list" || value === "table" || value === "gantt" || value === "swimlane") return value;
  return "board";
}

export function writeIssueViewMode(mode: IssueViewMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VIEW_KEY, mode);
}

export function unresolvedBlockerIds(task: TaskView): string[] {
  return task.unresolved_blocker_ids ?? [];
}

export function hasUnresolvedBlockers(task: TaskView): boolean {
  return unresolvedBlockerIds(task).length > 0;
}

export function blockerWaitMessage(task: TaskView, tasks: TaskView[]): string | null {
  const ids = unresolvedBlockerIds(task);
  if (ids.length > 0) {
    const labels = ids.map((id) => {
      const blocker = tasks.find((item) => item.id === id);
      return blocker ? `${taskIdentifier(blocker)} ${blocker.title}` : id;
    });
    return `需等待前置事项完成：${labels.join("、")}`;
  }
  if (task.blocked_reason === ISSUE_BLOCKER_REASON) {
    return "需等待前置事项完成。";
  }
  return task.blocked_reason?.trim() ? task.blocked_reason : null;
}

export const COLUMN_KEYS = ["identifier", "title", "status", "priority", "assignee", "project", "due"] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

const COLS_KEY = "coordy.issue-columns";

export function readVisibleColumns(): ColumnKey[] {
  if (typeof window === "undefined") return [...COLUMN_KEYS];
  try {
    const raw = window.localStorage.getItem(COLS_KEY);
    if (!raw) return [...COLUMN_KEYS];
    const parsed = JSON.parse(raw) as string[];
    const allowed = parsed.filter((item): item is ColumnKey => COLUMN_KEYS.includes(item as ColumnKey));
    return allowed.length > 0 ? allowed : [...COLUMN_KEYS];
  } catch {
    return [...COLUMN_KEYS];
  }
}

export function writeVisibleColumns(columns: ColumnKey[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COLS_KEY, JSON.stringify(columns));
}
