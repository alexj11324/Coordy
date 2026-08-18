import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  cn,
} from "@coordy/ui";
import {
  Bell,
  FolderGit2,
  Keyboard,
  KeyRound,
  ListTodo,
  MessageCircle,
  Plug,
  RefreshCw,
  Server,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Tags,
  User,
  Users,
  FlaskConical,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import { ISSUE_BOARD_COLUMNS, PRIORITY_ITEMS } from "../lib/coordy/issues";
import {
  agentDisplayName,
  daemonConnectionStatus,
  inboxKindLabel,
  listableAgents,
  osShortLabel,
} from "../lib/coordy/labels";
import { modifierSymbol as shortcutMod } from "../lib/coordy/shortcuts";
import {
  asAccount,
  asAgents,
  asHealth,
  asLabels,
  asPrincipals,
  asWorkspace,
  asWorkspaces,
} from "../lib/coordy/views";
import { StatusLamp } from "./status-lamp";
import { useSession } from "../state/session-store";
import { applyTheme, useThemeStore, type ThemePreference } from "../state/theme-store";

const ACCOUNT_TABS = [
  { id: "profile", label: "个人资料", icon: User },
  { id: "preferences", label: "偏好设置", icon: SlidersHorizontal },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "issue", label: "任务", icon: ListTodo },
  { id: "chat", label: "聊天", icon: MessageCircle },
  { id: "notifications", label: "通知", icon: Bell },
  { id: "tokens", label: "模型密钥", icon: KeyRound },
  { id: "daemon", label: "Daemon", icon: Server },
  { id: "updates", label: "更新", icon: RefreshCw },
] as const;

const WORKSPACE_TABS = [
  { id: "general", label: "常规", icon: SettingsIcon },
  { id: "repositories", label: "代码仓库", icon: FolderGit2 },
  { id: "github", label: "GitHub", icon: FolderGit2 },
  { id: "integrations", label: "集成", icon: Plug },
  { id: "labs", label: "实验室", icon: FlaskConical },
  { id: "members", label: "成员", icon: Users },
  { id: "labels", label: "标签", icon: Tags },
  { id: "properties", label: "属性", icon: SlidersHorizontal },
  { id: "quick_actions", label: "快捷操作", icon: Zap },
  { id: "mcp", label: "MCP", icon: Server },
] as const;

type SettingsTab = (typeof ACCOUNT_TABS)[number]["id"] | (typeof WORKSPACE_TABS)[number]["id"];

const ALL_TABS: { id: SettingsTab; label: string; icon: LucideIcon }[] = [...ACCOUNT_TABS, ...WORKSPACE_TABS];

const NOTICE_KINDS = [
  "assignment",
  "mention",
  "comment",
  "status",
  "priority",
  "date",
  "agent_failed",
  "automation",
  "action_gate",
  "pause",
  "drift",
] as const;

const THEMES: { id: ThemePreference; label: string; hint: string }[] = [
  { id: "light", label: "浅色", hint: "浅色界面" },
  { id: "dark", label: "深色", hint: "深色界面" },
  { id: "system", label: "跟随系统", hint: "跟操作系统一致" },
];

function isSettingsTab(value: string | null): value is SettingsTab {
  return ALL_TABS.some((item) => item.id === value);
}

function initials(name: string): string {
  const trimmed = name.trim() || "我";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  return Array.from(trimmed).slice(0, 2).join("");
}

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: SettingsTab = isSettingsTab(raw) ? raw : "profile";
  const workspaceId = useSession((s) => s.workspaceId);
  const principalId = useSession((s) => s.principalId);
  const qc = useQueryClient();

  const setTab = (id: SettingsTab) => {
    setParams({ tab: id }, { replace: true });
  };

  return (
    <section className="flex h-full min-h-0">
      <nav className="flex w-[13.5rem] shrink-0 flex-col gap-4 overflow-auto border-r border-border px-3 py-4">
        <SettingsNavGroup title="我的账号" items={ACCOUNT_TABS} tab={tab} onSelect={setTab} />
        <WorkspaceNavGroup tab={tab} onSelect={setTab} />
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto px-8 py-6">
        <SettingsPane tab={tab} workspaceId={workspaceId} principalId={principalId} invalidate={() => qc.invalidateQueries()} />
      </div>
    </section>
  );
}

function SettingsNavGroup({
  title,
  items,
  tab,
  onSelect,
}: {
  title: string;
  items: readonly { id: SettingsTab; label: string; icon: LucideIcon }[];
  tab: SettingsTab;
  onSelect: (id: SettingsTab) => void;
}) {
  return (
    <div>
      <p className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">{title}</p>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              "flex h-8 items-center gap-2 rounded-md px-2 text-sm",
              tab === item.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
            onClick={() => onSelect(item.id)}
          >
            <item.icon className="size-3.5" />
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkspaceNavGroup({ tab, onSelect }: { tab: SettingsTab; onSelect: (id: SettingsTab) => void }) {
  const workspaceId = useSession((s) => s.workspaceId);
  const workspaces = useQuery({
    queryKey: ["workspaces-settings"],
    queryFn: () => view({ type: "Workspaces" }),
  });
  const name = asWorkspaces(workspaces.data).find((item) => item.id === workspaceId)?.name ?? "coordy";
  return <SettingsNavGroup title={name} items={WORKSPACE_TABS} tab={tab} onSelect={onSelect} />;
}

function SettingsPane({
  tab,
  workspaceId,
  principalId,
  invalidate,
}: {
  tab: SettingsTab;
  workspaceId: string | null;
  principalId: string | null;
  invalidate: () => void;
}) {
  const settings = useQuery({
    queryKey: ["settings", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Settings", workspace_id: workspaceId! }),
  });
  const workspace = useQuery({
    queryKey: ["view", { type: "Workspace", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Workspace", workspace_id: workspaceId! }),
  });
  const account = useQuery({
    queryKey: ["view", { type: "Account" }, principalId],
    enabled: Boolean(principalId),
    queryFn: () => view({ type: "Account" }),
  });
  const principals = useQuery({
    queryKey: ["view", { type: "Principals", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Principals", workspace_id: workspaceId! }),
  });
  const labels = useQuery({
    queryKey: ["view", { type: "Labels", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId) && tab === "labels",
    queryFn: () => view({ type: "Labels", workspace_id: workspaceId! }),
  });
  const health = useQuery({
    queryKey: ["view", { type: "Health" }],
    enabled: tab === "daemon",
    queryFn: () => view({ type: "Health" }),
    refetchInterval: 3000,
    retry: false,
  });
  const agents = useQuery({
    queryKey: ["view", { type: "Agents", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId) && tab === "chat",
    queryFn: () => view({ type: "Agents", workspace_id: workspaceId! }),
  });
  const secrets = useQuery({
    queryKey: ["secrets"],
    enabled: tab === "tokens",
    queryFn: () => window.coordy.secretsStatus(),
  });
  const appInfo = useQuery({
    queryKey: ["app-info"],
    queryFn: () => window.coordy.getAppInfo(),
  });

  const ws = asWorkspace(workspace.data);
  const people = asPrincipals(principals.data);
  const me = asAccount(account.data);
  const person = people.find((item) => item.id === principalId);
  const name = me?.name || person?.name || "我";
  const repoPath = settings.data?.type === "Settings" ? settings.data.repo_path : ws?.repo_path;
  const enabled = settings.data?.type === "Settings" ? settings.data.llm_advisor_enabled : false;
  const noticeKinds = settings.data?.type === "Settings" ? (settings.data.notification_kinds ?? []) : [];
  const info = appInfo.data;
  const mod = shortcutMod(info?.os);

  switch (tab) {
    case "profile":
      return <ProfilePane name={name} principalId={principalId} onSaved={invalidate} />;
    case "preferences":
      return <PreferencesPane />;
    case "shortcuts":
      return <ShortcutsPane mod={mod} />;
    case "issue":
      return (
        <Pane title="任务" description="看板列和优先级是 Coordy 内置的，不能像云产品那样自定义工作流引擎。">
          <ul className="grid gap-2 sm:grid-cols-2">
            {ISSUE_BOARD_COLUMNS.map((column) => (
              <li key={column.id} className="rounded-lg border border-border px-3 py-2 text-sm">
              {column.title}
              </li>
            ))}
          </ul>
          <div className="pt-4">
            <h3 className="mb-2 text-sm font-medium">优先级</h3>
            <p className="text-sm text-muted-foreground">{Object.values(PRIORITY_ITEMS).join(" · ")}</p>
          </div>
        </Pane>
      );
    case "chat":
      return (
        <Pane title="聊天" description="右下角悬浮窗走 Coordy 的 CreateChat / SendChatMessage，不会打开浏览器页。">
          <p className="text-sm text-muted-foreground">
            {mod}+J 开关悬浮聊天。聊天对应的 task 带 chat 标签，不会进看板。
          </p>
          {listableAgents(asAgents(agents.data)).length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有智能体，聊天窗里会提示先新建一个。</p>
          ) : (
            <p className="text-sm">可聊对象：{listableAgents(asAgents(agents.data)).map((agent) => agentDisplayName(agent)).join("、")}</p>
          )}
        </Pane>
      );
    case "notifications":
      return (
        <NotificationsPane
          kinds={noticeKinds}
          disabled={!workspaceId}
          onSave={(next) => {
            if (!workspaceId) return;
            void submit({ type: "SetNotificationPrefs", workspace_id: workspaceId, kinds: next }).then(invalidate);
          }}
        />
      );
    case "tokens":
      return <TokensPane status={secrets.data} />;
    case "daemon":
      return (
        <DaemonPane
          live={asHealth(health.data) ?? (health.isError ? null : asHealth(settings.data))}
          isError={health.isError}
          os={info?.os}
        />
      );
    case "updates":
      return (
        <Pane title="更新" description="这是本机构建，没有应用商店更新通道。">
          <p className="text-sm">Coordy {info?.version ?? "…"}</p>
          <p className="text-sm text-muted-foreground">
            {info ? `${info.os}${info.cliPath ? ` · ${info.cliPath}` : ""}` : "读取应用信息…"}
          </p>
          <InstallCliButton />
        </Pane>
      );
    case "general":
      return <GeneralPane workspaceId={workspaceId} workspace={ws} onSaved={invalidate} />;
    case "repositories":
      return (
        <Pane title="代码仓库" description="绑定本机目录。智能体在这个目录里干活，路径不会上传。">
          <p className="text-sm">{repoPath ?? "还没绑定"}</p>
          <Button
            variant="secondary"
            onClick={async () => {
              const path = await window.coordy.chooseRepository();
              if (path && workspaceId) {
                await submit({ type: "BindRepository", workspace_id: workspaceId, path });
                invalidate();
              }
            }}
          >
            选择文件夹
          </Button>
        </Pane>
      );
    case "github":
      return (
        <Pane title="GitHub" description="Coordy 不登录 GitHub 账号，也没有 OAuth。">
          <p className="text-sm text-muted-foreground">
            仓库用左边「代码仓库」选本机文件夹。事项上目前不能挂 PR。
          </p>
        </Pane>
      );
    case "integrations":
      return (
        <Pane title="集成" description="没有 Slack / 飞书 / 企微云通道。">
          <p className="text-sm text-muted-foreground">本机模型密钥在「模型密钥」。可选 LLM 顾问在「实验室」。</p>
        </Pane>
      );
    case "labs":
      return (
        <Pane title="实验室" description="顾问不能提交状态；确定性门禁始终开着。">
          <Row label="可选 LLM 顾问" hint="只做建议，不能 commit。">
            <Switch
              checked={enabled}
              onCheckedChange={(next) => {
                if (!workspaceId) return;
                void submit({
                  type: "SetSettings",
                  workspace_id: workspaceId,
                  llm_advisor_enabled: Boolean(next),
                }).then(invalidate);
              }}
            />
          </Row>
        </Pane>
      );
    case "members":
      return <MembersPane workspaceId={workspaceId} people={people} onSaved={invalidate} />;
    case "labels":
      return <LabelsPane workspaceId={workspaceId} items={asLabels(labels.data)} onSaved={invalidate} />;
    case "properties":
      return (
        <Pane title="属性" description="内核可以存自定义字段定义，但事项创建和详情都还没接上，所以这里不能假装去定义。">
          <p className="text-sm text-muted-foreground">等事项页能读写自定义字段后，再在这里管理字段定义。</p>
        </Pane>
      );
    case "quick_actions":
      return (
        <Pane title="快捷操作" description="Coordy 用命令面板，没有云端工作流按钮。">
          <ShortcutRow keys={`${mod}K`} action="搜索 / 命令面板" />
          <ShortcutRow keys="C" action="新建任务" />
          <ShortcutRow keys={`${mod}J`} action="开关悬浮聊天" />
          <p className="pt-2 text-sm text-muted-foreground">在面板里也可以新建智能体、小队、项目、自动化和 Skill。</p>
        </Pane>
      );
    case "mcp":
      return (
        <Pane title="MCP" description="智能体记录里可以存 MCP 服务器名，但开工时 spawn 不会带上它们。">
          <p className="text-sm text-muted-foreground">当前版本没有可保存的 MCP 配置，避免写进去却不生效。</p>
        </Pane>
      );
    default:
      return null;
  }
}

function DaemonPane({
  live,
  isError,
  os,
}: {
  live: ReturnType<typeof asHealth>;
  isError: boolean;
  os?: string;
}) {
  const conn = daemonConnectionStatus({ isError, status: live?.status });
  const host = osShortLabel(os) || "本机";
  return (
    <Pane
      title="Daemon"
      description="绿灯表示桌面此刻能通过 Unix socket 问到本机 coordyd。不是点「登记」写进电脑清单的旗标。"
    >
      <Row
        label="本机"
        hint={
          conn.tone === "red"
            ? "Health 查询失败，coordyd 没应答。"
            : "当前这台电脑上的 coordyd 进程"
        }
      >
        <span className="inline-flex items-center justify-end gap-2 text-sm">
          <StatusLamp tone={conn.tone} label={conn.label} className="size-2.5" />
          {host} · {conn.label}
        </span>
      </Row>
      {conn.tone === "green" && live ? (
        <>
          <Row label="进程" hint="coordyd 的进程号">
            <span className="text-sm">pid {live.pid}</span>
          </Row>
          <Row label="协议">
            <span className="text-sm">{live.protocol_version}</span>
          </Row>
          <Row label="版本">
            <span className="text-sm">{live.version}</span>
          </Row>
        </>
      ) : null}
    </Pane>
  );
}

function Pane({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p> : null}
      </header>
      {children}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="sm:max-w-sm sm:flex-1 sm:text-right">{children}</div>
    </div>
  );
}

function ProfilePane({
  name,
  principalId,
  onSaved,
}: {
  name: string;
  principalId: string | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => {
    setDraft(name);
  }, [name]);
  const dirty = draft.trim() !== name && draft.trim().length > 0;
  return (
    <Pane title="个人资料" description="名字存在本机工作区成员表里，不是云账号。">
      <Row label="头像" hint="用姓名首字母生成，不能上传照片。">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-emerald-600 text-sm font-medium text-white">
          {initials(draft.trim() || name)}
        </span>
      </Row>
      <Row label="姓名">
        <Input value={draft} onChange={(event) => setDraft(event.target.value)} />
      </Row>
      <Button
        disabled={!principalId || !dirty}
        onClick={() => {
          if (!principalId) return;
          void submit({ type: "UpdatePrincipal", principal_id: principalId, name: draft.trim() }).then(onSaved);
        }}
      >
        保存姓名
      </Button>
    </Pane>
  );
}

function PreferencesPane() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  return (
    <Pane title="偏好设置" description="外观留在这台电脑。">
      <div>
        <Label>主题</Label>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {THEMES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "rounded-xl border px-3 py-3 text-left",
                preference === item.id ? "border-foreground bg-muted/60" : "border-border hover:bg-muted/40",
              )}
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
      <Row label="语言" hint="当前版本只提供简体中文。">
        <span className="text-sm">简体中文</span>
      </Row>
    </Pane>
  );
}

function ShortcutsPane({ mod }: { mod: string }) {
  return (
    <Pane title="快捷键" description="在输入框里打字时，单键快捷键不会触发。">
      <ShortcutRow keys={`${mod}K`} action="打开搜索" />
      <ShortcutRow keys="C" action="新建任务" />
      <ShortcutRow keys={`${mod}B`} action="收起或展开侧栏" />
      <ShortcutRow keys={`${mod}J`} action="开关悬浮聊天" />
      <ShortcutRow keys={`${mod}T`} action="新标签页" />
      <ShortcutRow keys={`${mod}W`} action="关闭当前标签页" />
    </Pane>
  );
}

function NotificationsPane({
  kinds,
  disabled,
  onSave,
}: {
  kinds: string[];
  disabled: boolean;
  onSave: (kinds: string[]) => void;
}) {
  const selected = kinds.length === 0 ? new Set<string>(NOTICE_KINDS) : new Set(kinds);
  const toggle = (kind: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(kind);
    else next.delete(kind);
    const allOn = NOTICE_KINDS.every((item) => next.has(item));
    onSave(allOn ? [] : NOTICE_KINDS.filter((item) => next.has(item)));
  };
  return (
    <Pane title="通知" description="这些开关只影响收件箱写入，不会向操作系统发推送。">
      {NOTICE_KINDS.map((kind) => (
        <Row key={kind} label={inboxKindLabel(kind)} hint={kind}>
          <Switch checked={selected.has(kind)} disabled={disabled} onCheckedChange={(on) => toggle(kind, Boolean(on))} />
        </Row>
      ))}
    </Pane>
  );
}

function TokensPane({ status }: { status?: { key_configured?: boolean; base_url?: string | null } }) {
  const qc = useQueryClient();
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [notice, setNotice] = useState("");
  const save = useMutation({
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
    <Pane
      title="模型密钥"
      description="给本机运行时用的 BYOK。不是 Multica 设置里那个登录账号的 API Token。"
    >
      <p className="text-sm text-muted-foreground">
        Multica 的 API Token 是 <code className="font-mono text-xs">mul_</code>{" "}
        个人访问令牌，给 CLI / 外部集成登录用。Coordy 没有云账号，不会签发那种 token，CLI 走本机 Unix socket。这里保存的密钥写进本机 0600 文件，开工时注入环境变量，不进 SQLite。
      </p>
      <div className="flex items-center gap-2 text-sm">
        {status?.key_configured ? <Badge>密钥已保存</Badge> : <Badge variant="secondary">还没密钥</Badge>}
      </div>
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
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
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
    </Pane>
  );
}

function GeneralPane({
  workspaceId,
  workspace,
  onSaved,
}: {
  workspaceId: string | null;
  workspace: ReturnType<typeof asWorkspace>;
  onSaved: () => void;
}) {
  const [name, setName] = useState(workspace?.name ?? "");
  const [description, setDescription] = useState(workspace?.description ?? "");
  const [context, setContext] = useState(workspace?.context ?? "");
  const [prefix, setPrefix] = useState(workspace?.issue_prefix ?? "COOR");
  useEffect(() => {
    setName(workspace?.name ?? "");
    setDescription(workspace?.description ?? "");
    setContext(workspace?.context ?? "");
    setPrefix(workspace?.issue_prefix ?? "COOR");
  }, [workspace?.id, workspace?.name, workspace?.description, workspace?.context, workspace?.issue_prefix]);
  const dirty =
    name !== (workspace?.name ?? "") ||
    description !== (workspace?.description ?? "") ||
    context !== (workspace?.context ?? "") ||
    prefix !== (workspace?.issue_prefix ?? "COOR");
  return (
    <Pane title="常规" description="工作区名字、给智能体的背景和事项前缀存在本机内核里。">
      <div className="space-y-1.5">
        <Label htmlFor="ws-name">名称</Label>
        <Input id="ws-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ws-desc">说明</Label>
        <Textarea id="ws-desc" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ws-context">给智能体的背景</Label>
        <Textarea
          id="ws-context"
          rows={5}
          value={context}
          onChange={(event) => setContext(event.target.value)}
          placeholder="开工时会写进指令前面。空着就不会加。"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ws-prefix">事项前缀</Label>
        <Input id="ws-prefix" value={prefix} onChange={(event) => setPrefix(event.target.value)} />
      </div>
      <Button
        disabled={!workspaceId || !dirty || !name.trim()}
        onClick={() => {
          if (!workspaceId) return;
          void submit({
            type: "UpdateWorkspace",
            workspace_id: workspaceId,
            name: name.trim(),
            description,
            context,
            issue_prefix: prefix.trim() || "COOR",
          }).then(onSaved);
        }}
      >
        保存
      </Button>
    </Pane>
  );
}

function MembersPane({
  workspaceId,
  people,
  onSaved,
}: {
  workspaceId: string | null;
  people: ReturnType<typeof asPrincipals>;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <Pane title="成员" description="成员拥有智能体和契约投票权。这是本机工作区名单，不是云账号邀请。">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!workspaceId || !name.trim()) return;
          void submit({ type: "CreatePrincipal", workspace_id: workspaceId, name: name.trim() }).then(() => {
            setName("");
            onSaved();
          });
        }}
      >
        <Input placeholder="姓名" value={name} onChange={(event) => setName(event.target.value)} />
        <Button type="submit">添加</Button>
      </form>
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有成员。</p>
      ) : (
        people.map((person) => (
          <p key={person.id} className="border-b border-border py-2 text-sm">
            {person.name}
            {person.role ? <span className="ml-2 text-xs text-muted-foreground">{person.role}</span> : null}
          </p>
        ))
      )}
    </Pane>
  );
}

function LabelsPane({
  workspaceId,
  items,
  onSaved,
}: {
  workspaceId: string | null;
  items: ReturnType<typeof asLabels>;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <Pane title="标签" description="工作区标签可以打在事项上。">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!workspaceId || !name.trim()) return;
          void submit({ type: "CreateLabel", workspace_id: workspaceId, name: name.trim() }).then(() => {
            setName("");
            onSaved();
          });
        }}
      >
        <Input placeholder="标签名" value={name} onChange={(event) => setName(event.target.value)} />
        <Button type="submit">添加</Button>
      </form>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有标签。</p>
      ) : (
        items.map((item) => (
          <div key={item.name} className="flex items-center justify-between border-b border-border py-2">
            <span className="text-sm">{item.name}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={!workspaceId}
              onClick={() => {
                if (!workspaceId) return;
                void submit({ type: "DeleteLabel", workspace_id: workspaceId, name: item.name }).then(onSaved);
              }}
            >
              删除
            </Button>
          </div>
        ))
      )}
    </Pane>
  );
}

function InstallCliButton() {
  const [notice, setNotice] = useState("");
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        onClick={async () => {
          const result = await window.coordy.installCli();
          setNotice(result.message);
        }}
      >
        安装命令行
      </Button>
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
    </div>
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
