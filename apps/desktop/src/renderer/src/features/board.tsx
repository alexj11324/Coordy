import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "@coordy/ui";
import { Columns3, LayoutDashboard, List, Plus } from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import {
  filterIssues,
  ISSUE_BOARD_COLUMNS,
  ISSUE_LIST_GROUPS,
  issuesInColumn,
  readIssueViewMode,
  taskIdentifier,
  writeIssueViewMode,
  type IssueViewMode,
} from "../lib/coordy/issues";
import { agentDisplayName, listableAgents, TASK_STATUS_ITEMS } from "../lib/coordy/labels";
import { useSession } from "../state/session-store";
import { useLayoutStore } from "../state/layout-store";
import { asAgents, asRuns, asTasks, latestRunForTask } from "../lib/coordy/views";
import type { AgentView, DiscoveredAgentView, Query, TaskView } from "@coordy/protocol";
import { NamedWithLogo, ProviderLogo } from "./provider-logo";
import { StatusGlyph } from "./issue-status";

function useWorkspaceQuery(make: (workspace_id: string) => Query) {
  const workspaceId = useSession((s) => s.workspaceId);
  return useQuery({
    queryKey: ["view", make(workspaceId ?? ""), workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view(make(workspaceId!)),
  });
}

export function BoardPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Board", workspace_id }));
  const agents = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const runsQuery = useWorkspaceQuery((workspace_id) => ({ type: "Runs", workspace_id }));
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });
  const qc = useQueryClient();
  const workspaceId = useSession((s) => s.workspaceId);
  const tasks = asTasks(q.data);
  const agentList = listableAgents(asAgents(agents.data));
  const runList = asRuns(runsQuery.data);
  const [mode, setMode] = useState<IssueViewMode>(readIssueViewMode);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const pendingFocus = useLayoutStore((s) => s.pendingFocus);
  const visible = useMemo(() => filterIssues(tasks, query, status), [tasks, query, status]);

  useEffect(() => {
    if (pendingFocus !== "new-task") return;
    useLayoutStore.getState().consumePendingFocus();
    setComposerOpen(true);
  }, [pendingFocus]);

  useEffect(() => {
    if (!composerOpen) return;
    document.getElementById("board-new-title")?.focus();
  }, [composerOpen]);

  const create = useMutation({
    mutationFn: async (title: string) => {
      if (!workspaceId) throw new Error("还没准备好，请稍等一下");
      return submit({ type: "CreateTask", workspace_id: workspaceId, title });
    },
    onSuccess: async () => {
      setDraft("");
      setComposerOpen(false);
      await qc.invalidateQueries();
    },
  });

  const setView = (next: IssueViewMode) => {
    setMode(next);
    writeIssueViewMode(next);
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <h1 className="mr-2 text-sm font-semibold">任务</h1>
        <div className="flex items-center rounded-lg border border-border p-0.5">
          <Button
            type="button"
            size="xs"
            variant={mode === "board" ? "secondary" : "ghost"}
            onClick={() => setView("board")}
          >
            <Columns3 data-icon="inline-start" />
            看板
          </Button>
          <Button
            type="button"
            size="xs"
            variant={mode === "list" ? "secondary" : "ghost"}
            onClick={() => setView("list")}
          >
            <List data-icon="inline-start" />
            列表
          </Button>
        </div>
        <Input
          value={query}
          placeholder="筛选标题或编号"
          className="h-7 w-44"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          value={status}
          items={{ all: "全部状态", ...TASK_STATUS_ITEMS }}
          onValueChange={(value) => value && setStatus(value)}
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {Object.entries(TASK_STATUS_ITEMS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setComposerOpen(true)}>
            <Plus data-icon="inline-start" />
            新建
          </Button>
        </div>
      </header>

      {composerOpen ? (
        <form
          className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const title = draft.trim();
            if (!title) return;
            create.mutate(title);
          }}
        >
          <StatusGlyph status="open" />
          <Input
            id="board-new-title"
            value={draft}
            placeholder="事项标题"
            className="h-8 border-0 shadow-none focus-visible:ring-0"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setComposerOpen(false);
                setDraft("");
              }
            }}
          />
          <Button type="submit" size="sm" disabled={create.isPending || !draft.trim()}>
            创建
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setComposerOpen(false);
              setDraft("");
            }}
          >
            取消
          </Button>
        </form>
      ) : null}

      {visible.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutDashboard />
              </EmptyMedia>
              <EmptyTitle>{tasks.length === 0 ? "还没有事项" : "没有匹配的事项"}</EmptyTitle>
              <EmptyDescription>
                {tasks.length === 0 ? "按 C 或点新建，先写个标题。" : "换个筛选条件，或清空搜索。"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : mode === "board" ? (
        <IssueBoard
          tasks={visible}
          agents={agentList}
          catalog={catalog.data}
          runningIds={new Set(runList.filter((run) => run.status === "running").map((run) => run.task_id))}
          onMoved={() => qc.invalidateQueries()}
        />
      ) : (
        <IssueList
          tasks={visible}
          agents={agentList}
          catalog={catalog.data}
          runs={runList}
        />
      )}
    </section>
  );
}

function IssueBoard({
  tasks,
  agents,
  catalog,
  runningIds,
  onMoved,
}: {
  tasks: TaskView[];
  agents: AgentView[];
  catalog: DiscoveredAgentView[] | undefined;
  runningIds: Set<string>;
  onMoved: () => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto p-4">
      {ISSUE_BOARD_COLUMNS.map((column) => {
        const items = issuesInColumn(tasks, column.id);
        return (
          <BoardColumn
            key={column.id}
            columnId={column.id}
            title={column.title}
            tasks={items}
            agents={agents}
            catalog={catalog}
            runningIds={runningIds}
            onMoved={onMoved}
          />
        );
      })}
    </div>
  );
}

function BoardColumn({
  columnId,
  title,
  tasks,
  agents,
  catalog,
  runningIds,
  onMoved,
}: {
  columnId: string;
  title: string;
  tasks: TaskView[];
  agents: AgentView[];
  catalog: DiscoveredAgentView[] | undefined;
  runningIds: Set<string>;
  onMoved: () => void;
}) {
  const [over, setOver] = useState(false);
  const dropStatus = columnId === "done" ? "done" : columnId;
  return (
    <div
      className={cn(
        "flex min-h-0 w-[min(100%,18rem)] min-w-[16rem] flex-1 flex-col rounded-xl bg-muted/40",
        over ? "ring-2 ring-ring/40" : "",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const taskId = event.dataTransfer.getData("text/coordy-task");
        if (!taskId) return;
        void submit({ type: "SetTaskStatus", task_id: taskId, status: dropStatus }).then(onMoved);
      }}
    >
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <StatusGlyph status={dropStatus} />
          {title}
        </div>
        <Badge variant="secondary">{tasks.length}</Badge>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-2 pb-2">
        {tasks.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">空</p>
        ) : (
          tasks.map((task) => (
            <IssueCard
              key={task.id}
              task={task}
              agent={agents.find((item) => item.id === task.assignee_agent_id)}
              catalog={catalog}
              running={runningIds.has(task.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function IssueCard({
  task,
  agent,
  catalog,
  running,
}: {
  task: TaskView;
  agent?: AgentView;
  catalog: DiscoveredAgentView[] | undefined;
  running: boolean;
}) {
  const navigate = useNavigate();
  const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData("text/coordy-task", task.id);
    event.dataTransfer.effectAllowed = "move";
  };
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={() => navigate(`/board/${task.id}`)}
      className="w-full rounded-lg border border-border bg-background p-2.5 text-left shadow-sm transition-colors hover:bg-muted/50"
    >
      <p className="line-clamp-2 text-sm font-medium">{task.title}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{taskIdentifier(task.id)}</span>
        <div className="flex min-w-0 items-center gap-1.5">
          {running ? <span className="size-1.5 rounded-full bg-sky-500" title="进行中" /> : null}
          {agent ? (
            <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
              <ProviderLogo provider={agent.harness} className="size-3.5" />
              <span className="max-w-[7rem] truncate">{agentDisplayName(agent, catalog)}</span>
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">未指派</span>
          )}
        </div>
      </div>
    </button>
  );
}

function IssueList({
  tasks,
  agents,
  catalog,
  runs,
}: {
  tasks: TaskView[];
  agents: AgentView[];
  catalog: DiscoveredAgentView[] | undefined;
  runs: ReturnType<typeof asRuns>;
}) {
  const navigate = useNavigate();
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {ISSUE_LIST_GROUPS.map((group) => {
        const items = group.id === "cancelled"
          ? tasks.filter((task) => task.status === "cancelled")
          : issuesInColumn(tasks, group.id).filter((task) => task.status !== "cancelled");
        if (items.length === 0 && group.id === "cancelled") return null;
        return (
          <section key={group.id}>
            <div className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-border bg-background px-4 text-sm font-medium">
              <StatusGlyph status={group.id} />
              {group.title}
              <span className="text-xs font-normal text-muted-foreground">{items.length}</span>
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">空</p>
            ) : (
              items.map((task) => {
                const agent = agents.find((item) => item.id === task.assignee_agent_id);
                const latest = latestRunForTask(runs, task.id);
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => navigate(`/board/${task.id}`)}
                    className="flex h-9 w-full items-center gap-3 border-b border-border/60 px-4 text-left hover:bg-muted/50"
                  >
                    <StatusGlyph status={task.status} />
                    <span className="w-[5.5rem] shrink-0 font-mono text-xs text-muted-foreground">
                      {taskIdentifier(task.id)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                    {latest?.status === "running" ? (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        执行中
                      </Badge>
                    ) : null}
                    {agent ? (
                      <NamedWithLogo provider={agent.harness} className="max-w-[9rem] shrink-0 text-xs text-muted-foreground">
                        {agentDisplayName(agent, catalog)}
                      </NamedWithLogo>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">未指派</span>
                    )}
                  </button>
                );
              })
            )}
          </section>
        );
      })}
    </div>
  );
}
