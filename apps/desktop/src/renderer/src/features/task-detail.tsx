import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
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
import { ArrowLeft, FolderOpen, Play, Square, Terminal } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import {
  agentDisplayName,
  formatActivity,
  listableAgents,
  runStatusLabel,
  TASK_STATUS_ITEMS,
  taskStatusLabel,
} from "../lib/coordy/labels";
import { startAcpOnTask } from "../lib/coordy/start-task";
import { asAgents, asRunDetail, asRuns, asTasks, latestRunForTask } from "../lib/coordy/views";
import { useSession } from "../state/session-store";

export function TaskDetailPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const workspaceId = useSession((s) => s.workspaceId);
  const qc = useQueryClient();
  const board = useQuery({
    queryKey: ["view", { type: "Board", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Board", workspace_id: workspaceId! }),
  });
  const agents = useQuery({
    queryKey: ["view", { type: "Agents", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Agents", workspace_id: workspaceId! }),
  });
  const runsQuery = useQuery({
    queryKey: ["view", { type: "Runs", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Runs", workspace_id: workspaceId! }),
    refetchInterval: 1000,
  });
  const settings = useQuery({
    queryKey: ["settings", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Settings", workspace_id: workspaceId! }),
  });
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });
  const task = asTasks(board.data).find((item) => item.id === taskId);
  const agentList = listableAgents(asAgents(agents.data));
  const runList = asRuns(runsQuery.data).filter((run) => run.task_id === taskId);
  const latest = taskId ? latestRunForTask(runList, taskId) : undefined;
  const details = useQueries({
    queries: runList.map((run) => ({
      queryKey: ["run", run.id],
      queryFn: () => view({ type: "Run", run_id: run.id }),
      refetchInterval: run.status === "running" ? 800 : false,
    })),
  });
  const activity = details.flatMap((item, index) => {
    const run = runList[index];
    const events = asRunDetail(item.data)?.events ?? [];
    return events.map((event) => ({ ...event, runId: run?.id ?? "", runStatus: run?.status ?? "" }));
  });
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const repoPath = settings.data?.type === "Settings" ? settings.data.repo_path : null;
  const workPath = task?.worktree_path || repoPath;

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? "");
  }, [task?.id, task?.title, task?.description]);

  const save = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error("找不到这件事");
      await submit({
        type: "UpdateTask",
        task_id: task.id,
        title: title.trim(),
        description,
      });
    },
    onSuccess: () => qc.invalidateQueries(),
  });

  useEffect(() => {
    if (!taskId) navigate("/board");
  }, [taskId, navigate]);
  if (!taskId) return null;
  if (board.isFetched && !task) {
    return (
      <section>
        <PageHeader title="找不到这件事" description="它可能已经被移走了。" />
        <Button variant="secondary" onClick={() => navigate("/board")}>
          回到看板
        </Button>
      </section>
    );
  }
  if (!task) return null;

  const assignee = task.assignee_agent_id || agentList[0]?.id || "";
  const agentItems = Object.fromEntries(
    agentList.map((agent) => [agent.id, agentDisplayName(agent, catalog.data)]),
  );

  return (
    <section className="space-y-4">
      <div>
        <Link to="/board" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          看板
        </Link>
        <PageHeader
          title={task.title}
          description="一件事项记下要做什么、交给谁、现在到哪一步，以及智能体后来的进度。"
        />
      </div>
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>事项</CardTitle>
          <CardDescription>标题够用就可以先建；背景、要求和验收标准写在说明里。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="issue-title">标题</Label>
            <Input id="issue-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="issue-body">说明</Label>
            <Textarea
              id="issue-body"
              rows={5}
              placeholder="目标、背景、要求和验收标准"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>状态</Label>
              <Select
                value={task.status}
                items={TASK_STATUS_ITEMS}
                onValueChange={(value) => {
                  if (!value) return;
                  void submit({ type: "SetTaskStatus", task_id: task.id, status: value }).then(() =>
                    qc.invalidateQueries(),
                  );
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TASK_STATUS_ITEMS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>指派给</Label>
              <Select
                value={assignee}
                items={agentItems}
                onValueChange={(value) => {
                  if (!value) return;
                  void submit({ type: "AssignTask", task_id: task.id, agent_id: value }).then(() =>
                    qc.invalidateQueries(),
                  );
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {agentList.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agentDisplayName(agent, catalog.data)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {task.blocked_reason ? <p className="text-sm text-destructive">{task.blocked_reason}</p> : null}
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending || !title.trim()}>
            保存
          </Button>
          <Button
            variant="secondary"
            disabled={!assignee}
            onClick={() => {
              if (!assignee) return;
              void startAcpOnTask(task.id, comment.trim() || description.trim() || task.title, assignee).then(
                async () => {
                  setNotice("已经交给智能体，进度会写回这件事。");
                  setComment("");
                  await qc.invalidateQueries();
                },
              );
            }}
          >
            <Play data-icon="inline-start" />
            指派并开始
          </Button>
          {latest?.status === "running" ? (
            <Button
              variant="destructive"
              onClick={() => {
                void submit({ type: "CancelRun", run_id: latest.id }).then(async () => {
                  setNotice("这一轮已停止。改指派或改状态不会自动停跑，要停就点这里。");
                  await qc.invalidateQueries();
                });
              }}
            >
              <Square data-icon="inline-start" />
              停止
            </Button>
          ) : null}
          <Button variant="secondary" disabled={!workPath} onClick={() => workPath && window.coordy.revealFile(workPath)}>
            <FolderOpen data-icon="inline-start" />
            打开目录
          </Button>
          <Button variant="secondary" disabled={!workPath} onClick={() => workPath && window.coordy.openTerminal(workPath)}>
            <Terminal data-icon="inline-start" />
            打开终端
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>评论和执行记录</CardTitle>
          <CardDescription>
            成员和智能体的留言、动手记录都留在这里。在下面再说一句，智能体会接着看，不会改指派。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有记录。指派智能体或写一条评论就会出现。</p>
          ) : (
            activity.map((event) => {
              const line = formatActivity(event);
              return (
                <div key={`${event.runId}-${event.seq}`} className="rounded-lg border border-border px-3 py-2">
                  <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{line.label}</Badge>
                    {event.runStatus ? <span>{runStatusLabel(event.runStatus)}</span> : null}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{line.body}</p>
                </div>
              );
            })
          )}
        </CardContent>
        <CardFooter>
          <form
            className="flex w-full flex-col gap-2"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              const text = comment.trim();
              if (!text) return;
              void startAcpOnTask(task.id, text, assignee || undefined).then(async () => {
                setComment("");
                setNotice("评论已交给智能体。");
                await qc.invalidateQueries();
              });
            }}
          >
            <Textarea
              rows={3}
              placeholder="补充要求、提问，或让智能体接着做"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
            <Button type="submit" className="w-fit" disabled={!comment.trim()}>
              发送
            </Button>
          </form>
        </CardFooter>
      </Card>

      <p className="text-xs text-muted-foreground">当前状态：{taskStatusLabel(task.status)}</p>
    </section>
  );
}
