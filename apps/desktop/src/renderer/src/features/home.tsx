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
import { FolderGit2, KeyRound, MessageSquare, Play, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { submit, view } from "../lib/coordy/client";
import { startAcpRun } from "../lib/coordy/start-task";
import { asRunDetail, asRuns } from "../lib/coordy/views";
import { useSession } from "../state/session-store";

export function HomePage() {
  const workspaceId = useSession((s) => s.workspaceId);
  const principalId = useSession((s) => s.principalId);
  const qc = useQueryClient();
  const secrets = useQuery({
    queryKey: ["secrets"],
    queryFn: () => window.coordy.secretsStatus(),
  });
  const settings = useQuery({
    queryKey: ["settings", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Settings", workspace_id: workspaceId! }),
  });
  const appInfo = useQuery({
    queryKey: ["app-info"],
    queryFn: () => window.coordy.getAppInfo(),
  });
  const runs = useQuery({
    queryKey: ["home-runs", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Runs", workspace_id: workspaceId! }),
    refetchInterval: 1000,
  });
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [acpCommand, setAcpCommand] = useState("");
  const [title, setTitle] = useState("帮我看看这个仓库");
  const [prompt, setPrompt] = useState("用中文说明你能做什么，然后等我下一条指令。");
  const [runId, setRunId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const status = secrets.data;
  const configuredCommand = acpCommand || status?.acp_command || "";
  const latestRun = asRuns(runs.data).at(-1);
  const activeRunId = runId ?? latestRun?.id ?? null;
  const detail = useQuery({
    queryKey: ["home-run", activeRunId],
    enabled: Boolean(activeRunId),
    queryFn: () => view({ type: "Run", run_id: activeRunId! }),
    refetchInterval: 800,
  });
  const events = asRunDetail(detail.data)?.events ?? [];

  const saveSecrets = useMutation({
    mutationFn: () =>
      window.coordy.setSecret({
        provider,
        api_key: apiKey.trim() ? apiKey.trim() : null,
        base_url: baseUrl.trim() ? baseUrl.trim() : null,
        acp_command: configuredCommand.trim() ? configuredCommand.trim() : null,
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
      return startAcpRun({ workspaceId, principalId, title, prompt });
    },
    onSuccess: async (result) => {
      setRunId(result.runId);
      setNotice("已经交给助手。回复会出现在下面。");
      await qc.invalidateQueries();
    },
    onError: (err: unknown) => setNotice(err instanceof Error ? err.message : String(err)),
  });

  const repoPath = settings.data?.type === "Settings" ? settings.data.repo_path : null;
  const detected = status?.detected ?? [];

  return (
    <section className="space-y-4">
      <PageHeader
        title="开始"
        description="三步就能跑：密钥留在这台电脑，助手走 ACP 协议，任务直接开跑。"
      />
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            1. 你自己的密钥
          </CardTitle>
          <CardDescription>
            BYOK：密钥写成 0600 文件，不进 SQLite，也不走 kernel Command。已保存时这里不会回显。
          </CardDescription>
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
              {status?.key_configured ? (
                <Badge>已保存</Badge>
              ) : (
                <Badge variant="secondary">还没填</Badge>
              )}
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
            <MessageSquare className="size-4" />
            2. 接上 ACP 助手
          </CardTitle>
          <CardDescription>
            走 Agent Client Protocol（stdio JSON-RPC）。本机有 Codex / Claude / Gemini 时会自动用；没有也可以先用内置演示。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {detected.length === 0 ? (
              <Badge variant="secondary">PATH 上还没发现助手</Badge>
            ) : (
              detected.map((item) => (
                <Badge key={`${item.kind}-${item.binary}`} variant="outline">
                  {item.kind} · {item.binary}
                </Badge>
              ))
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acp-command">ACP 启动命令</Label>
            <Input
              id="acp-command"
              placeholder="codex acp"
              value={configuredCommand}
              onChange={(event) => setAcpCommand(event.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              const stub =
                status?.suggested_acp_command ??
                (appInfo.data?.cliPath ? `${appInfo.data.cliPath} acp-stub` : "coordy acp-stub");
              setAcpCommand(stub);
              await window.coordy.setSecret({
                provider,
                acp_command: stub,
              });
              await qc.invalidateQueries({ queryKey: ["secrets"] });
              setNotice("已改用内置演示助手。装好 Codex/Claude 后再把命令改回 `codex acp`。");
            }}
          >
            使用内置演示助手
          </Button>
          <Button variant="secondary" onClick={() => saveSecrets.mutate()}>
            保存启动命令
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderGit2 className="size-4" />
            3. 工作目录（可选）
          </CardTitle>
          <CardDescription>选一个仓库后，助手会在这个目录里干活。不选也能先对话。</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{repoPath ?? "还没绑定仓库"}</p>
        </CardContent>
        <CardFooter>
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
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="size-4" />
            4. 说一句话，开始
          </CardTitle>
          <CardDescription>会自动建助手、派任务，然后按 ACP 把回复吃进这次运行。</CardDescription>
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
              <Label htmlFor="task-title">任务</Label>
              <Input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-prompt">对助手说</Label>
              <Textarea
                id="task-prompt"
                rows={4}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={start.isPending}>
              <Play data-icon="inline-start" />
              开始
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>这次运行</CardTitle>
          <CardDescription>
            {activeRunId ? `运行 ${activeRunId}` : "开始之后，助手的话会出现在这里。"}
          </CardDescription>
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
