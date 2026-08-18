import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@coordy/ui";
import { FolderOpen, Play, Square, Terminal } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import { taskIdentifier } from "../lib/coordy/issues";
import {
  agentDisplayName,
  listableAgents,
  runStatusLabel,
  TASK_STATUS_ITEMS,
  taskStatusLabel,
} from "../lib/coordy/labels";
import { startAcpOnTask } from "../lib/coordy/start-task";
import { asAgents, asRunDetail, asRuns, asTasks, latestRunForTask } from "../lib/coordy/views";
import { useSession } from "../state/session-store";
import { useTabTitle } from "../shell/use-tab-title";
import { ActivityLine } from "./activity-marker";
import { NamedWithLogo } from "./provider-logo";
import { StatusGlyph } from "./issue-status";

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
  useTabTitle(task ? `${taskIdentifier(task.id)} ${task.title}` : undefined);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? "");
  }, [task?.id, task?.title, task?.description]);

  const save = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error("找不到这件事");
      const nextTitle = title.trim() || task.title;
      await submit({
        type: "UpdateTask",
        task_id: task.id,
        title: nextTitle,
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
      <section className="flex h-full flex-col items-start gap-3 p-6">
        <h1 className="text-lg font-semibold">找不到这件事</h1>
        <p className="text-sm text-muted-foreground">它可能已经被移走了。</p>
        <Button variant="secondary" onClick={() => navigate("/board")}>
          回到任务
        </Button>
      </section>
    );
  }
  if (!task) return null;

  const assignee = task.assignee_agent_id || agentList[0]?.id || "";
  const agentItems = Object.fromEntries(
    agentList.map((agent) => [agent.id, agentDisplayName(agent, catalog.data)]),
  );
  const persist = () => {
    if (title.trim() !== task.title || description !== (task.description ?? "")) {
      save.mutate();
    }
  };

  return (
    <section className="flex h-full min-h-0 min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-6 pt-4 text-xs text-muted-foreground">
          <StatusGlyph status={task.status} />
          <span className="font-mono">{taskIdentifier(task.id)}</span>
          <span>{taskStatusLabel(task.status)}</span>
        </div>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={persist}
          className="h-auto border-0 px-6 py-3 text-2xl font-semibold shadow-none focus-visible:ring-0 md:text-2xl"
        />
        <Textarea
          rows={8}
          placeholder="添加说明…"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={persist}
          className="min-h-[8rem] resize-none rounded-none border-0 px-6 shadow-none focus-visible:ring-0"
        />
        {notice ? <p className="px-6 text-sm text-muted-foreground">{notice}</p> : null}
        {task.blocked_reason ? <p className="px-6 text-sm text-destructive">{task.blocked_reason}</p> : null}
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-6 py-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">活动</h2>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有记录。指派智能体或写一条评论就会出现。</p>
          ) : (
            activity.map((event) => (
              <div key={`${event.runId}-${event.seq}`} className="border-b border-border/70 pb-3 last:border-0">
                <ActivityLine event={event} />
              </div>
            ))
          )}
        </div>
        <form
          className="flex shrink-0 flex-col gap-2 border-t border-border p-4"
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
            placeholder="留言，或让智能体接着做"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <Button type="submit" className="w-fit" disabled={!comment.trim()}>
            发送
          </Button>
        </form>
      </div>
      <aside className="flex w-[min(100%,18rem)] shrink-0 flex-col gap-5 overflow-auto border-l border-border p-4">
        <div>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">属性</h2>
          <div className="space-y-3">
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
                  <SelectValue>
                    {(value: string | null) => (
                      <span className="flex items-center gap-2">
                        <StatusGlyph status={value || task.status} />
                        {taskStatusLabel(value || task.status)}
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TASK_STATUS_ITEMS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      <span className="flex items-center gap-2">
                        <StatusGlyph status={value} />
                        {label}
                      </span>
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
                  <SelectValue>
                    {(value: string | null) => {
                      const agent = agentList.find((item) => item.id === value);
                      if (!agent) return "未指派";
                      return (
                        <NamedWithLogo provider={agent.harness}>
                          {agentDisplayName(agent, catalog.data)}
                        </NamedWithLogo>
                      );
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {agentList.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      <NamedWithLogo provider={agent.harness}>
                        {agentDisplayName(agent, catalog.data)}
                      </NamedWithLogo>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>运行</Label>
              <p className="text-sm text-muted-foreground">
                {latest ? runStatusLabel(latest.status) : "还没开始"}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Button
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
        </div>
      </aside>
    </section>
  );
}
