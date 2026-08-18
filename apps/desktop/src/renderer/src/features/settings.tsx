import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@coordy/ui";
import { useState } from "react";
import { submit, view } from "../lib/coordy/client";
import { modifierSymbol } from "../lib/coordy/shortcuts";
import { useSession } from "../state/session-store";
import { applyTheme, useThemeStore, type ThemePreference } from "../state/theme-store";

const TABS = [
  ["general", "通用"],
  ["appearance", "外观"],
  ["shortcuts", "快捷键"],
  ["secrets", "密钥"],
  ["about", "关于"],
] as const;

type SettingsTab = (typeof TABS)[number][0];

const THEMES: { id: ThemePreference; label: string; hint: string }[] = [
  { id: "light", label: "浅色", hint: "浅色界面" },
  { id: "dark", label: "深色", hint: "深色界面" },
  { id: "system", label: "跟随系统", hint: "跟操作系统一致" },
];

export function SettingsPage() {
  const workspaceId = useSession((s) => s.workspaceId);
  const qc = useQueryClient();
  const [tab, setTab] = useState<SettingsTab>("general");
  const q = useQuery({
    queryKey: ["settings", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Settings", workspace_id: workspaceId! }),
  });
  const secrets = useQuery({
    queryKey: ["secrets"],
    queryFn: () => window.coordy.secretsStatus(),
  });
  const appInfoQuery = useQuery({
    queryKey: ["app-info"],
    queryFn: () => window.coordy.getAppInfo(),
  });
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [notice, setNotice] = useState("");
  const enabled = q.data?.type === "Settings" ? q.data.llm_advisor_enabled : false;
  const status = secrets.data;
  const info = appInfoQuery.data;
  const repoPath = q.data?.type === "Settings" ? q.data.repo_path : null;

  const saveSecrets = useMutation({
    mutationFn: () =>
      window.coordy.setSecret({
        provider,
        api_key: apiKey.trim() ? apiKey.trim() : null,
        base_url: baseUrl.trim() ? baseUrl.trim() : null,
      }),
    onSuccess: async () => {
      setApiKey("");
      setNotice("密钥已保存在这台电脑，不会上传。");
      await qc.invalidateQueries({ queryKey: ["secrets"] });
    },
    onError: (err: unknown) => setNotice(err instanceof Error ? err.message : String(err)),
  });

  return (
    <section className="space-y-4">
      <PageHeader title="设置" description="外观、工作区和密钥都留在这台电脑。密钥不会进数据库，也不会进内核命令。" />
      <div className="grid gap-6 md:grid-cols-[11rem_minmax(0,1fr)]">
        <nav className="flex gap-1 md:flex-col">
          {TABS.map(([id, label]) => (
            <Button
              key={id}
              type="button"
              variant={tab === id ? "secondary" : "ghost"}
              className="justify-start"
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </nav>
        <div className="space-y-6">
          {tab === "general" ? (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <Label>工作区</Label>
                <p className="text-sm">Local</p>
                <p className="text-sm text-muted-foreground">本机工作区。绑定仓库后，任务会在这个目录里执行。</p>
              </div>
              <div className="space-y-1.5">
                <Label>仓库</Label>
                <p className="text-sm text-muted-foreground">{repoPath ?? "还没绑定"}</p>
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
              </div>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-3 py-3">
                <div>
                  <Label htmlFor="llm-advisor">可选 LLM 顾问</Label>
                  <p className="text-sm text-muted-foreground">顾问不能提交状态；确定性门禁始终开着。</p>
                </div>
                <Switch
                  id="llm-advisor"
                  checked={enabled}
                  onCheckedChange={(next) => {
                    if (workspaceId) {
                      void submit({
                        type: "SetSettings",
                        workspace_id: workspaceId,
                        llm_advisor_enabled: Boolean(next),
                      }).then(() => qc.invalidateQueries({ queryKey: ["settings", workspaceId] }));
                    }
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>语言</Label>
                <p className="text-sm">简体中文</p>
                <p className="text-sm text-muted-foreground">当前版本只提供简体中文。</p>
              </div>
            </div>
          ) : null}

          {tab === "appearance" ? (
            <div className="space-y-3">
              <div>
                <Label>主题</Label>
                <p className="text-sm text-muted-foreground">浅色、深色，或跟随系统。</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {THEMES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={[
                      "rounded-xl border px-3 py-3 text-left",
                      preference === item.id ? "border-foreground bg-muted/60" : "border-border hover:bg-muted/40",
                    ].join(" ")}
                    onClick={() => {
                      setPreference(item.id);
                      applyTheme(item.id);
                    }}
                  >
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.hint}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {tab === "shortcuts" ? (
            <div className="space-y-3">
              <div>
                <Label>快捷键</Label>
                <p className="text-sm text-muted-foreground">在输入框里打字时，单键快捷键不会触发。</p>
              </div>
              <ShortcutRow keys={`${modifierSymbol(info?.os)}K`} action="打开搜索" />
              <ShortcutRow keys="C" action="新建任务" />
              <ShortcutRow keys={`${modifierSymbol(info?.os)}B`} action="收起或展开侧栏" />
              <ShortcutRow keys={`${modifierSymbol(info?.os)}T`} action="打开任务标签页" />
              <ShortcutRow keys={`${modifierSymbol(info?.os)}W`} action="关闭当前标签页" />
            </div>
          ) : null}

          {tab === "secrets" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                {status?.key_configured ? <Badge>密钥已保存</Badge> : <Badge variant="secondary">还没密钥</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                写进本机 0600 文件。启动子进程时注入 OPENAI_API_KEY / ANTHROPIC_API_KEY，不会进 SQLite。
              </p>
              <div className="grid gap-3 md:grid-cols-2">
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
                  <Label htmlFor="settings-key">API 密钥</Label>
                  <Input
                    id="settings-key"
                    type="password"
                    autoComplete="off"
                    placeholder={status?.key_configured ? "已保存，留空则保持" : "sk-…"}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="settings-base">接口地址</Label>
                  <Input
                    id="settings-base"
                    placeholder={status?.base_url ?? "https://api.openai.com/v1"}
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => saveSecrets.mutate()} disabled={saveSecrets.isPending}>
                  保存
                </Button>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await window.coordy.clearSecret();
                    setNotice("已清除本机密钥。");
                    await qc.invalidateQueries({ queryKey: ["secrets"] });
                  }}
                >
                  清除密钥
                </Button>
              </div>
              {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
            </div>
          ) : null}

          {tab === "about" ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>应用</Label>
                <p className="text-sm">Coordy {info?.version ?? "…"}</p>
                <p className="text-sm text-muted-foreground">
                  {info ? `${info.os}${info.cliPath ? ` · ${info.cliPath}` : ""}` : "读取应用信息…"}
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={async () => {
                  const result = await window.coordy.installCli();
                  setNotice(result.message);
                }}
              >
                安装命令行
              </Button>
              {notice && tab === "about" ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ShortcutRow({ keys, action }: { keys: string; action: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-3 py-2.5">
      <p className="text-sm">{action}</p>
      <kbd className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
    </div>
  );
}
