import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  cn,
} from "@coordy/ui";
import { Columns3, Filter, LayoutDashboard, List, Plus, SlidersHorizontal } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import {
  boardIssues,
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
import { ColumnMenu, IssueComposerButton } from "./issue-create-dialog";

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
  const tasks = boardIssues(asTasks(q.data));
  const agentList = listableAgents(asAgents(agents.data));
  const runList = asRuns(runsQuery.data);
  const [mode, setMode] = useState<IssueViewMode>(readIssueViewMode);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const visible = useMemo(
    () => filterIssues(tasks, { query, status, assignee, project: "all", priority: "all" }),
    [tasks, query, status, assignee],
  );

  const setView = (next: IssueViewMode) => {
    setMode(next);
    writeIssueViewMode(next);
  };

  const scopeItems = [
    { id: "all", label: "全部" },
    { id: "members", label: "成员" },
    { id: "agents", label: "智能体" },
  ] as const;

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <h1 className="mr-1 text-sm font-semibold">任务</h1>
        <div className="flex items-center rounded-lg border border-border p-0.5">
          {scopeItems.map((item) => (
            <Button
              key={item.id}
              type="button"
              size="xs"
              variant={assignee === item.id ? "secondary" : "ghost"}
              onClick={() => setAssignee(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <Input
          value={query}
          placeholder="筛选标题或编号"
          className="h-7 w-44"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" size="sm" variant="outline" />}>
              <Filter data-icon="inline-start" />
              筛选
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuRadioGroup value={status} onValueChange={(value) => value && setStatus(value)}>
                <DropdownMenuRadioItem value="all">全部状态</DropdownMenuRadioItem>
                {Object.entries(TASK_STATUS_ITEMS).map(([value, label]) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" size="sm" variant="outline" />}>
              <SlidersHorizontal data-icon="inline-start" />
              显示
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuRadioGroup
                value={mode === "list" ? "list" : "board"}
                onValueChange={(value) => setView(value === "list" ? "list" : "board")}
              >
                <DropdownMenuRadioItem value="board">
                  <Columns3 />
                  看板
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="list">
                  <List />
                  列表
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <IssueComposerButton />
        </div>
      </header>

      {visible.length === 0 && mode !== "board" ? (
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
      <div className="flex h-10 shrink-0 items-center justify-between px-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <StatusGlyph status={dropStatus} />
          {title}
          <Badge variant="secondary">{tasks.length}</Badge>
        </div>
        <div className="flex items-center">
          <ColumnMenu status={dropStatus} />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="在此列新建"
            title="新建任务"
            onClick={() => useLayoutStore.getState().openIssueComposer(dropStatus)}
          >
            <Plus />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-2 pb-2">
        {tasks.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">无任务</p>
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
              <p className="px-4 py-3 text-xs text-muted-foreground">无任务</p>
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
