import type { TaskView } from "@coordy/protocol";
import { boardColumn } from "./views";

export const ISSUE_BOARD_COLUMNS = [
  { id: "open", title: "待办" },
  { id: "running", title: "进行中" },
  { id: "review", title: "待验收" },
  { id: "blocked", title: "暂时做不了" },
  { id: "done", title: "已完成" },
] as const;

export const ISSUE_LIST_GROUPS = [
  ...ISSUE_BOARD_COLUMNS,
  { id: "cancelled", title: "不做了" },
] as const;

export function taskIdentifier(id: string): string {
  const raw = id.trim();
  const body = raw.includes("_") ? raw.slice(raw.indexOf("_") + 1) : raw;
  const token = body.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  return token ? `TASK-${token}` : "TASK";
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
      return "text-muted-foreground/60";
    default:
      return "text-muted-foreground";
  }
}

export function filterIssues(
  tasks: TaskView[],
  query: string,
  status: string,
): TaskView[] {
  const needle = query.trim().toLowerCase();
  return tasks.filter((task) => {
    if (status !== "all" && task.status !== status) return false;
    if (!needle) return true;
    return (
      task.title.toLowerCase().includes(needle) ||
      taskIdentifier(task.id).toLowerCase().includes(needle) ||
      (task.description ?? "").toLowerCase().includes(needle)
    );
  });
}

export function issuesInColumn(tasks: TaskView[], columnId: string): TaskView[] {
  if (columnId === "cancelled") return tasks.filter((task) => task.status === "cancelled");
  return tasks.filter((task) => boardColumn(task.status) === columnId);
}

export type IssueViewMode = "board" | "list";

const VIEW_KEY = "coordy.issue-view";

export function readIssueViewMode(): IssueViewMode {
  if (typeof window === "undefined") return "board";
  return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "board";
}

export function writeIssueViewMode(mode: IssueViewMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VIEW_KEY, mode);
}
