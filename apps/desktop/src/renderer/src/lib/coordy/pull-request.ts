import type { PullRequestView } from "@coordy/protocol";

export type ChecksStatus =
  | { kind: "failed"; failed: number; total: number; names: string[] }
  | { kind: "pending"; passed: number; total: number; running: number }
  | { kind: "passed"; total: number }
  | { kind: "none" }
  | { kind: "unavailable" };

export type MergeStatus =
  | { kind: "conflicting" }
  | { kind: "ready" }
  | { kind: "blocked" }
  | { kind: "behind" }
  | { kind: "unstable" }
  | { kind: "has_hooks" }
  | { kind: "none" };

export function deriveChecksStatus(pr: PullRequestView): ChecksStatus {
  if (pr.snapshot_available === false || pr.snapshot_available == null) {
    return { kind: "unavailable" };
  }
  const rollup = (pr.checks_rollup ?? "").toLowerCase();
  const total = pr.checks_total ?? 0;
  const passed = pr.checks_passed ?? 0;
  const failed = pr.checks_failed ?? 0;
  const running = pr.checks_running ?? 0;
  const names = pr.failed_check_names ?? [];
  if (rollup === "failure" || rollup === "error" || failed > 0) {
    return { kind: "failed", failed, total, names };
  }
  if (rollup === "pending" || rollup === "expected" || running > 0) {
    return { kind: "pending", passed, total, running };
  }
  if (rollup === "success") {
    return { kind: "passed", total };
  }
  return { kind: "none" };
}

export function deriveMergeStatus(pr: PullRequestView): MergeStatus {
  if (pr.snapshot_available === false || pr.snapshot_available == null) {
    return { kind: "none" };
  }
  const mergeable = (pr.mergeable ?? "").toLowerCase();
  const mergeState = (pr.merge_state ?? "").toLowerCase();
  if (mergeable === "conflicting" || mergeState === "dirty") return { kind: "conflicting" };
  if (mergeState === "clean") return { kind: "ready" };
  if (mergeState === "blocked") return { kind: "blocked" };
  if (mergeState === "behind") return { kind: "behind" };
  if (mergeState === "unstable") return { kind: "unstable" };
  if (mergeState === "has_hooks") return { kind: "has_hooks" };
  return { kind: "none" };
}

export function shouldShowPullRequestStats(pr: PullRequestView): boolean {
  return (pr.additions ?? 0) + (pr.deletions ?? 0) + (pr.changed_files ?? 0) > 0;
}

export function isTerminalPullRequest(pr: PullRequestView): boolean {
  const state = (pr.state ?? "").toLowerCase();
  return state === "merged" || state === "closed";
}

export function pullRequestStateLabel(state: string | undefined): string {
  switch ((state ?? "").toLowerCase()) {
    case "open":
      return "Open";
    case "draft":
      return "Draft";
    case "merged":
      return "Merged";
    case "closed":
      return "Closed";
    default:
      return state || "PR";
  }
}

export function checksStatusLabel(status: ChecksStatus): string | null {
  switch (status.kind) {
    case "failed": {
      const shown = status.names.slice(0, 2);
      if (shown.length === 0) {
        return `${status.failed}/${status.total} 项检查失败`;
      }
      const extra = status.names.length - shown.length;
      const names = extra > 0 ? `${shown.join(", ")} 等${extra}项` : shown.join(", ");
      return `${status.failed}/${status.total} 失败 · ${names}`;
    }
    case "pending":
      return `${status.passed}/${status.total} 通过 · ${status.running} 进行中`;
    case "passed":
      return status.total > 0 ? `${status.total} 项检查通过` : "检查通过";
    case "none":
      return "尚未配置检查";
    case "unavailable":
      return null;
  }
}

export function mergeStatusLabel(status: MergeStatus): string | null {
  switch (status.kind) {
    case "conflicting":
      return "有冲突";
    case "ready":
      return "可合并";
    case "blocked":
      return "被阻止";
    case "behind":
      return "落后目标分支";
    case "unstable":
      return "不稳定";
    case "has_hooks":
      return "有合并钩子";
    case "none":
      return null;
  }
}
