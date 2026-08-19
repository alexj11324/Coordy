import {
  Button,
  Input,
  cn,
} from "@coordy/ui";
import {
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleSlash,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type { GithubView, PullRequestView } from "@coordy/protocol";
import { submit } from "../lib/coordy/client";
import {
  checksStatusLabel,
  deriveChecksStatus,
  deriveMergeStatus,
  isTerminalPullRequest,
  mergeStatusLabel,
  pullRequestStateLabel,
  shouldShowPullRequestStats,
  type ChecksStatus,
  type MergeStatus,
} from "../lib/coordy/pull-request";

const PR_LIMIT_BEFORE_COLLAPSE = 4;

export function IssuePullRequests({
  taskId,
  pullRequests,
  github,
  onChanged,
}: {
  taskId: string;
  pullRequests: PullRequestView[];
  github?: GithubView;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [number, setNumber] = useState("");
  const sidebarOn = github?.pr_sidebar !== false;
  if (!sidebarOn) return null;
  const useCollapse = pullRequests.length >= PR_LIMIT_BEFORE_COLLAPSE;
  const head = useCollapse ? pullRequests.slice(0, PR_LIMIT_BEFORE_COLLAPSE - 1) : pullRequests;
  const tail = useCollapse ? pullRequests.slice(PR_LIMIT_BEFORE_COLLAPSE - 1) : [];

  async function linkPr(event: FormEvent) {
    event.preventDefault();
    const parsed = Number.parseInt(number.trim().replace(/^#/, ""), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    await submit({ type: "LinkPullRequest", task_id: taskId, number: parsed });
    setNumber("");
    onChanged();
  }

  return (
    <section>
      <h2 className="mb-1 px-1.5 font-medium text-muted-foreground">Pull requests</h2>
      {pullRequests.length === 0 ? (
        <p className="px-1.5 text-muted-foreground">
          尚未关联。把事项编号写进分支名或标题，或在下方填写 PR 号。
        </p>
      ) : null}
      <div className="space-y-1">
        {head.map((pr) => (
          <PullRequestRow key={`${pr.repo ?? ""}#${pr.number}`} pr={pr} taskId={taskId} onChanged={onChanged} />
        ))}
        {useCollapse ? (
          <div className="space-y-1">
            {expanded ? tail.map((pr) => (
              <PullRequestRow key={`${pr.repo ?? ""}#${pr.number}`} pr={pr} taskId={taskId} onChanged={onChanged} />
            )) : null}
            <button
              type="button"
              className="block w-full rounded-md px-1.5 py-1 text-left text-[12px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "收起" : `还有 ${tail.length} 个`}
            </button>
          </div>
        ) : null}
      </div>
      <form className="mt-2 flex items-center gap-1 px-1.5" onSubmit={(event) => void linkPr(event)}>
        <Input
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          placeholder="PR 号"
          className="h-7"
          inputMode="numeric"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={!number.trim()}>
          关联
        </Button>
      </form>
    </section>
  );
}

function PullRequestRow({
  pr,
  taskId,
  onChanged,
}: {
  pr: PullRequestView;
  taskId: string;
  onChanged: () => void;
}) {
  const state = (pr.state || "open").toLowerCase();
  const StateIcon =
    state === "merged" ? GitMerge : state === "closed" ? GitPullRequestClosed : GitPullRequest;
  const stateClass =
    state === "merged"
      ? "text-violet-600 dark:text-violet-400"
      : state === "closed"
        ? "text-rose-600 dark:text-rose-400"
        : state === "draft"
          ? "text-muted-foreground"
          : "text-emerald-600 dark:text-emerald-400";
  const href = pr.url || undefined;
  const inner = (
    <>
      <StateIcon className={cn("mt-0.5 size-3.5 shrink-0", stateClass)} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium leading-snug">{pr.title || `Pull request #${pr.number}`}</p>
        <p className="truncate text-[12px] text-muted-foreground">
          {pr.repo ? `${pr.repo}#${pr.number}` : `#${pr.number}`} · {pullRequestStateLabel(pr.state)}
          {pr.author ? ` · @${pr.author}` : ""}
        </p>
        <PullRequestDetails pr={pr} />
      </div>
    </>
  );
  return (
    <div className="group relative">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-muted/60"
        >
          {inner}
        </a>
      ) : (
        <div className="flex items-start gap-2 rounded-md px-1.5 py-1.5">{inner}</div>
      )}
      <button
        type="button"
        className="absolute right-1 top-1 hidden rounded px-1 text-[11px] text-muted-foreground hover:text-foreground group-hover:block"
        onClick={() => {
          void submit({ type: "UnlinkPullRequest", task_id: taskId, number: pr.number }).then(onChanged);
        }}
      >
        移除
      </button>
    </div>
  );
}

function PullRequestDetails({ pr }: { pr: PullRequestView }) {
  const showStats = shouldShowPullRequestStats(pr);
  const terminal = isTerminalPullRequest(pr);
  const checks = terminal ? null : checksBadge(deriveChecksStatus(pr));
  const merge = terminal ? null : mergeBadge(deriveMergeStatus(pr));
  const stale = !terminal && pr.snapshot_stale === true;
  if (!showStats && !checks && !merge) return null;
  return (
    <div className={cn("mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground", stale && "opacity-60")}>
      {showStats ? (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">+{pr.additions ?? 0}</span>
          <span className="text-rose-600 dark:text-rose-400">−{pr.deletions ?? 0}</span>
          <span aria-hidden="true">·</span>
          <span>{pr.changed_files ?? 0} 个文件</span>
        </span>
      ) : null}
      {checks}
      {merge}
    </div>
  );
}

function checksBadge(status: ChecksStatus) {
  const label = checksStatusLabel(status);
  if (!label) return null;
  const Icon =
    status.kind === "failed"
      ? XCircle
      : status.kind === "pending"
        ? CircleDashed
        : status.kind === "passed"
          ? CheckCircle2
          : Circle;
  const className =
    status.kind === "failed"
      ? "text-rose-600 dark:text-rose-400"
      : status.kind === "pending"
        ? "text-amber-600 dark:text-amber-400"
        : status.kind === "passed"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-muted-foreground";
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className={cn("size-3", className)} />
      {label}
    </span>
  );
}

function mergeBadge(status: MergeStatus) {
  const label = mergeStatusLabel(status);
  if (!label) return null;
  const Icon = status.kind === "conflicting" ? TriangleAlert : status.kind === "ready" ? CheckCircle2 : CircleSlash;
  const className =
    status.kind === "conflicting"
      ? "text-amber-600 dark:text-amber-400"
      : status.kind === "ready"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className={cn("size-3", className)} />
      {label}
    </span>
  );
}
