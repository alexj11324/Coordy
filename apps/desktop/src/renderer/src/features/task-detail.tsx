import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  cn,
} from "@coordy/ui";
import {
  ArrowUp,
  CalendarDays,
  ChevronRight,
  Copy,
  FolderKanban,
  FolderOpen,
  MoreHorizontal,
  Paperclip,
  Play,
  Plus,
  Square,
  Tag,
  Terminal,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import { pickedFilesFromList } from "../lib/coordy/files";
import { PRIORITY_ITEMS, blockerWaitMessage, hasUnresolvedBlockers, taskIdentifier } from "../lib/coordy/issues";
import { agentDisplayName, listableAgents, runStatusLabel, TASK_STATUS_ITEMS } from "../lib/coordy/labels";
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
  asWorkspaces,
  latestRunForTask,
  outcomeId,
} from "../lib/coordy/views";
import { useSession } from "../state/session-store";
import { useTabTitle } from "../shell/use-tab-title";
import { ActivityLine } from "./activity-marker";
import { AgentAvatar, NamedAgent } from "./agent-avatar";
import { PriorityGlyph, StatusGlyph } from "./issue-status";

const uiText = "text-[13px] leading-5 md:text-[13px]";
const titleField =
  "h-auto w-full border-0 bg-transparent px-0 py-1 text-[24px] font-semibold leading-8 tracking-tight outline-none md:text-[24px]";
const bodyField =
  "w-full resize-none border-0 bg-transparent text-[15px] leading-6 outline-none placeholder:text-muted-foreground/80 md:text-[15px]";
const fieldTrigger =
  "h-8 w-full justify-start border-0 bg-transparent px-0 !text-[13px] shadow-none hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0 md:!text-[13px] [&>:last-child]:hidden [&_[data-slot=select-value]_svg]:hidden";

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
  const workspaces = useQuery({
    queryKey: ["view", { type: "Workspaces" }],
    queryFn: () => view({ type: "Workspaces" }),
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
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [suggestedTitles, setSuggestedTitles] = useState<string[]>([]);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [blockerPick, setBlockerPick] = useState("none");
  const repoPath = settings.data?.type === "Settings" ? settings.data.repo_path : null;
  const workPath = task?.worktree_path || repoPath;
  const workspaceName =
    asWorkspaces(workspaces.data).find((item) => item.id === workspaceId)?.name?.trim() || "coordy";
  useTabTitle(task ? `${taskIdentifier(task)} ${task.title}` : undefined);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? "");
  }, [task?.id, task?.title, task?.description]);

  useEffect(() => {
    setConfirmDelete(false);
  }, [task?.id]);

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
      <section className={cn("flex h-full flex-col items-start gap-3 p-6", uiText)}>
        <h1 className="text-[24px] font-semibold tracking-tight md:text-[24px]">未找到该事项</h1>
        <p className="text-muted-foreground">该事项可能已被删除或移出当前工作区。</p>
        <Button variant="secondary" onClick={() => navigate("/board")}>
          回到任务
        </Button>
      </section>
    );
  }
  if (!task) return null;

  const assignee = task.assignee_agent_id || "";
  const assignedAgent = agentList.find((item) => item.id === assignee);
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
    if (mode === "run" && heldByBlockers) {
      setNotice("前置事项完成前不能开始执行。");
      return;
    }
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
    setAddingSubtask(false);
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
      setAddingSubtask(true);
      setNotice(titles.length ? "已生成拆分建议，确认后再创建。" : "模型没有返回可用标题。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSuggestBusy(false);
    }
  };

  const startAssigned = () => {
    if (!assignee || heldByBlockers) return;
    void startAcpOnTask(task.id, composer.trim() || description.trim() || task.title, assignee)
      .then(async () => {
        setNotice("已派发给智能体，进度将写回该事项。");
        setComposer("");
        await refresh();
      })
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : String(error));
      });
  };

  const copyId = () => {
    const id = taskIdentifier(task);
    void navigator.clipboard.writeText(id).then(
      () => setNotice(`已复制 ${id}`),
      () => setNotice("无法写入剪贴板。"),
    );
  };

  const attachFiles = (list: FileList | null) => {
    const files = pickedFilesFromList(list);
    void (async () => {
      for (const file of files) {
        await submit({ type: "AddAttachment", task_id: task.id, name: file.name, path: file.path });
      }
      await refresh();
    })();
  };

  return (
    <section className={cn("flex h-full min-h-0 min-w-0 bg-background", uiText)}>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/80 px-5">
          <nav className="flex min-w-0 items-center gap-1 text-muted-foreground">
            <span className="truncate">{workspaceName}</span>
            <ChevronRight className="size-3.5 shrink-0 opacity-40" />
            <Link to="/board" className="hover:text-foreground">
              任务
            </Link>
            <ChevronRight className="size-3.5 shrink-0 opacity-40" />
            <span className="font-mono text-foreground">{taskIdentifier(task)}</span>
          </nav>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={!assignee || heldByBlockers}
              aria-label="指派并开始"
              onClick={startAssigned}
            >
              <Play />
            </Button>
            {latest?.status === "running" ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="停止"
                onClick={() => {
                  void submit({ type: "CancelRun", run_id: latest.id }).then(async () => {
                    setNotice("本次运行已停止。更改指派或状态不会自动停止运行；停止须使用此按钮。");
                    await refresh();
                  });
                }}
              >
                <Square />
              </Button>
            ) : null}
            <Button type="button" size="icon-sm" variant="ghost" aria-label="复制编号" onClick={copyId}>
              <Copy />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button type="button" size="icon-sm" variant="ghost" aria-label="更多" />}
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={cn("min-w-44", uiText)}>
                <DropdownMenuItem disabled={!workPath} onClick={() => workPath && window.coordy.revealFile(workPath)}>
                  <FolderOpen />
                  打开目录
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!workPath} onClick={() => workPath && window.coordy.openTerminal(workPath)}>
                  <Terminal />
                  打开终端
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                  删除事项
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {confirmDelete ? (
          <div className="flex shrink-0 items-center justify-end gap-3 border-b border-border/80 px-5 py-1.5">
            <span className="text-muted-foreground">删除该事项？此操作不可恢复。</span>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setConfirmDelete(false)}>
              取消
            </button>
            <button
              type="button"
              className="text-destructive hover:underline"
              onClick={() => {
                void submit({ type: "DeleteTask", task_id: task.id }).then(() => navigate("/board"));
              }}
            >
              确认删除
            </button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[46rem] px-8 pt-7 pb-4">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={persist}
              className={titleField}
            />
            <textarea
              rows={4}
              placeholder="添加说明…"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={persist}
              className={cn("mt-1 min-h-[4.5rem] px-0 py-1", bodyField)}
            />
            {notice ? <p className={cn("mt-2 text-muted-foreground", uiText)}>{notice}</p> : null}
            {waitingMessage ? <p className={cn("mt-2 text-destructive", uiText)}>{waitingMessage}</p> : null}

            <div className="mt-5">
              {children.map((child) => (
                <Link
                  key={child.id}
                  to={`/board/${child.id}`}
                  className={cn("flex h-8 items-center gap-2 rounded-md px-1 hover:bg-muted/60", uiText)}
                >
                  <StatusGlyph status={child.status} />
                  <span className="w-[5.25rem] shrink-0 font-mono text-muted-foreground">
                    {taskIdentifier(child)}
                  </span>
                  <span className="min-w-0 truncate">{child.title}</span>
                </Link>
              ))}
              {suggestedTitles.map((item) => (
                <div key={item} className={cn("flex h-8 items-center justify-between gap-2 px-1", uiText)}>
                  <span className="truncate text-muted-foreground">{item}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => void addSubtask(item)}
                  >
                    创建
                  </button>
                </div>
              ))}
              {addingSubtask ? (
                <form
                  className="mt-1 flex items-center gap-2 px-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addSubtask(subtaskTitle);
                  }}
                >
                  <input
                    autoFocus
                    value={subtaskTitle}
                    placeholder="子事项标题"
                    className="h-8 w-full border-0 bg-transparent px-0 outline-none placeholder:text-muted-foreground"
                    onChange={(event) => setSubtaskTitle(event.target.value)}
                    onBlur={() => {
                      if (!subtaskTitle.trim()) setAddingSubtask(false);
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!subtaskTitle.trim()}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    添加
                  </button>
                </form>
              ) : (
                <div className="mt-1 flex items-center gap-3 px-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setAddingSubtask(true)}
                  >
                    <Plus className="size-3.5" />
                    添加子事项
                  </button>
                  <button
                    type="button"
                    disabled={suggestBusy}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                    onClick={() => void suggestSplit()}
                  >
                    {suggestBusy ? "正在建议…" : "建议拆分"}
                  </button>
                </div>
              )}
            </div>

            {(task.attachments ?? []).length > 0 ? (
              <ul className="mt-4 space-y-1">
                {(task.attachments ?? []).map((file) => (
                  <li key={file.id} className={cn("flex items-center gap-2 px-1", uiText)}>
                    <Paperclip className="size-3.5 text-muted-foreground" />
                    <span className="min-w-0 truncate">{file.name}</span>
                    <button
                      type="button"
                      className="ml-auto text-muted-foreground hover:text-foreground"
                      onClick={() => void submit({ type: "RemoveAttachment", attachment_id: file.id }).then(refresh)}
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="mx-auto w-full max-w-[46rem] px-8 pb-8">
            <Separator className="mb-4" />
            <h2 className={cn("mb-3 font-medium text-foreground", uiText)}>活动</h2>
            {comments.length === 0 && activity.length === 0 ? (
              <p className={cn("text-muted-foreground", uiText)}>
                暂无评论或执行记录。发表评论不会改负责人；继续执行才会派发给当前负责人。
              </p>
            ) : null}
            <div className="space-y-4">
              {comments.map((comment) => (
                <div key={comment.id}>
                  <p className={cn("text-muted-foreground", uiText)}>
                    <span className="text-foreground">
                      {people.find((person) => person.id === comment.author_id)?.name ?? comment.author_id.slice(0, 8)}
                    </span>
                    {" · "}
                    评论
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[15px] leading-6 md:text-[15px]">{comment.body}</p>
                </div>
              ))}
              {activity.map((event) => (
                <div key={`${event.runId}-${event.seq}`}>
                  <ActivityLine event={event} />
                </div>
              ))}
              {runList.map((run) =>
                run.status === "failed" || run.status === "cancelled" ? (
                  <div key={`retry-${run.id}`} className={cn("flex items-center justify-between gap-2", uiText)}>
                    <span className="text-muted-foreground">
                      {agentList.find((agent) => agent.id === run.agent_id)?.name ?? run.agent_id.slice(0, 8)}
                      · {runStatusLabel(run.status)} · {run.trigger ?? "run"}
                    </span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
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
                    </button>
                  </div>
                ) : null,
              )}
            </div>
          </div>
        </div>

        <form className="shrink-0 px-8 pb-5 pt-1" onSubmit={(event) => void send(event)}>
          <div className="mx-auto w-full max-w-[46rem] rounded-xl border border-border bg-background p-3 shadow-sm">
            <textarea
              rows={3}
              placeholder={mode === "comment" ? "写评论。输入 @ 可提及智能体，不会改负责人。" : "补充指令，让当前负责人继续执行。"}
              value={composer}
              onChange={(event) => {
                const value = event.target.value;
                setComposer(value);
                const cursor = event.target.selectionStart ?? value.length;
                setMentionOpen(mode === "comment" && value.slice(0, cursor).endsWith("@"));
              }}
              className={cn("min-h-[4.25rem] p-0.5", bodyField)}
            />
            {mentionOpen ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {agentList.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setComposer((current) => {
                        const trimmed = current.endsWith("@") ? current.slice(0, -1) : current;
                        return insertAgentMention(trimmed, agent.id);
                      });
                      setMentionOpen(false);
                    }}
                  >
                    @{agentDisplayName(agent, catalog.data)}
                  </button>
                ))}
              </div>
            ) : null}
            {heldByBlockers && mode === "run" ? (
              <p className={cn("mt-1 text-muted-foreground", uiText)}>前置事项完成前不能开始执行。</p>
            ) : null}
            <div className="mt-2 flex items-center gap-1">
              <ModeTab active={mode === "comment"} onClick={() => setMode("comment")}>
                评论
              </ModeTab>
              <ModeTab active={mode === "run"} onClick={() => setMode("run")}>
                继续执行
              </ModeTab>
              <div className="ml-auto flex items-center gap-0.5">
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    attachFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="添加附件"
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip />
                </Button>
                <Button
                  type="submit"
                  size="icon-sm"
                  variant={composer.trim() ? "default" : "ghost"}
                  disabled={!composer.trim() || (mode === "run" && heldByBlockers)}
                  aria-label={mode === "comment" ? "发表评论" : latest?.status === "running" ? "追加执行" : "开始执行"}
                >
                  <ArrowUp />
                </Button>
              </div>
            </div>
          </div>
        </form>
      </div>

      <aside className={cn("flex w-[17.5rem] shrink-0 flex-col gap-5 overflow-auto border-l border-border/80 px-3 py-4", uiText)}>
        <section>
          <h2 className="mb-1 px-1.5 font-medium text-muted-foreground">属性</h2>
          <div>
            <PropertyRow icon={<StatusGlyph status={task.status} className="size-4" />}>
              <Select
                value={task.status}
                items={TASK_STATUS_ITEMS}
                onValueChange={(value) => {
                  if (!value) return;
                  void submit({ type: "SetTaskStatus", task_id: task.id, status: value }).then(refresh);
                }}
              >
                <SelectTrigger className={fieldTrigger}>
                  <SelectValue>
                    {(value: string | null) => TASK_STATUS_ITEMS[value || task.status] ?? ""}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className={uiText}>
                  {Object.entries(TASK_STATUS_ITEMS).map(([value, label]) => (
                    <FieldItem key={value} value={value}>
                      <span className="flex items-center gap-2">
                        <StatusGlyph status={value} />
                        {label}
                      </span>
                    </FieldItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>
            <PropertyRow icon={<PriorityGlyph priority={task.priority} className="size-4" />}>
              <Select
                value={task.priority || "none"}
                items={PRIORITY_ITEMS}
                onValueChange={(value) => {
                  if (!value) return;
                  void submit({ type: "UpdateTask", task_id: task.id, priority: value }).then(refresh);
                }}
              >
                <SelectTrigger className={fieldTrigger}>
                  <SelectValue>
                    {(value: string | null) => optionLabel(PRIORITY_ITEMS, value || task.priority)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className={uiText}>
                  {Object.entries(PRIORITY_ITEMS).map(([value, label]) => (
                    <FieldItem key={value} value={value}>
                      <span className="flex items-center gap-2">
                        <PriorityGlyph priority={value} />
                        {label}
                      </span>
                    </FieldItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>
            <PropertyRow icon={<CalendarDays />}>
              <label className="relative flex h-8 cursor-pointer items-center">
                <span className={task.due_date ? "text-foreground" : "text-muted-foreground"}>
                  {task.due_date?.slice(0, 10) || "截止日期"}
                </span>
                <input
                  type="date"
                  value={task.due_date?.slice(0, 10) ?? ""}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(event) => {
                    void submit({
                      type: "UpdateTask",
                      task_id: task.id,
                      due_date: event.target.value,
                    }).then(refresh);
                  }}
                />
              </label>
            </PropertyRow>
            <PropertyRow icon={<FolderKanban />}>
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
                <SelectTrigger className={fieldTrigger}>
                  <SelectValue>
                    {(value: string | null) => optionLabel(projectItems, value || task.project_id)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className={uiText}>
                  <FieldItem value="none">无项目</FieldItem>
                  {projectList.map((project) => (
                    <FieldItem key={project.id} value={project.id}>
                      {project.name}
                    </FieldItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>
            <PropertyRow icon={<Tag />}>
              <Select
                value={task.labels?.[0] ?? "none"}
                items={Object.fromEntries([["none", "无标签"], ...workspaceLabels.map((label) => [label.name, label.name])])}
                onValueChange={(value) => {
                  if (!value) return;
                  void submit({
                    type: "UpdateTask",
                    task_id: task.id,
                    labels: value === "none" ? [] : [value],
                  }).then(refresh);
                }}
              >
                <SelectTrigger className={fieldTrigger}>
                  <SelectValue>
                    {(value: string | null) => {
                      const name = value && value !== "none" ? value : task.labels?.[0];
                      return name ? name : <span className="text-muted-foreground">无标签</span>;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className={uiText}>
                  <FieldItem value="none">无标签</FieldItem>
                  {workspaceLabels.map((label) => (
                    <FieldItem key={label.name} value={label.name}>
                      {label.name}
                    </FieldItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>
            <PropertyRow
              icon={
                assignedAgent ? (
                  <AgentAvatar agent={assignedAgent} className="size-4" />
                ) : (
                  <UserRound />
                )
              }
            >
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
                <SelectTrigger className={fieldTrigger}>
                  <SelectValue>
                    {(value: string | null) => optionLabel(agentItems, value || assignee)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className={uiText}>
                  <FieldItem value="none">未指派</FieldItem>
                  {agentList.map((agent) => (
                    <FieldItem key={agent.id} value={agent.id}>
                      <NamedAgent agent={agent} catalog={catalog.data} avatarClassName="size-4" />
                    </FieldItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>
            <PropertyRow icon={<UserRound />}>
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
                <SelectTrigger className={fieldTrigger}>
                  <SelectValue>
                    {(value: string | null) => optionLabel(peopleItems, value || task.assignee_principal_id)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className={uiText}>
                  <FieldItem value="none">未指派</FieldItem>
                  {people.map((person) => (
                    <FieldItem key={person.id} value={person.id}>
                      {person.name}
                    </FieldItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>
            <PropertyRow icon={<Users />}>
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
                <SelectTrigger className={fieldTrigger}>
                  <SelectValue>
                    {(value: string | null) => optionLabel(squadItems, value || task.assignee_squad_id)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className={uiText}>
                  <FieldItem value="none">未指派</FieldItem>
                  {squadList.map((squad) => (
                    <FieldItem key={squad.id} value={squad.id}>
                      {squad.name}
                    </FieldItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>
            <PropertyRow icon={<Play />}>
              <p className="text-muted-foreground">{latest ? runStatusLabel(latest.status) : "尚未启动"}</p>
            </PropertyRow>
          </div>
        </section>

        <section>
          <h2 className="mb-1 px-1.5 font-medium text-muted-foreground">前置事项</h2>
          <p className={cn("mb-2 px-1.5 text-muted-foreground", uiText)}>
            这些事项完成后，当前事项才能开始或完成。若已指派负责人，前置一解除就会自动开跑。
          </p>
          {blockers.length === 0 ? (
            <p className="px-1.5 text-muted-foreground">尚未设置。</p>
          ) : null}
          {blockers.map((blocker) => (
            <div key={blocker.id} className="flex h-8 items-center gap-2 rounded-md px-1.5 hover:bg-muted/60">
              <StatusGlyph status={blocker.status} className="size-4" />
              <Link to={`/board/${blocker.id}`} className="min-w-0 flex-1 truncate">
                <span className="font-mono text-muted-foreground">{taskIdentifier(blocker)}</span> {blocker.title}
              </Link>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  void submit({ type: "RemoveIssueBlocker", task_id: task.id, blocker_id: blocker.id })
                    .then(refresh)
                    .catch((error: unknown) => {
                      setNotice(error instanceof Error ? error.message : String(error));
                    });
                }}
              >
                移除
              </button>
            </div>
          ))}
          {blockerCandidates.length > 0 ? (
            <PropertyRow icon={<Plus />}>
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
                <SelectTrigger className={cn(fieldTrigger, "text-muted-foreground")}>
                  <SelectValue>
                    {() => <span className="text-muted-foreground">选择前置事项</span>}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className={uiText}>
                  <FieldItem value="none">选择前置事项</FieldItem>
                  {blockerCandidates.map((item) => (
                    <FieldItem key={item.id} value={item.id}>
                      {taskIdentifier(item)} {item.title}
                    </FieldItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>
          ) : null}
        </section>
      </aside>
    </section>
  );
}

function optionLabel(items: Record<string, string>, value: string | null | undefined, empty = "none") {
  const key = !value || value === empty ? empty : value;
  return <span className={cn("truncate", key === empty && "text-muted-foreground")}>{items[key] ?? ""}</span>;
}

function FieldItem({ className, ...props }: ComponentProps<typeof SelectItem>) {
  return <SelectItem className={cn("text-[13px] md:text-[13px]", className)} {...props} />;
}

function PropertyRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-2 rounded-md px-1.5 text-[13px] md:text-[13px] hover:bg-muted/60">
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function ModeTab({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[13px] md:text-[13px] transition-colors",
        active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
