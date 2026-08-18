import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@coordy/ui";
import { LayoutDashboard, Play, Plus } from "lucide-react";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import {
  agentDisplayName,
  formatActivity,
  listableAgents,
  taskStatusLabel,
} from "../lib/coordy/labels";
import { startAcpOnTask } from "../lib/coordy/start-task";
import { useSession } from "../state/session-store";
import type { Command, Query, TaskView } from "@coordy/protocol";
import {
  asAgents,
  asCommitments,
  asRunDetail,
  asRuns,
  asTasks,
  boardColumn,
  latestRunForTask,
  type BoardColumn,
} from "../lib/coordy/views";

const COLUMNS: { id: BoardColumn; title: string }[] = [
  { id: "open", title: "待办" },
  { id: "running", title: "进行中" },
  { id: "review", title: "待验收" },
  { id: "blocked", title: "暂时做不了" },
  { id: "done", title: "已完成" },
];

function useWorkspaceQuery(make: (workspace_id: string) => Query) {
  const workspaceId = useSession((s) => s.workspaceId);
  return useQuery({
    queryKey: ["view", make(workspaceId ?? ""), workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view(make(workspaceId!)),
  });
}

function useCommand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (command: Command) => submit(command),
    onSuccess: () => qc.invalidateQueries(),
  });
}

function useForm(initial: string) {
  const [value, set] = useState(initial);
  return { value, set };
}

export function BoardPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Board", workspace_id }));
  const commitments = useWorkspaceQuery((workspace_id) => ({
    type: "Commitments",
    workspace_id,
  }));
  const agents = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const runsQuery = useWorkspaceQuery((workspace_id) => ({ type: "Runs", workspace_id }));
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });
  const title = useForm("");
  const prompt = useForm("");
  const command = useCommand();
  const qc = useQueryClient();
  const tasks = asTasks(q.data);
  const workspaceId = useSession((s) => s.workspaceId);
  const agentList = listableAgents(asAgents(agents.data));
  const runList = asRuns(runsQuery.data);
  const [assigneeByTask, setAssigneeByTask] = useState<Record<string, string>>({});
  const agentItems = Object.fromEntries(
    agentList.map((agent) => [agent.id, agentDisplayName(agent, catalog.data)]),
  );

  const grouped = COLUMNS.map((column) => ({
    ...column,
    tasks: tasks.filter((task) => boardColumn(task.status) === column.id),
  }));

  return (
    <section>
      <PageHeader
        title="事项"
        description="一件事项记下要做什么、交给谁、现在到哪一步。指派给智能体后它会开工，进度写回这件事。"
      />
      <form
        className="mb-4 flex gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (workspaceId && title.value) {
            command.mutate({ type: "CreateTask", workspace_id: workspaceId, title: title.value });
            title.set("");
          }
        }}
      >
        <Input
          placeholder="先写个标题就行，别的以后再补"
          value={title.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => title.set(event.target.value)}
        />
        <Button type="submit">
          <Plus data-icon="inline-start" />
          创建
        </Button>
      </form>
      <div className="mb-4 space-y-1.5">
        <Label htmlFor="board-prompt">这次开工要特别注意的（只作用于这一轮）</Label>
        <Textarea
          id="board-prompt"
          placeholder="范围、顺序，或这次先看什么。长期要求写进事项说明里。"
          value={prompt.value}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => prompt.set(event.target.value)}
        />
      </div>
      {tasks.length === 0 ? (
        <Empty className="bg-muted/30">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutDashboard />
            </EmptyMedia>
            <EmptyTitle>还没有事项</EmptyTitle>
            <EmptyDescription>创建一个，或先新建智能体再从「开始」页说一句话。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-5">
          {grouped.map((column) => (
            <div key={column.id} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-medium">{column.title}</h2>
                <Badge variant="secondary">{column.tasks.length}</Badge>
              </div>
              {column.tasks.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">空</p>
              ) : (
                column.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    agentList={agentList}
                    agentItems={agentItems}
                    catalog={catalog.data}
                    assignee={assigneeByTask[task.id] || task.assignee_agent_id || agentList[0]?.id || ""}
                    onAssignee={(value) => setAssigneeByTask((prev) => ({ ...prev, [task.id]: value }))}
                    prompt={prompt.value || task.title}
                    latestRunId={latestRunForTask(runList, task.id)?.id ?? null}
                    onInvalidate={() => qc.invalidateQueries()}
                  />
                ))
              )}
            </div>
          ))}
        </div>
      )}
      <h2 className="mb-2 mt-8 text-lg font-medium">约定</h2>
      {asCommitments(commitments.data).length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有写进事项里的长期约定。</p>
      ) : (
        asCommitments(commitments.data).map((item) => (
          <Card key={item.id} size="sm" className="mb-2">
            <CardHeader>
              <CardTitle>{item.claim}</CardTitle>
              <CardAction>
                <Badge variant="outline">{item.status === "ACTIVE" ? "有效" : item.status}</Badge>
              </CardAction>
            </CardHeader>
          </Card>
        ))
      )}
    </section>
  );
}

function TaskCard({
  task,
  agentList,
  agentItems,
  catalog,
  assignee,
  onAssignee,
  prompt,
  latestRunId,
  onInvalidate,
}: {
  task: TaskView;
  agentList: { id: string; name: string; harness: string }[];
  agentItems: Record<string, string>;
  catalog: Parameters<typeof agentDisplayName>[1];
  assignee: string;
  onAssignee: (value: string) => void;
  prompt: string;
  latestRunId: string | null;
  onInvalidate: () => void;
}) {
  const detail = useQuery({
    queryKey: ["board-run", latestRunId],
    enabled: Boolean(latestRunId),
    queryFn: () => view({ type: "Run", run_id: latestRunId! }),
    refetchInterval: task.status === "running" ? 800 : false,
  });
  const events = (asRunDetail(detail.data)?.events ?? []).slice(-3);
  const assigneeName = agentList.find((agent) => agent.id === task.assignee_agent_id);
  const navigate = useNavigate();
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">
          <Link to={`/board/${task.id}`} className="hover:underline">
            {task.title}
          </Link>
        </CardTitle>
        <CardDescription>
          {assigneeName ? agentDisplayName(assigneeName, catalog) : "未指派"}
        </CardDescription>
        <CardAction>
          <Badge>{taskStatusLabel(task.status)}</Badge>
        </CardAction>
      </CardHeader>
      {events.length > 0 ? (
        <CardContent className="space-y-1">
          {events.map((event) => {
            const line = formatActivity(event);
            return (
              <p key={event.seq} className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                {line.label}：{line.body}
              </p>
            );
          })}
        </CardContent>
      ) : null}
      <CardFooter className="flex-col items-stretch gap-2">
        <Select value={assignee} items={agentItems} onValueChange={(value) => value && onAssignee(value)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {agentList.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agentDisplayName(agent, catalog)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!assignee}
            onClick={() => {
              if (!assignee) return;
              void startAcpOnTask(task.id, prompt || task.title, assignee).then(onInvalidate);
            }}
          >
            <Play data-icon="inline-start" />
            指派并开始
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate(`/board/${task.id}`)}>
            打开
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
