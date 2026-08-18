import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  ScrollArea,
} from "@coordy/ui";
import { ChevronDown, Maximize2, MessageSquare, Minus, Plus, SendHorizonal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import { agentDisplayName, formatActivity, listableAgents } from "../lib/coordy/labels";
import { startChatTurn } from "../lib/coordy/start-task";
import { asAgents, asChatDetail, asChats, asRunDetail, asRuns, latestRunForTask, outcomeId } from "../lib/coordy/views";
import { useLayoutStore } from "../state/layout-store";
import { useSession } from "../state/session-store";
import { useTabStore } from "../state/tab-store";

const SUGGESTIONS = [
  "按优先级列出我未完成的任务",
  "总结一下我今天做了什么",
  "规划接下来该做什么",
];

export function FloatingChat() {
  const dock = useLayoutStore((s) => s.chatDock);
  const activeChatId = useLayoutStore((s) => s.activeChatId);
  const workspaceId = useSession((s) => s.workspaceId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

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
  const agentList = listableAgents(asAgents(agents.data));
  const chatList = asChats(chats.data).filter((chat) => !chat.archived);
  const current = chatList.find((chat) => chat.id === activeChatId) ?? chatList[0] ?? null;
  const chatId = current?.id ?? null;

  const detail = useQuery({
    queryKey: ["view", { type: "Chat", chat_id: chatId }, chatId],
    enabled: Boolean(chatId),
    queryFn: () => view({ type: "Chat", chat_id: chatId! }),
    refetchInterval: dock === "open" ? 1000 : false,
  });
  const runs = useQuery({
    queryKey: ["view", { type: "Runs", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId) && dock === "open",
    queryFn: () => view({ type: "Runs", workspace_id: workspaceId! }),
    refetchInterval: dock === "open" ? 1000 : false,
  });
  const chatDetail = asChatDetail(detail.data);
  const agent = agentList.find((item) => item.id === current?.agent_id) ?? agentList[0];
  const runList = asRuns(runs.data);
  const latestRun = current?.task_id ? latestRunForTask(runList, current.task_id) : undefined;
  const runDetail = useQuery({
    queryKey: ["run", latestRun?.id],
    enabled: Boolean(latestRun?.id) && dock === "open",
    queryFn: () => view({ type: "Run", run_id: latestRun!.id }),
    refetchInterval: latestRun?.status === "running" ? 800 : false,
  });
  const runEvents = asRunDetail(runDetail.data)?.events ?? [];
  const agentName = agent ? agentDisplayName(agent) : "智能体";

  const messages = useMemo(() => {
    const stored = chatDetail?.messages ?? [];
    const extras = runEvents
      .filter((event) => event.kind === "message")
      .map((event) => {
        const parsed = formatActivity(event);
        return {
          id: `run-${latestRun?.id}-${event.seq}`,
          role: parsed.label === "你" ? "user" : "assistant",
          body: parsed.body,
        };
      });
    const seen = new Set(stored.map((item) => item.body));
    return [
      ...stored.map((item) => ({ id: item.id, role: item.role, body: item.body })),
      ...extras.filter((item) => !seen.has(item.body)),
    ];
  }, [chatDetail?.messages, latestRun?.id, runEvents]);

  const ensureChat = async () => {
    if (!workspaceId) throw new Error("还没准备好，请稍等一下");
    if (!agent) throw new Error("先新建一个智能体，才能聊天");
    if (current) return current;
    const created = await submit({ type: "CreateChat", workspace_id: workspaceId, agent_id: agent.id });
    const id = outcomeId(created.ids, "chat_id");
    await qc.invalidateQueries();
    const next = asChats(await view({ type: "Chats", workspace_id: workspaceId })).find((item) => item.id === id);
    if (!next) throw new Error("对话没有建起来");
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

  const startNew = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("还没准备好，请稍等一下");
      if (!agent) throw new Error("先新建一个智能体，才能聊天");
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

  const expand = () => {
    useTabStore.getState().ensure("/chat");
    navigate("/chat");
  };

  if (dock === "closed" || dock === "minimized") {
    return (
      <Button
        type="button"
        size="icon-lg"
        className="absolute right-5 bottom-5 z-20 rounded-full shadow-lg"
        aria-label="打开聊天"
        title="打开聊天"
        onClick={() => useLayoutStore.getState().openChatDock()}
      >
        <MessageSquare />
      </Button>
    );
  }

  return (
    <section className="absolute right-5 bottom-5 z-30 flex h-[min(32rem,calc(100%-3rem))] w-[min(24rem,calc(100%-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" size="sm" variant="ghost" className="min-w-0 flex-1 justify-start" />}>
            <Plus className="size-3.5" />
            <span className="truncate">{current?.title?.trim() || "新对话"}</span>
            <ChevronDown className="ml-auto size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            <DropdownMenuItem onClick={() => startNew.mutate()}>+ 新对话</DropdownMenuItem>
            {chatList.length > 0 ? <DropdownMenuSeparator /> : null}
            {chatList.map((chat) => (
              <DropdownMenuItem key={chat.id} onClick={() => useLayoutStore.getState().setActiveChatId(chat.id)}>
                {chat.title?.trim() || "对话"}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="展开聊天" onClick={expand}>
          <Maximize2 />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="最小化"
          onClick={() => useLayoutStore.getState().minimizeChatDock()}
        >
          <Minus />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="关闭聊天"
          onClick={() => useLayoutStore.getState().closeChatDock()}
        >
          <X />
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">
          {!agent ? (
            <div className="space-y-2 text-sm">
              <p>还没有智能体，没法开聊天。</p>
              <Button size="sm" onClick={() => navigate("/agents/new")}>
                新建智能体
              </Button>
            </div>
          ) : messages.length === 0 ? (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">你好，我是 {agentName}</p>
                <p className="text-sm text-muted-foreground">试试问</p>
              </div>
              <div className="flex flex-col items-start gap-2">
                {SUGGESTIONS.map((item) => (
                  <Button
                    key={item}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-auto max-w-full whitespace-normal py-1.5 text-left"
                    onClick={() => send.mutate(item)}
                  >
                    {item}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className="space-y-1">
                <p className="text-[11px] text-muted-foreground">{message.role === "user" ? "你" : agentName}</p>
                <p className="whitespace-pre-wrap text-sm">{message.body}</p>
              </div>
            ))
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </ScrollArea>
      <form
        className="flex shrink-0 items-end gap-1 border-t border-border p-2"
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate(draft);
        }}
      >
        <Input
          value={draft}
          placeholder={`给 ${agentName} 发消息...`}
          className="min-h-9"
          disabled={!agent}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" size="icon" disabled={!agent || send.isPending || !draft.trim()} aria-label="发送">
          <SendHorizonal />
        </Button>
      </form>
    </section>
  );
}
