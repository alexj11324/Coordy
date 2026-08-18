import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { FileCode2, FolderGit2, KeyRound, Play, RefreshCw, Save, Terminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { submit, view } from "../lib/coordy/client";
import { startAcpRun, syncDiscoveredAgents } from "../lib/coordy/start-task";
import { asAgents, asRunDetail, asRuns, isPlaceholderHarness } from "../lib/coordy/views";
import { useSession } from "../state/session-store";

export function HomePage() {
  const workspaceId = useSession((s) => s.workspaceId);
  const principalId = useSession((s) => s.principalId);
  const qc = useQueryClient();
  const secrets = useQuery({
    queryKey: ["secrets"],
    queryFn: () => window.coordy.secretsStatus(),
  });
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });
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
  const runs = useQuery({
    queryKey: ["home-runs", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Runs", workspace_id: workspaceId! }),
    refetchInterval: 1000,
  });
  const agentList = asAgents(agents.data);
  const liveAgents = agentList.filter((agent) => !isPlaceholderHarness(agent.harness));
  const installed = (catalog.data ?? []).filter((item) => item.installed);
  const defaultAgent =
    liveAgents.find((agent) => installed.some((item) => item.id === agent.harness && item.id !== "coordy-stub")) ??
    liveAgents[0] ??
    agentList[0];
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [agentId, setAgentId] = useState<string>("");
  const [title, setTitle] = useState("帮我看看这个仓库");
  const [prompt, setPrompt] = useState("用中文说明你能做什么，然后等我下一条指令。");
  const [runId, setRunId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedAgentId = agentId || defaultAgent?.id || "";
  const agentItems = useMemo(
    () => Object.fromEntries(agentList.map((agent) => [agent.id, `${agent.name} · ${agent.harness}`])),
    [agentList],
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
  const files = useQuery({
    queryKey: ["repo-files", repoPath],
    enabled: Boolean(repoPath),
    queryFn: () => window.coordy.listDirectory(repoPath!),
  });
  const status = secrets.data;
  const autoImported = useRef(false);

  useEffect(() => {
    if (!workspaceId || !principalId || !catalog.isFetched) return;
    if (liveAgents.length > 0 || autoImported.current) return;
    autoImported.current = true;
    void syncDiscoveredAgents(workspaceId, principalId, false)
      .then((result) => {
        if (result.imported.length) {
          setNotice(`已自动导入 ${result.imported.join("、")}`);
        }
        return qc.invalidateQueries();
      })
      .catch((err: unknown) => setNotice(err instanceof Error ? err.message : String(err)));
  }, [workspaceId, principalId, catalog.isFetched, liveAgents.length, qc]);

  const saveSecrets = useMutation({
    mutationFn: () =>
      window.coordy.setSecret({
        provider,
        api_key: apiKey.trim() ? apiKey.trim() : null,
        base_url: baseUrl.trim() ? baseUrl.trim() : null,
      }),
    onSuccess: async () => {
      setApiKey("");
      setNotice("密钥已保存在本机（0600），不会写入数据库。");
      await qc.invalidateQueries({ queryKey: ["secrets"] });
    },
    onError: (err: unknown) => setNotice(err instanceof Error ? err.message : String(err)),
  });

  const start = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !principalId) throw new Error("还没有工作区");
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
      setNotice("已经交给助手。它会自己开工，回复出现在下面。");
      await qc.invalidateQueries();
    },
    onError: (err: unknown) => setNotice(err instanceof Error ? err.message : String(err)),
  });

  return (
    <section className="space-y-4">
      <PageHeader title="开始" description="启动时自动扫描 PATH 和 ACP Registry，把本机 CLI 导入成可指派的队友。不必手填启动命令。" />
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>本机助手</CardTitle>
          <CardDescription>
            已安装的会自动导入。Registry 里其余条目出现在「助手」页，点一次即可加入，不会预先 npm install。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(catalog.data ?? []).length === 0 ? (
            <Badge variant="secondary">正在扫描 PATH / ACP Registry…</Badge>
          ) : (
            (catalog.data ?? []).map((item) => (
              <Badge key={item.id} variant={item.installed ? "outline" : "secondary"}>
                {item.name}
                {item.installed ? " · 已安装" : " · Registry"}
              </Badge>
            ))
          )}
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              if (!workspaceId || !principalId) return;
              const result = await syncDiscoveredAgents(workspaceId, principalId, true);
              setNotice(
                result.imported.length
                  ? `已导入 ${result.imported.join("、")}`
                  : "没有新的本机助手。装好 Claude / Codex / Gemini 等 CLI 后会自动出现。",
              );
              await qc.invalidateQueries();
            }}
          >
            <RefreshCw data-icon="inline-start" />
            刷新发现
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            你自己的密钥
          </CardTitle>
          <CardDescription>BYOK：只存在这台电脑。真助手启动时会带上环境变量。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>服务商</Label>
            <Select
              value={provider}
              items={{ openai: "OpenAI 兼容", anthropic: "Anthropic", custom: "自定义" }}
              onValueChange={(value) => value && setProvider(value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI 兼容</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="custom">自定义</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>状态</Label>
            <p className="pt-1.5 text-sm">
              {status?.key_configured ? <Badge>已保存</Badge> : <Badge variant="secondary">还没填</Badge>}
            </p>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="api-key">API 密钥</Label>
            <Input
              id="api-key"
              type="password"
              autoComplete="off"
              placeholder={status?.key_configured ? "已保存，留空则保持原密钥" : "sk-…"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="base-url">Base URL（可选）</Label>
            <Input
              id="base-url"
              placeholder={status?.base_url ?? "https://api.openai.com/v1"}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button onClick={() => saveSecrets.mutate()} disabled={saveSecrets.isPending}>
            <Save data-icon="inline-start" />
            保存密钥
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await window.coordy.clearSecret();
              await qc.invalidateQueries({ queryKey: ["secrets"] });
              setNotice("已清除本机密钥。");
            }}
          >
            清除密钥
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderGit2 className="size-4" />
            工作目录
          </CardTitle>
          <CardDescription>选一个仓库后，助手在这个目录干活。也可以打开文件管理器或终端。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{repoPath ?? "还没绑定仓库"}</p>
          {files.data && files.data.length > 0 ? (
            <ul className="grid gap-1 rounded-lg border border-border p-2 text-sm md:grid-cols-2">
              {files.data.slice(0, 16).map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted"
                    onClick={() => void window.coordy.revealFile(entry.path)}
                  >
                    <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{entry.isDirectory ? `${entry.name}/` : entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              const path = await window.coordy.chooseRepository();
              if (path && workspaceId) {
                await submit({ type: "BindRepository", workspace_id: workspaceId, path });
                await qc.invalidateQueries();
              }
            }}
          >
            选择文件夹
          </Button>
          <Button variant="secondary" disabled={!repoPath} onClick={() => repoPath && window.coordy.revealFile(repoPath)}>
            打开所在位置
          </Button>
          <Button variant="secondary" disabled={!repoPath} onClick={() => repoPath && window.coordy.openTerminal(repoPath)}>
            <Terminal data-icon="inline-start" />
            在此打开终端
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="size-4" />
            派给助手
          </CardTitle>
          <CardDescription>像派工给同事一样：选一个已导入的助手，说一句话就开始。</CardDescription>
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
              <Label>助手</Label>
              <Select value={selectedAgentId} items={agentItems} onValueChange={(value) => value && setAgentId(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {agentList.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name} · {agent.harness}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-title">任务</Label>
              <Input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-prompt">对助手说</Label>
              <Textarea id="task-prompt" rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            </div>
            <Button type="submit" disabled={start.isPending || !selectedAgentId}>
              <Play data-icon="inline-start" />
              开始
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>这次运行</CardTitle>
          <CardDescription>{activeRunId ? `运行 ${activeRunId}` : "开始之后，助手的话会出现在这里。"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有事件。</p>
          ) : (
            events.map((event) => (
              <p key={event.seq} className="whitespace-pre-wrap text-sm">
                <Badge className="mr-2">{event.kind}</Badge>
                {event.payload}
              </p>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}
