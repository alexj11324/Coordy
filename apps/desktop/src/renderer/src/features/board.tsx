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
import { LayoutDashboard, Play, Plus, Terminal } from "lucide-react";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { submit, view } from "../lib/coordy/client";
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
  { id: "review", title: "验收" },
  { id: "blocked", title: "阻塞" },
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
  const title = useForm("");
  const claim = useForm("never-deploy-without-approval");
  const patch = useForm("");
  const prompt = useForm("继续做这件事，用中文汇报进度。");
  const command = useCommand();
  const qc = useQueryClient();
  const tasks = asTasks(q.data);
  const workspaceId = useSession((s) => s.workspaceId);
  const agentList = asAgents(agents.data);
  const runList = asRuns(runsQuery.data);
  const settings = useQuery({
    queryKey: ["board-settings", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Settings", workspace_id: workspaceId! }),
  });
  const repoPath = settings.data?.type === "Settings" ? settings.data.repo_path : null;
  const [assigneeByTask, setAssigneeByTask] = useState<Record<string, string>>({});
  const agentName = (id: string | null | undefined) =>
    agentList.find((agent) => agent.id === id)?.name ?? id ?? "未指派";
  const agentItems = Object.fromEntries(agentList.map((agent) => [agent.id, agent.name]));

  const grouped = COLUMNS.map((column) => ({
    ...column,
    tasks: tasks.filter((task) => boardColumn(task.status) === column.id),
  }));

  return (
    <section>
      <PageHeader title="任务" description="把任务指派给助手后它会立刻开工，进度写在卡片上，做完进入验收。" />
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
          placeholder="新任务"
          value={title.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => title.set(event.target.value)}
        />
        <Button type="submit">
          <Plus data-icon="inline-start" />
          创建
        </Button>
      </form>
      <div className="mb-4 space-y-1.5">
        <Label htmlFor="board-prompt">指派时对助手说</Label>
        <Textarea
          id="board-prompt"
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
            <EmptyTitle>还没有任务</EmptyTitle>
            <EmptyDescription>创建一个任务，或回到「开始」页直接说一句话。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-4">
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
                    agentName={agentName(task.assignee_agent_id)}
                    assignee={assigneeByTask[task.id] || task.assignee_agent_id || agentList[0]?.id || ""}
                    onAssignee={(value) => setAssigneeByTask((prev) => ({ ...prev, [task.id]: value }))}
                    prompt={prompt.value || task.title}
                    repoPath={repoPath ?? null}
                    workspaceId={workspaceId}
                    claim={claim.value}
                    patch={patch.value}
                    onPatch={patch.set}
                    latestRunId={latestRunForTask(runList, task.id)?.id ?? null}
                    onInvalidate={() => qc.invalidateQueries()}
                    command={command.mutate}
                  />
                ))
              )}
            </div>
          ))}
        </div>
      )}
      <h2 className="mb-2 mt-8 text-lg font-medium">承诺</h2>
      <div className="mb-3 flex items-center gap-2">
        <Label htmlFor="commitment-claim" className="shrink-0 text-muted-foreground">
          声明
        </Label>
        <Input
          id="commitment-claim"
          value={claim.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => claim.set(event.target.value)}
        />
      </div>
      {asCommitments(commitments.data).length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有承诺。在任务卡片里写下一句约束后会出现在这里。</p>
      ) : (
        asCommitments(commitments.data).map((item) => (
          <Card key={item.id} size="sm" className="mb-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge>{item.authority}</Badge>
                {item.claim}
              </CardTitle>
              <CardAction>
                <Badge variant="outline">{item.status}</Badge>
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
  agentName,
  assignee,
  onAssignee,
  prompt,
  repoPath,
  workspaceId,
  claim,
  patch,
  onPatch,
  latestRunId,
  onInvalidate,
  command,
}: {
  task: TaskView;
  agentList: { id: string; name: string }[];
  agentItems: Record<string, string>;
  agentName: string;
  assignee: string;
  onAssignee: (value: string) => void;
  prompt: string;
  repoPath: string | null;
  workspaceId: string | null;
  claim: string;
  patch: string;
  onPatch: (value: string) => void;
  latestRunId: string | null;
  onInvalidate: () => void;
  command: (command: Command) => void;
}) {
  const detail = useQuery({
    queryKey: ["board-run", latestRunId],
    enabled: Boolean(latestRunId),
    queryFn: () => view({ type: "Run", run_id: latestRunId! }),
    refetchInterval: task.status === "running" ? 800 : false,
  });
  const events = (asRunDetail(detail.data)?.events ?? []).slice(-6);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">{task.title}</CardTitle>
        <CardDescription>
          {task.assignee_agent_id ? agentName : "未指派"}
          {task.worktree_path ? ` · ${task.worktree_path}` : ""}
        </CardDescription>
        <CardAction>
          <Badge>{task.status}</Badge>
        </CardAction>
      </CardHeader>
      {task.blocked_reason ? (
        <CardContent>
          <p className="text-sm text-destructive">{task.blocked_reason}</p>
        </CardContent>
      ) : null}
      {events.length > 0 ? (
        <CardContent className="space-y-1">
          {events.map((event) => (
            <p key={event.seq} className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
              {event.payload}
            </p>
          ))}
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
                {agent.name}
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
              void (async () => {
                await startAcpOnTask(task.id, prompt || task.title, assignee);
                onInvalidate();
              })();
            }}
          >
            <Play data-icon="inline-start" />
            指派并开始
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              let repo = repoPath;
              if (!repo) {
                repo = await window.coordy.chooseRepository();
                if (repo && workspaceId) {
                  await submit({ type: "BindRepository", workspace_id: workspaceId, path: repo });
                }
              }
              if (!repo) return;
              command({ type: "CreateWorktree", task_id: task.id });
            }}
          >
            工作树
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!task.worktree_path && !repoPath}
            onClick={() => {
              const path = task.worktree_path || repoPath;
              if (path) void window.coordy.revealFile(path);
            }}
          >
            目录
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!task.worktree_path && !repoPath}
            onClick={() => {
              const path = task.worktree_path || repoPath;
              if (path) void window.coordy.openTerminal(path);
            }}
          >
            <Terminal data-icon="inline-start" />
            终端
          </Button>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="要应用的补丁"
            value={patch}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onPatch(event.target.value)}
          />
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              if (!patch.trim()) return;
              command({ type: "ApplyPatch", task_id: task.id, patch });
            }}
            disabled={!patch.trim()}
          >
            应用
          </Button>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (!workspaceId) return;
            command({
              type: "UpsertCommitment",
              workspace_id: workspaceId,
              task_id: task.id,
              commitment_type: "CONSTRAINT",
              claim,
              polarity: "MUST_NOT",
              authority: "USER",
              scope: task.id,
            });
          }}
        >
          写下承诺
        </Button>
      </CardFooter>
    </Card>
  );
}
