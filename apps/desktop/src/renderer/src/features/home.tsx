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
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import { startAcpRun } from "../lib/coordy/start-task";
import { agentDisplayName, listableAgents, runStatusLabel } from "../lib/coordy/labels";
import { asAgents, asRunDetail, asRuns } from "../lib/coordy/views";
import { useSession } from "../state/session-store";
import { ActivityLine } from "./activity-marker";
import { NamedWithLogo } from "./provider-logo";

export function HomePage() {
  const workspaceId = useSession((s) => s.workspaceId);
  const principalId = useSession((s) => s.principalId);
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
    queryKey: ["home-runs", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Runs", workspace_id: workspaceId! }),
    refetchInterval: 1000,
  });
  const agentList = listableAgents(asAgents(agents.data));
  const defaultAgent = agentList[0];
  const [agentId, setAgentId] = useState<string>("");
  const [title, setTitle] = useState("帮我看看这个仓库");
  const [prompt, setPrompt] = useState("用中文说明你能做什么，然后等我下一条指令。");
  const [runId, setRunId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedAgentId = agentId || defaultAgent?.id || "";
  const agentItems = useMemo(
    () => Object.fromEntries(agentList.map((agent) => [agent.id, agentDisplayName(agent, catalog.data)])),
    [agentList, catalog.data],
  );
  const latestRun = asRuns(runs.data).at(-1);
  const activeRunId = runId ?? latestRun?.id ?? null;
  const detail = useQuery({
    queryKey: ["home-run", activeRunId],
    enabled: Boolean(activeRunId),
    queryFn: () => view({ type: "Run", run_id: activeRunId! }),
    refetchInterval: 800,
  });
  const events = asRunDetail(detail.data)?.events ?? [];
  const repoPath = settings.data?.type === "Settings" ? settings.data.repo_path : null;

  const start = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !principalId) throw new Error("还没准备好，请稍等一下");
      return startAcpRun({
        workspaceId,
        principalId,
        title,
        prompt,
        agentId: selectedAgentId,
      });
    },
    onSuccess: async (result) => {
      setRunId(result.runId);
      setNotice("已经交给智能体，它会自己动手。回话会出现在下面。");
      await qc.invalidateQueries();
    },
    onError: (err: unknown) => setNotice(err instanceof Error ? err.message : String(err)),
  });

  return (
    <section className="space-y-4">
      <PageHeader title="开始" description="选一个已经建好的智能体，说你想做什么，它就会在这台电脑上动手。" />
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

      {agentList.length === 0 ? (
        <Empty className="bg-muted/30">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bot />
            </EmptyMedia>
            <EmptyTitle>还没有智能体</EmptyTitle>
            <EmptyDescription>
              不会把本机检测到的工具直接摆进来。先新建智能体，再在创建流程里选运行时。
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
            <CardDescription>像派工一样：选一个智能体，说一句话就开始。长期要求写进事项说明或智能体指令里。</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                start.mutate();
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
                        <NamedWithLogo provider={agent.harness}>
                          {agentDisplayName(agent, catalog.data)}
                        </NamedWithLogo>
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
                <Label htmlFor="task-prompt">对智能体说</Label>
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
          <CardDescription>选一个仓库后，智能体在这个目录干活。</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{repoPath ?? "还没绑定仓库"}</p>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigate("/settings")}>
            去设置里绑定
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>进度</CardTitle>
          <CardDescription>
            {activeRunId
              ? `${runStatusLabel(asRunDetail(detail.data)?.run.status ?? latestRun?.status ?? "running")}。也可以打开对应事项继续说。`
              : "开始之后，智能体的回复会出现在这里。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有记录。</p>
          ) : (
            events.map((event) => <ActivityLine key={event.seq} event={event} />)
          )}
        </CardContent>
        {latestRun ? (
          <CardFooter className="flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate(`/board/${latestRun.task_id}`)}>
              打开事项
            </Button>
            {latestRun.status === "running" ? (
              <Button
                variant="destructive"
                onClick={() => {
                  void submit({ type: "CancelRun", run_id: latestRun.id }).then(async () => {
                    setNotice("已停止。");
                    await qc.invalidateQueries();
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
