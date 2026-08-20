import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Empty,
  EmptyContent,
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
import { Bot, FolderGit2, Play, Square } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import { normalizedAgentId, startAcpRun } from "../lib/coordy/start-task";
import { agentDisplayName, listableAgents, runStatusLabel } from "../lib/coordy/labels";
import { activeHomeRun, asAgents, asRunDetail, asRuns } from "../lib/coordy/views";
import { useSession } from "../state/session-store";
import { ActivityLine } from "./activity-marker";
import { NamedAgent } from "./agent-avatar";

export function HomePage() {
  const workspaceId = useSession((s) => s.workspaceId);
  const principalId = useSession((s) => s.principalId);
  const sessionAgentId = useSession((s) => s.agentId);
  const actorKey = sessionAgentId ? `agent:${sessionAgentId}:${principalId ?? ""}` : `principal:${principalId ?? ""}`;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const settings = useQuery({
    queryKey: ["settings", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Settings", workspace_id: workspaceId! }),
  });
  const agents = useQuery({
    queryKey: ["home-agents", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Agents", workspace_id: workspaceId! }),
  });
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });
  const runs = useQuery({
    queryKey: ["home-runs", workspaceId, actorKey],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Runs", workspace_id: workspaceId! }),
    refetchInterval: 1000,
  });
  const agentList = listableAgents(asAgents(agents.data));
  const [agentId, setAgentId] = useState<string>("");
  const [title, setTitle] = useState("审查当前仓库");
  const [prompt, setPrompt] = useState("用中文说明你的能力，然后等待下一条指令。");
  const [runPin, setRunPin] = useState<{ scope: string; runId: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const runScope = `${workspaceId ?? ""}|${actorKey}`;
  const pinnedRunId = runPin?.scope === runScope ? runPin.runId : null;
  const selectedAgentId = normalizedAgentId(agentList, agentId);
  const agentItems = useMemo(
    () => Object.fromEntries(agentList.map((agent) => [agent.id, agentDisplayName(agent, catalog.data)])),
    [agentList, catalog.data],
  );
  const runList = asRuns(runs.data);
  const activeRun = activeHomeRun(runList, pinnedRunId);
  const activeRunId = activeRun?.id ?? null;
  const detail = useQuery({
    queryKey: ["home-run", workspaceId, actorKey, activeRunId],
    enabled: Boolean(activeRunId),
    queryFn: () => view({ type: "Run", run_id: activeRunId! }),
    refetchInterval: 800,
  });
  const events = asRunDetail(detail.data)?.events ?? [];
  const repoPath = settings.data?.type === "Settings" ? settings.data.repo_path : null;

  useEffect(() => {
    if (agentId !== selectedAgentId) setAgentId(selectedAgentId);
  }, [agentId, selectedAgentId]);

  useEffect(() => {
    setRunPin(null);
    setNotice(null);
  }, [runScope]);

  const start = useMutation({
    mutationFn: async (request: {
      scope: string;
      workspaceId: string;
      principalId: string;
      title: string;
      prompt: string;
      agentId: string;
    }) => {
      const result = await startAcpRun({
        workspaceId: request.workspaceId,
        principalId: request.principalId,
        title: request.title,
        prompt: request.prompt,
        agentId: request.agentId,
      });
      return { ...result, scope: request.scope };
    },
    onSuccess: async (result) => {
      if (result.scope !== runScope) return;
      setRunPin({ scope: result.scope, runId: result.runId });
      setNotice("已派发给智能体。回复将显示在下方。");
      await qc.invalidateQueries();
    },
    onError: (err: unknown, request) => {
      if (request.scope === runScope) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    },
  });

  return (
    <section className="space-y-4">
      <PageHeader title="开始" description="选择已创建的智能体，输入指令后由本机 harness 执行。" />
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

      {agentList.length === 0 ? (
        <Empty className="bg-muted/30">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bot />
            </EmptyMedia>
            <EmptyTitle>暂无智能体</EmptyTitle>
            <EmptyDescription>
              本机检测到的工具不会自动成为智能体。请先创建智能体，并在创建流程中选择 harness。
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => navigate("/agents/new")}>新建智能体</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="size-4" />
              指派智能体
            </CardTitle>
            <CardDescription>选择智能体并发送指令以启动运行。长期要求应写入事项说明或智能体指令。</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                if (!workspaceId || !principalId) {
                  setNotice("工作区尚未就绪。");
                  return;
                }
                start.mutate({
                  scope: runScope,
                  workspaceId,
                  principalId,
                  title,
                  prompt,
                  agentId: selectedAgentId,
                });
              }}
            >
              <div className="space-y-1.5">
                <Label>智能体</Label>
                <Select value={selectedAgentId} items={agentItems} onValueChange={(value) => value && setAgentId(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {agentList.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        <NamedAgent agent={agent} catalog={catalog.data} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-title">事项标题</Label>
                <Input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-prompt">指令</Label>
                <Textarea id="task-prompt" rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
              </div>
              <Button type="submit" disabled={start.isPending || !selectedAgentId}>
                <Play data-icon="inline-start" />
                开始
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderGit2 className="size-4" />
            工作目录
          </CardTitle>
          <CardDescription>绑定仓库后，智能体在该目录中执行。</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{repoPath ?? "未绑定仓库"}</p>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigate("/settings")}>
            在设置中绑定
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>进度</CardTitle>
          <CardDescription>
            {activeRunId
              ? `${runStatusLabel(asRunDetail(detail.data)?.run.status ?? activeRun?.status ?? "running")}。也可打开对应事项继续发送指令。`
              : "启动后，智能体回复将显示在此处。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无记录。</p>
          ) : (
            events.map((event) => <ActivityLine key={event.seq} event={event} />)
          )}
        </CardContent>
        {activeRun ? (
          <CardFooter className="flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate(`/board/${activeRun.task_id}`)}>
              打开事项
            </Button>
            {activeRun.status === "running" ? (
              <Button
                variant="destructive"
                onClick={() => {
                  void submit({ type: "CancelRun", run_id: activeRun.id })
                    .then(async () => {
                      setNotice("已停止。");
                      await qc.invalidateQueries();
                    })
                    .catch((error: unknown) => {
                      setNotice(error instanceof Error ? error.message : String(error));
                    });
                }}
              >
                <Square data-icon="inline-start" />
                停止
              </Button>
            ) : null}
          </CardFooter>
        ) : null}
      </Card>
    </section>
  );
}
