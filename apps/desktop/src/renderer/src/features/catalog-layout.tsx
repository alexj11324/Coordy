import {
  Badge,
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  cn,
} from "@coordy/ui";
import type { LucideIcon } from "lucide-react";
import { Plus, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { view } from "../lib/coordy/client";
import { projectStatusDotClass, projectStatusLabel } from "../lib/coordy/catalog";
import { asWorkspaces } from "../lib/coordy/views";
import { useSession } from "../state/session-store";

export const catalogPillTrigger = "h-7 w-auto max-w-52 gap-1.5 rounded-md px-2";

export function CatalogPageHeader({
  icon: Icon,
  title,
  count,
  actionLabel,
  onCreate,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  actionLabel: string;
  onCreate: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <h1 className="truncate text-sm font-medium">{title}</h1>
      {count > 0 ? (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{count}</span>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="ml-auto"
        aria-label={actionLabel}
        onClick={onCreate}
      >
        <Plus data-icon="inline-start" />
        <span className="hidden md:inline">{actionLabel}</span>
      </Button>
    </header>
  );
}

export function CatalogEmpty({
  icon: Icon,
  title,
  description,
  actionLabel,
  onCreate,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel: string;
  onCreate: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-auto px-5 py-12">
      <Empty className="max-w-md border-0 bg-transparent">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" size="sm" variant="outline" onClick={onCreate}>
            <Plus data-icon="inline-start" />
            {actionLabel}
          </Button>
        </EmptyContent>
      </Empty>
      {children}
    </div>
  );
}

export function CatalogComposer({
  open,
  title,
  submitLabel,
  submitDisabled,
  onClose,
  onSubmit,
  children,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  submitDisabled?: boolean;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const workspaceId = useSession((s) => s.workspaceId);
  const workspaces = useQuery({
    queryKey: ["view", { type: "Workspaces" }],
    queryFn: () => view({ type: "Workspaces" }),
    enabled: open,
  });
  const workspaceName =
    asWorkspaces(workspaces.data).find((item) => item.id === workspaceId)?.name ?? "工作区";

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 p-4 pt-[10vh]">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="关闭" onClick={onClose} />
      <form
        className="relative z-10 flex max-h-[min(40rem,82vh)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSubmit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="flex shrink-0 items-center justify-between px-5 pt-3 pb-2 text-sm">
          <p className="text-muted-foreground">
            <span className="text-foreground">{workspaceName}</span>
            <span className="mx-1.5">›</span>
            {title}
          </p>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="关闭" onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-3">{children}</div>
        <div className="flex shrink-0 items-center justify-end border-t border-border px-4 py-3">
          <Button type="submit" size="sm" disabled={submitDisabled}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function CatalogListRow({
  onClick,
  columns,
  children,
}: {
  onClick: () => void;
  columns?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "grid w-full items-center gap-3 border-b border-border px-4 py-3 text-left hover:bg-muted/40",
        columns ??
          "grid-cols-[minmax(0,1.5fr)_minmax(6rem,0.8fr)_minmax(5.5rem,0.7fr)] md:grid-cols-[minmax(0,1.6fr)_minmax(8rem,0.7fr)_minmax(7rem,0.6fr)_minmax(6rem,0.5fr)]",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function CatalogListHeader({
  columns,
  children,
}: {
  columns?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "hidden items-center gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground md:grid",
        columns ??
          "md:grid-cols-[minmax(0,1.6fr)_minmax(8rem,0.7fr)_minmax(7rem,0.6fr)_minmax(6rem,0.5fr)]",
      )}
    >
      {children}
    </div>
  );
}

export function ProjectStatusBadge({ status }: { status: string | undefined }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={cn("size-1.5 rounded-full", projectStatusDotClass(status))} />
      {projectStatusLabel(status)}
    </Badge>
  );
}

export function ProgressRing({ done, total }: { done: number; total: number }) {
  if (total === 0) {
    return <span className="text-xs text-muted-foreground">尚无事项</span>;
  }
  const pct = Math.round((done / total) * 100);
  const radius = 6;
  const circ = 2 * Math.PI * radius;
  return (
    <span className="flex items-center gap-1.5">
      <svg className="size-3.5 -rotate-90" viewBox="0 0 16 16" aria-hidden="true">
        <circle className="text-muted" cx="8" cy="8" fill="none" r={radius} stroke="currentColor" strokeWidth="2" />
        <circle
          className="text-emerald-500"
          cx="8"
          cy="8"
          fill="none"
          r={radius}
          stroke="currentColor"
          strokeDasharray={`${(pct / 100) * circ} ${circ}`}
          strokeLinecap="round"
          strokeWidth="2"
        />
      </svg>
      <span className="text-xs tabular-nums text-muted-foreground">
        {done}/{total}
      </span>
    </span>
  );
}

export function CatalogNotFound({
  icon: Icon,
  backTo,
  backLabel,
  title,
  description,
}: {
  icon: LucideIcon;
  backTo: string;
  backLabel: string;
  title: string;
  description: string;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Link to={backTo} className="text-sm text-muted-foreground hover:text-foreground">
          {backLabel}
        </Link>
      </header>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5">
        <Empty className="max-w-md border-0 bg-transparent">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon />
            </EmptyMedia>
            <EmptyTitle>{title}</EmptyTitle>
            <EmptyDescription>{description}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link to={backTo} className="text-sm text-primary hover:underline">
              返回{backLabel}
            </Link>
          </EmptyContent>
        </Empty>
      </div>
    </section>
  );
}
