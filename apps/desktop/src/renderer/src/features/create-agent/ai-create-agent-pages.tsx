import { useQuery } from "@tanstack/react-query";
import { Button, cn } from "@coordy/ui";
import { ChevronRight, Loader2, MessageSquare } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  applyDraftCompletion,
  applyDraftFastChange,
  applyDraftModelChange,
  applyDraftRuntimeChange,
  applyDraftThinkingChange,
  BUILDER_STARTER_PROMPTS,
  classifyCreateAgentError,
  draftCompletionReply,
  emptyAgentDraft,
  type AgentDraft,
  type BuilderMessage,
} from "../../lib/coordy/agent-draft";
import {
  browserStore,
  listBuilderSessions,
  newBuilderSessionId,
  removeBuilderSession,
  sessionPreview,
  sessionTitle,
  upsertBuilderSession,
  type BuilderSession,
} from "../../lib/coordy/builder-sessions";
import {
  harnessIdsMatch,
  pickerRuntimes,
  runtimeChipLabel,
  runtimeIsLaunchable,
  selectableRuntimes,
} from "../../lib/coordy/labels";
import { createNamedAgent } from "../../lib/coordy/start-task";
import { useSession } from "../../state/session-store";
import { AgentConfigurationPanel, CreateAgentFooter, HarnessDropdown, RuntimeCapabilityFields } from "./agent-create-form";
import { AgentCreateChip, AgentCreateShell } from "./create-shell";

export function AiCreateAgentPage() {
  const workspaceId = useSession((s) => s.workspaceId);
  const navigate = useNavigate();
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });
  const appInfo = useQuery({
    queryKey: ["app-info"],
    queryFn: () => window.coordy.getAppInfo(),
  });
  const os = appInfo.data?.os;
  const [draft, setDraft] = useState<AgentDraft>(emptyAgentDraft);
  const [sessions, setSessions] = useState<BuilderSession[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = useMemo(() => selectableRuntimes(catalog.data), [catalog.data]);
  const runtimes = useMemo(() => pickerRuntimes(catalog.data, draft.harness), [catalog.data, draft.harness]);
  const selected = runtimes.find((item) => harnessIdsMatch(item.id, draft.harness)) ?? null;

  useEffect(() => {
    if (!workspaceId) return;
    const store = browserStore();
    if (store) setSessions(listBuilderSessions(workspaceId, store));
  }, [workspaceId]);

  useEffect(() => {
    if (draft.harness || online.length === 0) return;
    setDraft((current) => ({ ...current, harness: online[0]?.id ?? "" }));
  }, [draft.harness, online]);

  const startConversation = () => {
    if (!workspaceId) {
      setError("工作区尚未就绪。");
      return;
    }
    setStarting(true);
    const session: BuilderSession = {
      id: newBuilderSessionId(),
      workspaceId,
      draft: { ...draft, harness: selected?.id ?? draft.harness },
      messages: [],
      updatedAt: new Date().toISOString(),
    };
    const store = browserStore();
    if (store) upsertBuilderSession(session, store);
    navigate(`/agents/new/ai/${session.id}`);
  };

  return (
    <AgentCreateShell
      title="创建智能体"
      step="通过对话起草"
      onBack={() => navigate("/agents/new")}
      chips={
        <>
          <AgentCreateChip>通过对话起草</AgentCreateChip>
          {selected ? <AgentCreateChip>{runtimeChipLabel(selected, os)}</AgentCreateChip> : null}
        </>
      }
    >
      <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-10">
        <div className="w-full max-w-xl">
          <UnfinishedDraftsBanner
            sessions={sessions}
            onResume={(sessionId) => navigate(`/agents/new/ai/${sessionId}`)}
          />
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MessageSquare className="size-5" />
            </span>
            <h2 className="mt-5 text-xl font-semibold">选择新智能体的 harness 与执行参数</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              此对话会调用已配置的模型密钥，把答复写入右侧草稿。未配置密钥时会明确失败，不会用模板冒充模型。Harness、模型、思考强度与 Codex Fast 仅在创建完成后、启动运行时使用。
            </p>
            <div className="mt-6 space-y-4">
              <HarnessDropdown
                items={runtimes}
                loading={catalog.isLoading}
                value={draft.harness}
                os={os}
                onChange={(harness) => setDraft((current) => applyDraftRuntimeChange(current, harness))}
              />
              <RuntimeCapabilityFields
                harness={draft.harness}
                model={draft.model}
                thinking={draft.thinking}
                speed={draft.speed}
                disabled={!draft.harness}
                onModelChange={(model) => setDraft((current) => applyDraftModelChange(current, model))}
                onThinkingChange={(thinking) => setDraft((current) => applyDraftThinkingChange(current, thinking))}
                onFastChange={(on) => setDraft((current) => applyDraftFastChange(current, on))}
              />
            </div>
            {error ? (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end">
              <Button onClick={startConversation} disabled={starting}>
                {starting ? <Loader2 className="size-4 animate-spin" /> : null}
                开始对话
              </Button>
            </div>
          </div>
        </div>
      </main>
    </AgentCreateShell>
  );
}

export function AiBuilderSessionPage() {
  const { sessionId } = useParams();
  const workspaceId = useSession((s) => s.workspaceId);
  const principalId = useSession((s) => s.principalId);
  const navigate = useNavigate();
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });
  const appInfo = useQuery({
    queryKey: ["app-info"],
    queryFn: () => window.coordy.getAppInfo(),
  });
  const os = appInfo.data?.os;
  const [session, setSession] = useState<BuilderSession | null>(null);
  const [missing, setMissing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const runtimes = useMemo(
    () => pickerRuntimes(catalog.data, session?.draft.harness),
    [catalog.data, session?.draft.harness],
  );
  const selected = runtimes.find((item) => harnessIdsMatch(item.id, session?.draft.harness ?? ""));
  const runtimeOnline = Boolean(selected?.installed);

  useEffect(() => {
    if (!workspaceId || !sessionId) return;
    const store = browserStore();
    const found = store ? listBuilderSessions(workspaceId, store).find((item) => item.id === sessionId) : undefined;
    if (!found) {
      setMissing(true);
      return;
    }
    setSession(found);
  }, [sessionId, workspaceId]);

  useEffect(() => {
    if (missing) navigate("/agents/new/ai", { replace: true });
  }, [missing, navigate]);

  const persist = (next: BuilderSession) => {
    const store = browserStore();
    const stamped = { ...next, updatedAt: new Date().toISOString() };
    if (store) upsertBuilderSession(stamped, store);
    setSession(stamped);
  };

  const send = async (text: string) => {
    if (!session || !text.trim() || !runtimeOnline || sending) return;
    setSending(true);
    setFormError(null);
    const userCount = session.messages.filter((message) => message.role === "user").length;
    const user: BuilderMessage = { id: `${session.id}-u-${userCount}`, role: "user", content: text.trim() };
    const withUser = { ...session, messages: [...session.messages, user] };
    persist(withUser);
    setComposer("");
    try {
      const secrets = await window.coordy.secretsStatus();
      if (!secrets.key_configured) {
        throw new Error("未配置模型密钥。请在设置 → 模型密钥中填写后再使用对话起草。");
      }
      const completion = await window.coordy.completeDraft("agent", text.trim());
      persist({
        ...withUser,
        draft: applyDraftCompletion(withUser.draft, completion),
        messages: [
          ...withUser.messages,
          {
            id: `${session.id}-a-${userCount}`,
            role: "assistant",
            content: draftCompletionReply(completion),
          },
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      persist({
        ...withUser,
        messages: [
          ...withUser.messages,
          { id: `${session.id}-a-${userCount}`, role: "assistant", content: message },
        ],
      });
      setFormError(message);
    } finally {
      setSending(false);
    }
  };

  const create = async () => {
    if (!session || !workspaceId || !principalId) return;
    if (!runtimeIsLaunchable(selected)) {
      setFormError("所选 harness 尚未安装，暂时不能创建智能体。");
      return;
    }
    setCreating(true);
    setNameError(null);
    setFormError(null);
    try {
      const agentId = await createNamedAgent({
        workspaceId,
        principalId,
        name: session.draft.name,
        harness: session.draft.harness,
        description: session.draft.description,
        instructions: session.draft.instructions,
        model: session.draft.model,
        thinking: session.draft.thinking,
        speed: session.draft.speed,
        avatar: session.draft.avatar,
        access: session.draft.access,
        toolAccess: session.draft.toolAccess,
      });
      const store = browserStore();
      if (store) removeBuilderSession(workspaceId, session.id, store);
      useSession.getState().setAgent(agentId, principalId);
      navigate(`/agents/${agentId}`);
    } catch (err: unknown) {
      const classified = classifyCreateAgentError(err);
      setNameError(classified.nameError);
      setFormError(classified.formError);
      setCreating(false);
    }
  };

  const discard = () => {
    if (!session || !workspaceId) return;
    setDiscarding(true);
    const store = browserStore();
    if (store) removeBuilderSession(workspaceId, session.id, store);
    navigate("/agents/new/ai", { replace: true });
  };

  if (!session) return null;
  const canCreate = session.draft.name.trim().length > 0 && runtimeIsLaunchable(selected) && !creating;

  return (
    <AgentCreateShell
      title="创建智能体"
      step="通过对话起草"
      onBack={() => navigate("/agents/new")}
      chips={
        <>
          <AgentCreateChip>通过对话起草</AgentCreateChip>
          {selected ? <AgentCreateChip>{runtimeChipLabel(selected, os)}</AgentCreateChip> : null}
        </>
      }
    >
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <BuilderConversation
          messages={session.messages}
          runtimeOnline={runtimeOnline}
          sending={sending}
          composer={composer}
          onComposerChange={setComposer}
          onSend={(text) => void send(text)}
        />
        <div className="flex min-h-0 flex-col border-t bg-muted/10 lg:border-t-0 lg:border-l">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-2xl px-5 py-6">
              <div className="mb-6">
                <h2 className="text-sm font-semibold tracking-tight">智能体配置</h2>
                <p className="mt-1 text-xs text-muted-foreground">模型回复会写入此处。也可直接编辑字段。</p>
              </div>
              <AgentConfigurationPanel
                compact
                draft={session.draft}
                onChange={(draft) => {
                  setNameError(null);
                  persist({ ...session, draft });
                }}
                runtimes={runtimes}
                runtimesLoading={catalog.isLoading}
                nameError={nameError}
                os={os}
              />
            </div>
          </div>
          {confirmDiscard ? (
            <div className="border-t px-5 py-3 text-sm">
              <p className="font-medium">放弃本次创建？</p>
              <p className="mt-1 text-muted-foreground">对话与右侧配置将被永久删除。</p>
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setConfirmDiscard(false)} disabled={discarding}>
                  继续编辑
                </Button>
                <Button type="button" variant="destructive" onClick={discard} disabled={discarding}>
                  放弃创建
                </Button>
              </div>
            </div>
          ) : (
            <CreateAgentFooter
              canCreate={canCreate}
              creating={creating}
              error={formError}
              onCreate={() => void create()}
              onDiscard={() => setConfirmDiscard(true)}
              discarding={discarding}
            />
          )}
        </div>
      </div>
    </AgentCreateShell>
  );
}

function BuilderConversation({
  messages,
  runtimeOnline,
  sending,
  composer,
  onComposerChange,
  onSend,
}: {
  messages: BuilderMessage[];
  runtimeOnline: boolean;
  sending: boolean;
  composer: string;
  onComposerChange: (value: string) => void;
  onSend: (text: string) => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSend(composer);
  };
  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b px-5 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">起草对话</h2>
          <p className="truncate text-xs text-muted-foreground">
            {sending ? "正在调用已配置的模型密钥…" : "调用已配置的模型密钥，将答复写入右侧草稿。"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("size-2 rounded-full", runtimeOnline ? "bg-emerald-500" : "bg-muted-foreground/40")} />
          {runtimeOnline ? "运行 harness 在线" : "未选择在线 harness"}
        </div>
      </header>
      {messages.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <ol className="mx-auto flex max-w-xl flex-col gap-4">
            {messages.map((message) => (
              <li
                key={message.id}
                className={cn(
                  "max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-6",
                  message.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {message.content}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-8">
          <div className="w-full max-w-xl text-center">
            <h3 className="text-lg font-semibold text-balance">该智能体的职责是什么？</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-pretty text-muted-foreground">
              说明角色、工作流程、输出或约束，右侧将生成第一版草稿。
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {BUILDER_STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={!runtimeOnline || sending}
                  onClick={() => onSend(prompt)}
                  className="rounded-full border bg-background px-3 py-1.5 text-xs transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <form onSubmit={submit} className="shrink-0 border-t px-5 py-3">
        <div className="mx-auto flex max-w-xl items-end gap-2">
          <textarea
            rows={2}
            value={composer}
            onChange={(event) => onComposerChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend(composer);
              }
            }}
            placeholder="描述所需智能体…"
            disabled={sending || !runtimeOnline}
            className="min-h-16 flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          />
          <Button type="submit" disabled={!composer.trim() || sending || !runtimeOnline}>
            {sending ? "发送中…" : "发送"}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function UnfinishedDraftsBanner({
  sessions,
  onResume,
}: {
  sessions: BuilderSession[];
  onResume: (sessionId: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  if (sessions.length === 0) return null;
  const openOrPick = () => {
    const only = sessions[0];
    if (sessions.length === 1 && only) {
      onResume(only.id);
      return;
    }
    setPicking(true);
  };
  return (
    <>
      <button
        type="button"
        onClick={openOrPick}
        className={cn(
          "mb-5 flex w-full items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-left transition-colors",
          "hover:border-primary/40 hover:bg-accent/30",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
          <MessageSquare className="size-4" />
        </span>
        <span className="min-w-0 flex-1 text-sm">有 {sessions.length} 条未完成的创建草稿</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {picking ? (
        <div className="mb-5 space-y-2 rounded-xl border bg-card p-4">
          <p className="text-sm font-medium">创建草稿</p>
          <p className="text-xs text-muted-foreground">选择一条草稿继续。</p>
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => onResume(session.id)}
              className="flex w-full items-start rounded-lg border p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/30"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{sessionTitle(session) || "未命名草稿"}</span>
                <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                  {sessionPreview(session)}
                </span>
              </span>
            </button>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => setPicking(false)}>
            取消
          </Button>
        </div>
      ) : null}
    </>
  );
}
