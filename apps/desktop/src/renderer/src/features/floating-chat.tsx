import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  cn,
} from "@coordy/ui";
import { Archive, ChevronDown, Maximize2, MessageCircle, Minimize2, Minus, Plus, SendHorizonal, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { chatTimeline } from "../lib/coordy/activity";
import { submit, view } from "../lib/coordy/client";
import { agentDisplayName, listableAgents } from "../lib/coordy/labels";
import { startChatTurn } from "../lib/coordy/start-task";
import { asAgents, asChatDetail, asChats, asProjects, asRunDetail, asRuns, asSquads, asTasks, latestRunForTask, outcomeId } from "../lib/coordy/views";
import { useLayoutStore } from "../state/layout-store";
import { useSession } from "../state/session-store";
import { ActivityLine } from "./activity-marker";
import { AgentAvatar } from "./agent-avatar";
import { TaskPlanCard } from "./task-plan-card";
import type { TaskPlanApplyMode, TaskPlanDraft } from "@coordy/protocol";
import { suppressStreamingTaskPlanJson, taskPlanApplyCommand, taskPlanRegenerationPrompt } from "../lib/coordy/task-plan";

const SUGGESTIONS = [
  "按优先级列出未完成任务",
  "汇总今日已完成事项",
  "规划后续工作",
];

export function FloatingChat() {
  const dock = useLayoutStore((s) => s.chatDock);
  const expanded = useLayoutStore((s) => s.chatExpanded);
  const activeChatId = useLayoutStore((s) => s.activeChatId);
  const workspaceId = useSession((s) => s.workspaceId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const open = dock === "open";
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [planResult, setPlanResult] = useState<{ parentTaskId: string; childCount: number; mode: TaskPlanApplyMode } | null>(null);

  const agents = useQuery({
    queryKey: ["view", { type: "Agents", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Agents", workspace_id: workspaceId! }),
  });
  const chats = useQuery({
    queryKey: ["view", { type: "Chats", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Chats", workspace_id: workspaceId! }),
  });
  const board = useQuery({
    queryKey: ["view", { type: "Board", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId) && open,
    queryFn: () => view({ type: "Board", workspace_id: workspaceId! }),
  });
  const projects = useQuery({
    queryKey: ["view", { type: "Projects", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId) && open,
    queryFn: () => view({ type: "Projects", workspace_id: workspaceId! }),
  });
  const squads = useQuery({
    queryKey: ["view", { type: "Squads", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId) && open,
    queryFn: () => view({ type: "Squads", workspace_id: workspaceId! }),
  });
  const agentList = listableAgents(asAgents(agents.data));
  const chatList = asChats(chats.data).filter((chat) => !chat.archived);
  const current = chatList.find((chat) => chat.id === activeChatId) ?? null;
  const chatId = current?.id ?? null;

  const detail = useQuery({
    queryKey: ["view", { type: "Chat", chat_id: chatId }, chatId],
    enabled: Boolean(chatId) && open,
    queryFn: () => view({ type: "Chat", chat_id: chatId! }),
    refetchInterval: open ? 1000 : false,
  });
  const runs = useQuery({
    queryKey: ["view", { type: "Runs", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId) && open,
    queryFn: () => view({ type: "Runs", workspace_id: workspaceId! }),
    refetchInterval: open ? 1000 : false,
  });
  const chatDetail = asChatDetail(detail.data);
  const agent = agentList.find((item) => item.id === current?.agent_id) ?? agentList[0];
  const runList = asRuns(runs.data);
  const latestRun = current?.task_id ? latestRunForTask(runList, current.task_id) : undefined;
  const runDetail = useQuery({
    queryKey: ["run", latestRun?.id],
    enabled: Boolean(latestRun?.id) && open,
    queryFn: () => view({ type: "Run", run_id: latestRun!.id }),
    refetchInterval: latestRun?.status === "running" ? 800 : false,
  });
  const runEvents = asRunDetail(runDetail.data)?.events ?? [];
  const displayedRunEvents = latestRun?.status === "running"
    ? suppressStreamingTaskPlanJson(runEvents)
    : runEvents;
  const agentName = agent ? agentDisplayName(agent) : "智能体";

  useEffect(() => {
    setPlanResult(null);
    setError(null);
  }, [chatId]);
  useEffect(() => {
    if (chatDetail?.taskPlan) setPlanResult(null);
  }, [chatDetail?.taskPlan?.id]);

  const timeline = useMemo(
    () => chatTimeline(chatDetail?.messages ?? [], displayedRunEvents, latestRun?.id),
    [chatDetail?.messages, displayedRunEvents, latestRun?.id],
  );

  const ensureChat = async () => {
    if (!workspaceId) throw new Error("工作区尚未就绪。");
    if (!agent) throw new Error("请先创建智能体后再开始聊天。");
    if (current) return current;
    const created = await submit({ type: "CreateChat", workspace_id: workspaceId, agent_id: agent.id });
    const id = outcomeId(created.ids, "chat_id");
    await qc.invalidateQueries();
    const next = asChats(await view({ type: "Chats", workspace_id: workspaceId })).find((item) => item.id === id);
    if (!next) throw new Error("未能创建对话");
    useLayoutStore.getState().setActiveChatId(next.id);
    return next;
  };

  const send = useMutation({
    mutationFn: async (text: string) => {
      const body = text.trim();
      if (!body) return;
      const chat = await ensureChat();
      await submit({ type: "SendChatMessage", chat_id: chat.id, body });
      if (chat.task_id && chat.agent_id) {
        await startChatTurn({
          chatId: chat.id,
          taskId: chat.task_id,
          agentId: chat.agent_id,
          prompt: body,
        });
      }
    },
    onSuccess: async () => {
      setDraft("");
      setError(null);
      await qc.invalidateQueries();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  const savePlanDraft = async (nextDraft: TaskPlanDraft) => {
    const proposal = chatDetail?.taskPlan;
    if (!proposal) throw new Error("当前对话没有可编辑的任务方案。");
    const outcome = await submit({
      type: "SaveTaskPlanProposal",
      proposal_id: proposal.id,
      expected_revision: proposal.revision,
      draft: nextDraft,
    });
    await qc.invalidateQueries();
    return Number(outcome.ids.revision);
  };

  const planAction = useMutation({
    mutationFn: async (input:
      | { type: "save"; draft: TaskPlanDraft }
      | { type: "regenerate"; draft: TaskPlanDraft }
      | { type: "apply"; draft: TaskPlanDraft; mode: TaskPlanApplyMode }) => {
      const proposal = chatDetail?.taskPlan;
      if (!proposal) throw new Error("当前对话没有可用的任务方案。");
      if (input.type === "save") {
        await savePlanDraft(input.draft);
        return null;
      }
      if (input.type === "regenerate") {
        // Regeneration always establishes a new persisted revision first,
        // even when the user did not edit the current draft. This makes the
        // revision history reflect the explicit regenerate action.
        const revision = await savePlanDraft(input.draft);
        await send.mutateAsync(taskPlanRegenerationPrompt(input.draft, revision));
        return null;
      }
      const revision = JSON.stringify(input.draft) === JSON.stringify(proposal.draft)
        ? proposal.revision
        : await savePlanDraft(input.draft);
      const applied = await submit(taskPlanApplyCommand(proposal.id, revision, input.mode));
      const parentTaskId = outcomeId(applied.ids, "parent_task_id");
      const childCount = Array.isArray(applied.ids.child_task_ids) ? applied.ids.child_task_ids.length : input.draft.children.length;
      await qc.invalidateQueries();
      return parentTaskId ? { parentTaskId, childCount, mode: input.mode } : null;
    },
    onSuccess: (result) => {
      setError(null);
      if (result) setPlanResult(result);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  const startNew = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("工作区尚未就绪。");
      if (!agent) throw new Error("请先创建智能体后再开始聊天。");
      const created = await submit({ type: "CreateChat", workspace_id: workspaceId, agent_id: agent.id });
      return outcomeId(created.ids, "chat_id");
    },
    onSuccess: async (id) => {
      useLayoutStore.getState().setActiveChatId(id);
      setDraft("");
      await qc.invalidateQueries();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  if (typeof document === "undefined") return null;

  const fab = dock !== "open" ? (
    <button
      type="button"
      id="coordy-chat-fab"
      className="fixed right-5 bottom-5 z-[80] flex size-12 items-center justify-center rounded-full bg-background text-muted-foreground shadow-[0_8px_24px_rgba(15,23,42,0.12)] ring-1 ring-border transition-colors hover:bg-muted hover:text-foreground"
      aria-label="打开聊天"
      title="打开聊天"
      onClick={() => useLayoutStore.getState().openChatDock()}
    >
      <MessageCircle className="size-5" />
    </button>
  ) : null;

  const windowNode = open ? (
    <section
      id="coordy-chat-window"
      className={cn(
        "fixed z-[85] flex flex-col overflow-hidden rounded-xl bg-background shadow-[0_18px_50px_rgba(15,23,42,0.18)] ring-1 ring-border",
        expanded
          ? "inset-3"
          : "right-2 bottom-2 h-[min(36rem,calc(100vh-1rem))] w-[min(24rem,calc(100vw-1rem))]",
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="rounded-full text-muted-foreground"
            aria-label="新对话"
            title="新对话"
            onClick={() => startNew.mutate()}
          >
            <Plus />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" size="sm" variant="ghost" className="min-w-0 max-w-48 justify-start" />}>
              <span className="truncate">{current?.title?.trim() || "新对话"}</span>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-48">
              <DropdownMenuItem onClick={() => startNew.mutate()}>新对话</DropdownMenuItem>
              {chatList.length > 0 ? <DropdownMenuSeparator /> : null}
              {chatList.map((chat) => (
                <DropdownMenuItem key={chat.id} onClick={() => useLayoutStore.getState().setActiveChatId(chat.id)}>
                  {chat.title?.trim() || "对话"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex shrink-0 items-center">
          {current ? (
            <>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground"
                aria-label="停止当前运行"
                title="停止"
                onClick={() => {
                  void submit({ type: "StopChat", chat_id: current.id }).then(async () => {
                    await qc.invalidateQueries();
                  });
                }}
              >
                <Square />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground"
                aria-label="归档对话"
                title="归档"
                onClick={() => {
                  void submit({ type: "ArchiveChat", chat_id: current.id }).then(async () => {
                    useLayoutStore.getState().setActiveChatId(null);
                    await qc.invalidateQueries();
                  });
                }}
              >
                <Archive />
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-label={expanded ? "还原聊天窗" : "放大聊天窗"}
            title={expanded ? "还原" : "放大"}
            onClick={() => useLayoutStore.getState().toggleChatExpanded()}
          >
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-label="收起聊天"
            title="收起"
            onClick={() => useLayoutStore.getState().minimizeChatDock()}
          >
            <Minus />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 p-4">
          {!agent ? (
            <div className="space-y-2 text-sm">
              <p>工作区中暂无智能体，无法开始聊天。</p>
              <Button size="sm" onClick={() => navigate("/agents/new")}>
                新建智能体
              </Button>
            </div>
          ) : timeline.length === 0 ? (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">当前对话对象：{agentName}</p>
                <p className="text-sm text-muted-foreground">可发送如下指令</p>
              </div>
              <div className="flex flex-col items-start gap-2">
                {SUGGESTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="max-w-full rounded-full border border-border bg-background px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => send.mutate(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            timeline.map((item) =>
              item.type === "marker" ? (
                <ActivityLine key={item.id} event={item.event} />
              ) : (
                <div key={item.id} className="animate-in fade-in-0 fill-mode-both space-y-1 duration-300">
                  <p className="text-[11px] text-muted-foreground">{item.role === "user" ? "你" : agentName}</p>
                  <p className="whitespace-pre-wrap text-sm">{item.body}</p>
                </div>
              ),
            )
          )}
          {chatDetail?.taskPlan ? (
            <TaskPlanCard
              proposal={chatDetail.taskPlan}
              agents={agentList}
              squads={asSquads(squads.data)}
              projects={asProjects(projects.data)}
              tasks={asTasks(board.data)}
              busy={planAction.isPending || send.isPending}
              onSave={async (nextDraft) => { await planAction.mutateAsync({ type: "save", draft: nextDraft }); }}
              onRegenerate={async (nextDraft) => { await planAction.mutateAsync({ type: "regenerate", draft: nextDraft }); }}
              onApply={async (nextDraft, mode) => { await planAction.mutateAsync({ type: "apply", draft: nextDraft, mode }); }}
            />
          ) : null}
          {chatDetail?.taskPlanError ? <p className="text-sm text-destructive">{chatDetail.taskPlanError}</p> : null}
          {planResult ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-sm" role="status">
              <p className="font-medium">方案已创建</p>
              <p className="text-muted-foreground">已创建 {planResult.childCount} 个子事项；{planResult.mode === "confirm_and_start" ? "首批可执行事项已开始。" : "所有事项暂未开始。"}</p>
              <Button size="sm" onClick={() => {
                useLayoutStore.getState().minimizeChatDock();
                navigate(`/board/${planResult.parentTaskId}`);
              }}>查看父事项</Button>
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </div>
      <form
        className="flex shrink-0 items-center gap-1 border-t border-border p-2"
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate(draft);
        }}
      >
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground"
          aria-label="新对话"
          onClick={() => startNew.mutate()}
        >
          <Plus />
        </Button>
        <Input
          value={draft}
          placeholder={`给 ${agentName} 发消息...`}
          className="h-9 min-w-0 flex-1 border-0 shadow-none focus-visible:ring-0"
          disabled={!agent}
          onChange={(event) => setDraft(event.target.value)}
        />
        {agent ? <AgentAvatar agent={agent} className="size-6" /> : null}
        <Button type="submit" size="icon-sm" disabled={!agent || send.isPending || !draft.trim()} aria-label="发送">
          <SendHorizonal />
        </Button>
      </form>
    </section>
  ) : null;

  return createPortal(
    <>
      {fab}
      {windowNode}
    </>,
    document.body,
  );
}
