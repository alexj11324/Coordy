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
import { FolderOpen, Paperclip, Play, Square, Terminal } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import { pickedFilesFromList } from "../lib/coordy/files";
import { PRIORITY_ITEMS, blockerWaitMessage, hasUnresolvedBlockers, taskIdentifier } from "../lib/coordy/issues";
import {
  agentDisplayName,
  listableAgents,
  runStatusLabel,
  TASK_STATUS_ITEMS,
  taskStatusLabel,
} from "../lib/coordy/labels";
import { insertAgentMention, mentionsFromBody } from "../lib/coordy/mentions";
import { startAcpOnTask } from "../lib/coordy/start-task";
import {
  asAgents,
  asComments,
  asLabels,
  asPrincipals,
  asProjects,
  asRunDetail,
  asRuns,
  asSquads,
  asTasks,
  latestRunForTask,
  outcomeId,
} from "../lib/coordy/views";
import { useSession } from "../state/session-store";
import { useTabTitle } from "../shell/use-tab-title";
import { ActivityLine } from "./activity-marker";
import { NamedAgent } from "./agent-avatar";
import { StatusGlyph } from "./issue-status";

export function TaskDetailPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const workspaceId = useSession((s) => s.workspaceId);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
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
  const commentsQuery = useQuery({
    queryKey: ["view", { type: "Comments", task_id: taskId }, taskId],
    enabled: Boolean(taskId),
    queryFn: () => view({ type: "Comments", task_id: taskId! }),
  });
  const projects = useQuery({
    queryKey: ["view", { type: "Projects", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Projects", workspace_id: workspaceId! }),
  });
  const squads = useQuery({
    queryKey: ["view", { type: "Squads", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Squads", workspace_id: workspaceId! }),
  });
  const principals = useQuery({
    queryKey: ["view", { type: "Principals", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Principals", workspace_id: workspaceId! }),
  });
  const labelsQuery = useQuery({
    queryKey: ["view", { type: "Labels", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Labels", workspace_id: workspaceId! }),
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
  const tasks = asTasks(board.data);
  const task = tasks.find((item) => item.id === taskId);
  const children = tasks.filter((item) => item.parent_id === taskId);
  const agentList = listableAgents(asAgents(agents.data));
  const projectList = asProjects(projects.data);
  const squadList = asSquads(squads.data);
  const people = asPrincipals(principals.data);
  const workspaceLabels = asLabels(labelsQuery.data);
  const comments = asComments(commentsQuery.data);
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
  const [composer, setComposer] = useState("");
  const [mode, setMode] = useState<"comment" | "run">("comment");
  const [notice, setNotice] = useState<string | null>(null);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [suggestedTitles, setSuggestedTitles] = useState<string[]>([]);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [blockerPick, setBlockerPick] = useState("none");
  const repoPath = settings.data?.type === "Settings" ? settings.data.repo_path : null;
  const workPath = task?.worktree_path || repoPath;
  useTabTitle(task ? `${taskIdentifier(task)} ${task.title}` : undefined);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? "");
  }, [task?.id, task?.title, task?.description]);

  const save = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error("未找到该事项");
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
        <h1 className="text-lg font-semibold">未找到该事项</h1>
        <p className="text-sm text-muted-foreground">该事项可能已被删除或移出当前工作区。</p>
        <Button variant="secondary" onClick={() => navigate("/board")}>
          回到任务
        </Button>
      </section>
    );
  }
  if (!task) return null;

  const assignee = task.assignee_agent_id || "";
  const agentItems = Object.fromEntries([
    ["none", "未指派"],
    ...agentList.map((agent) => [agent.id, agentDisplayName(agent, catalog.data)]),
  ]);
  const projectItems = Object.fromEntries([["none", "无项目"], ...projectList.map((project) => [project.id, project.name])]);
  const squadItems = Object.fromEntries([["none", "未指派"], ...squadList.map((squad) => [squad.id, squad.name])]);
  const peopleItems = Object.fromEntries([["none", "未指派"], ...people.map((person) => [person.id, person.name])]);
  const blockers = (task.blocker_ids ?? [])
    .map((id) => tasks.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const blockerCandidates = tasks.filter(
    (item) => item.id !== task.id && !(task.blocker_ids ?? []).includes(item.id),
  );
  const blockerItems = Object.fromEntries([
    ["none", "选择前置事项"],
    ...blockerCandidates.map((item) => [item.id, `${taskIdentifier(item)} ${item.title}`]),
  ]);
  const waitingMessage = blockerWaitMessage(task, tasks);
  const heldByBlockers = hasUnresolvedBlockers(task);
  const persist = () => {
    if (title.trim() !== task.title || description !== (task.description ?? "")) {
      save.mutate();
    }
  };

  const refresh = () => qc.invalidateQueries();

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = composer.trim();
    if (!text) return;
    setNotice(null);
    try {
      if (mode === "comment") {
        const mentions = mentionsFromBody(text);
        await submit({ type: "AddComment", task_id: task.id, body: text, mentions });
        for (const mention of mentions) {
          if (mention.kind === "agent") {
            await submit({ type: "StartMentionRun", task_id: task.id, agent_id: mention.id, prompt: text });
          }
        }
        setComposer("");
        setMentionOpen(false);
        setNotice(
          mentions.some((item) => item.kind === "agent")
            ? "已发表评论，并通知被 @ 的智能体。负责人未改。"
            : "已发表评论。",
        );
      } else {
        await startAcpOnTask(task.id, text, assignee || undefined);
        setComposer("");
        setNotice("已让负责人继续执行。");
      }
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const addSubtask = async (titleText: string) => {
    if (!workspaceId || !titleText.trim()) return;
    const created = await submit({
      type: "CreateTask",
      workspace_id: workspaceId,
      title: titleText.trim(),
    });
    const childId = outcomeId(created.ids, "task_id");
    if (childId) {
      await submit({
        type: "AssignIssue",
        task_id: childId,
        parent_id: task.id,
        project_id: task.project_id ?? null,
      });
    }
    setSubtaskTitle("");
    setSuggestedTitles((current) => current.filter((item) => item !== titleText));
    await refresh();
  };

  const suggestSplit = async () => {
    setSuggestBusy(true);
    setNotice(null);
    try {
      const secrets = await window.coordy.secretsStatus();
      if (!secrets.key_configured) {
        setNotice("未配置模型密钥。请在设置 → 模型密钥中填写后再使用建议拆分。");
        return;
      }
      const draft = await window.coordy.completeDraft(
        "subtasks",
        `把下面的事项拆成 2 到 5 个可独立执行的子事项标题。\n标题：${task.title}\n正文：${task.description ?? ""}`,
      );
      const titles = (draft.titles ?? []).filter(Boolean);
      setSuggestedTitles(titles);
      setNotice(titles.length ? "已生成拆分建议，确认后再创建。" : "模型没有返回可用标题。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSuggestBusy(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-6 pt-4 text-xs text-muted-foreground">
          <StatusGlyph status={task.status} />
          <span className="font-mono">{taskIdentifier(task)}</span>
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
        {waitingMessage ? <p className="px-6 text-sm text-destructive">{waitingMessage}</p> : null}
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-6 py-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">时间线</h2>
          {comments.length === 0 && activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无评论或执行记录。发表评论不会改负责人；继续执行才会派发给当前负责人。</p>
          ) : null}
          {comments.map((comment) => (
            <div key={comment.id} className="border-b border-border/70 pb-3 last:border-0">
              <p className="text-[11px] text-muted-foreground">
                评论 · {people.find((person) => person.id === comment.author_id)?.name ?? comment.author_id.slice(0, 8)}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
            </div>
          ))}
          {activity.map((event) => (
            <div key={`${event.runId}-${event.seq}`} className="border-b border-border/70 pb-3 last:border-0">
              <ActivityLine event={event} />
            </div>
          ))}
          {runList.map((run) =>
            run.status === "failed" || run.status === "cancelled" ? (
              <div key={`retry-${run.id}`} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  {agentList.find((agent) => agent.id === run.agent_id)?.name ?? run.agent_id.slice(0, 8)}
                  · {runStatusLabel(run.status)} · {run.trigger ?? "run"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void submit({ type: "RetryRun", run_id: run.id })
                      .then(async () => {
                        setNotice("已按原指令重试。");
                        await refresh();
                      })
                      .catch((error: unknown) => {
                        setNotice(error instanceof Error ? error.message : String(error));
                      });
                  }}
                >
                  重试
                </Button>
              </div>
            ) : null,
          )}
        </div>
        <form className="flex shrink-0 flex-col gap-2 border-t border-border p-4" onSubmit={(event) => void send(event)}>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={mode === "comment" ? "default" : "ghost"} onClick={() => setMode("comment")}>
              评论
            </Button>
            <Button type="button" size="sm" variant={mode === "run" ? "default" : "ghost"} onClick={() => setMode("run")}>
              让负责人继续执行
            </Button>
          </div>
          {heldByBlockers && mode === "run" ? (
            <p className="text-xs text-muted-foreground">前置事项完成前不能开始执行。</p>
          ) : null}
          <Textarea
            rows={3}
            placeholder={mode === "comment" ? "写评论。输入 @ 可提及智能体，不会改负责人。" : "补充指令，让当前负责人继续执行。"}
            value={composer}
            onChange={(event) => {
              const value = event.target.value;
              setComposer(value);
              const cursor = event.target.selectionStart ?? value.length;
              setMentionOpen(mode === "comment" && value.slice(0, cursor).endsWith("@"));
            }}
          />
          {mentionOpen ? (
            <div className="flex flex-wrap gap-2">
              {agentList.map((agent) => (
                <Button
                  key={agent.id}
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setComposer((current) => {
                      const trimmed = current.endsWith("@") ? current.slice(0, -1) : current;
                      return insertAgentMention(trimmed, agent.id);
                    });
                    setMentionOpen(false);
                  }}
                >
                  @{agentDisplayName(agent, catalog.data)}
                </Button>
              ))}
            </div>
          ) : null}
          <Button type="submit" className="w-fit" disabled={!composer.trim() || (mode === "run" && heldByBlockers)}>
            {mode === "comment" ? "发表评论" : latest?.status === "running" ? "追加执行" : "开始执行"}
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
                  void submit({ type: "SetTaskStatus", task_id: task.id, status: value })
                    .then(refresh)
                    .catch((error: unknown) => {
                      setNotice(error instanceof Error ? error.message : String(error));
                    });
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
              <Label>优先级</Label>
              <Select
                value={task.priority || "none"}
                items={PRIORITY_ITEMS}
                onValueChange={(value) => {
                  if (!value) return;
                  void submit({ type: "UpdateTask", task_id: task.id, priority: value }).then(refresh);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_ITEMS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>截止日期</Label>
              <Input
                type="date"
                value={task.due_date?.slice(0, 10) ?? ""}
                onChange={(event) => {
                  void submit({
                    type: "UpdateTask",
                    task_id: task.id,
                    due_date: event.target.value,
                  }).then(refresh);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>项目</Label>
              <Select
                value={task.project_id || "none"}
                items={projectItems}
                onValueChange={(value) => {
                  if (!value) return;
                  void submit({
                    type: "AssignIssue",
                    task_id: task.id,
                    project_id: value === "none" ? "" : value,
                  }).then(refresh);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">无项目</SelectItem>
                  {projectList.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>标签</Label>
              <Select
                value={task.labels?.[0] ?? "none"}
                items={Object.fromEntries([["none", "无"], ...workspaceLabels.map((label) => [label.name, label.name])])}
                onValueChange={(value) => {
                  if (!value) return;
                  void submit({
                    type: "UpdateTask",
                    task_id: task.id,
                    labels: value === "none" ? [] : [value],
                  }).then(refresh);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">无</SelectItem>
                  {workspaceLabels.map((label) => (
                    <SelectItem key={label.name} value={label.name}>
                      {label.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>指派给</Label>
              <Select
                value={assignee || "none"}
                items={agentItems}
                onValueChange={(value) => {
                  if (!value) return;
                  if (value === "none") {
                    void submit({ type: "AssignIssue", task_id: task.id, agent_id: "" }).then(refresh);
                    return;
                  }
                  void submit({ type: "AssignTask", task_id: task.id, agent_id: value }).then(refresh);
                }}
              >
                <SelectTrigger>
                  <SelectValue>
                    {(value: string | null) => {
                      const agent = agentList.find((item) => item.id === value);
                      if (!agent) return "未指派";
                      return <NamedAgent agent={agent} catalog={catalog.data} />;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未指派</SelectItem>
                  {agentList.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      <NamedAgent agent={agent} catalog={catalog.data} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>成员</Label>
              <Select
                value={task.assignee_principal_id || "none"}
                items={peopleItems}
                onValueChange={(value) => {
                  if (!value) return;
                  void submit({
                    type: "AssignIssue",
                    task_id: task.id,
                    principal_id: value === "none" ? "" : value,
                  }).then(refresh);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未指派</SelectItem>
                  {people.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>小队</Label>
              <Select
                value={task.assignee_squad_id || "none"}
                items={squadItems}
                onValueChange={(value) => {
                  if (!value) return;
                  void submit({
                    type: "AssignIssue",
                    task_id: task.id,
                    squad_id: value === "none" ? "" : value,
                  }).then(async () => {
                    if (value !== "none" && task.status !== "backlog") {
                      setNotice("已指派小队，并向领队启动运行。");
                    }
                    await refresh();
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未指派</SelectItem>
                  {squadList.map((squad) => (
                    <SelectItem key={squad.id} value={squad.id}>
                      {squad.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>运行</Label>
              <p className="text-sm text-muted-foreground">{latest ? runStatusLabel(latest.status) : "尚未启动"}</p>
            </div>
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">前置事项</h2>
          <p className="mb-2 text-xs text-muted-foreground">这些事项完成后，才能开始或完成当前事项。</p>
          {blockers.length === 0 ? <p className="text-sm text-muted-foreground">尚未设置前置事项。</p> : null}
          {blockers.map((blocker) => (
            <div key={blocker.id} className="flex items-center justify-between gap-2 py-1">
              <Link to={`/board/${blocker.id}`} className="min-w-0 truncate text-sm hover:underline">
                {taskIdentifier(blocker)} {blocker.title}
                <span className="ml-2 text-xs text-muted-foreground">{taskStatusLabel(blocker.status)}</span>
              </Link>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void submit({ type: "RemoveIssueBlocker", task_id: task.id, blocker_id: blocker.id })
                    .then(refresh)
                    .catch((error: unknown) => {
                      setNotice(error instanceof Error ? error.message : String(error));
                    });
                }}
              >
                移除
              </Button>
            </div>
          ))}
          {blockerCandidates.length > 0 ? (
            <Select
              value={blockerPick}
              items={blockerItems}
              onValueChange={(value) => {
                if (!value || value === "none") {
                  setBlockerPick("none");
                  return;
                }
                setBlockerPick("none");
                void submit({ type: "AddIssueBlocker", task_id: task.id, blocker_id: value })
                  .then(refresh)
                  .catch((error: unknown) => {
                    setNotice(error instanceof Error ? error.message : String(error));
                  });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">选择前置事项</SelectItem>
                {blockerCandidates.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {taskIdentifier(item)} {item.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">子事项</h2>
            <Button size="sm" variant="ghost" disabled={suggestBusy} onClick={() => void suggestSplit()}>
              {suggestBusy ? "正在建议…" : "建议拆分"}
            </Button>
          </div>
          {children.length === 0 && suggestedTitles.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚无子事项。</p>
          ) : null}
          {children.map((child) => (
            <Link key={child.id} to={`/board/${child.id}`} className="block py-1 text-sm hover:underline">
              {taskIdentifier(child)} {child.title}
            </Link>
          ))}
          {suggestedTitles.map((item) => (
            <div key={item} className="flex items-center justify-between gap-2 py-1">
              <span className="text-sm">{item}</span>
              <Button size="sm" variant="ghost" onClick={() => void addSubtask(item)}>
                创建
              </Button>
            </div>
          ))}
          <form
            className="mt-2 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void addSubtask(subtaskTitle);
            }}
          >
            <Input value={subtaskTitle} placeholder="新子事项标题" onChange={(event) => setSubtaskTitle(event.target.value)} />
            <Button type="submit" size="sm" disabled={!subtaskTitle.trim()}>
              添加
            </Button>
          </form>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">附件</h2>
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
              <Paperclip data-icon="inline-start" />
              添加
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = pickedFilesFromList(event.target.files);
              event.target.value = "";
              void (async () => {
                for (const file of files) {
                  await submit({ type: "AddAttachment", task_id: task.id, name: file.name, path: file.path });
                }
                await refresh();
              })();
            }}
          />
          {(task.attachments ?? []).length === 0 ? <p className="text-sm text-muted-foreground">没有附件。</p> : null}
          {(task.attachments ?? []).map((file) => (
            <div key={file.id} className="flex items-center justify-between gap-2 py-1 text-sm">
              <span className="truncate">{file.name}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void submit({ type: "RemoveAttachment", attachment_id: file.id }).then(refresh)}
              >
                删除
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <Button
            disabled={!assignee || heldByBlockers}
            onClick={() => {
              if (!assignee) return;
              void startAcpOnTask(task.id, composer.trim() || description.trim() || task.title, assignee).then(
                async () => {
                  setNotice("已派发给智能体，进度将写回该事项。");
                  setComposer("");
                  await refresh();
                },
              ).catch((error: unknown) => {
                setNotice(error instanceof Error ? error.message : String(error));
              });
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
                  setNotice("本次运行已停止。更改指派或状态不会自动停止运行；停止须使用此按钮。");
                  await refresh();
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
          {confirmDelete ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  void submit({ type: "DeleteTask", task_id: task.id }).then(() => navigate("/board"));
                }}
              >
                确认删除
              </Button>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              删除事项
            </Button>
          )}
        </div>
      </aside>
    </section>
  );
}
