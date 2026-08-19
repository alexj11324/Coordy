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
import {
  formatShortcut,
  modifierSymbol as shortcutMod,
  SHORTCUT_CATEGORIES,
  SHORTCUTS,
} from "../lib/coordy/shortcuts";
import {
  asAccount,
  asAgents,
  asComputers,
  asHealth,
  asLabels,
  asPrincipals,
  asWorkspace,
  asWorkspaces,
} from "../lib/coordy/views";
import { StatusLamp } from "./status-lamp";
import { useSession } from "../state/session-store";
import { applyTheme, FONT_SIZE_OPTIONS, useThemeStore, type ThemePreference } from "../state/theme-store";

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
  { id: "cloud", label: "云通道", icon: Plug },
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
  { id: "system", label: "跟随系统", hint: "与操作系统外观一致" },
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
  const tab: SettingsTab =
    raw === "github" || raw === "integrations"
      ? "cloud"
      : isSettingsTab(raw)
        ? raw
        : "profile";
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
      return <ShortcutsPane os={info?.os} />;
    case "issue":
      return (
        <Pane title="任务" description="看板列与优先级由 Coordy 内置，不支持自定义工作流引擎。">
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
        <Pane title="聊天" description="右下角悬浮窗调用 CreateChat / SendChatMessage，不打开浏览器页面。">
          <p className="text-sm text-muted-foreground">
            {mod}+J 显示或隐藏悬浮聊天。带 chat 标签的任务不进入看板。
          </p>
          {listableAgents(asAgents(agents.data)).length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无智能体。悬浮聊天会提示先创建智能体。</p>
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
          hostname={info?.hostname}
          workspaceId={workspaceId}
        />
      );
    case "updates":
      return (
        <Pane title="更新" description="当前为本机构建，没有应用商店更新通道。">
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
        <Pane title="代码仓库" description="绑定本机目录。智能体在该目录中执行，路径不会上传。">
          <p className="text-sm">{repoPath ?? "未绑定"}</p>
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
    case "cloud":
      return (
        <Pane title="云通道" description="本机桌面不提供云通道，也不假装有 OAuth 或公网入站。">
          <p className="text-sm text-muted-foreground">
            不提供 GitHub App、Pull Request 侧栏、CI，也不提供飞书 / Slack / 钉钉 / 企业微信。仓库绑定入口位于「代码仓库」。模型密钥位于「模型密钥」。
          </p>
        </Pane>
      );
    case "labs":
      return (
        <Pane title="实验室" description="顾问不得提交状态变更；确定性门禁始终启用。">
          <Row label="可选 LLM 顾问" hint="仅提供建议，不可提交 commit。">
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
        <Pane title="属性" description="内核可保存自定义字段定义，但事项创建与详情尚未读写该字段，因此本页不提供编辑入口。">
          <p className="text-sm text-muted-foreground">事项页接入自定义字段后，再在此管理字段定义。</p>
        </Pane>
      );
    case "quick_actions":
      return (
        <Pane title="快捷操作" description="Coordy 使用命令面板，不提供云端工作流按钮。">
          <ShortcutRow keys={`${mod}K`} action="搜索 / 命令面板" />
          <ShortcutRow keys="C" action="新建任务" />
          <ShortcutRow keys={`${mod}J`} action="显示或隐藏悬浮聊天" />
          <p className="pt-2 text-sm text-muted-foreground">也可通过命令面板新建智能体、小队、项目、自动化和 Skill。</p>
        </Pane>
      );
    case "mcp":
      return (
        <Pane title="MCP" description="原生 CLI harness 读取各自的 MCP 配置。ACP 家族的 session/new 仍发送空的 mcpServers，Coordy 不注入、不托管 MCP。">
          <p className="text-sm text-muted-foreground">
            因此本页不提供可保存的 MCP 配置。请在对应 CLI 的配置文件中管理服务器，例如 Claude Code 的 ~/.claude.json、Codex 的 ~/.codex/config.toml。
          </p>
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
  hostname,
  workspaceId,
}: {
  live: ReturnType<typeof asHealth>;
  isError: boolean;
  os?: string;
  hostname?: string;
  workspaceId: string | null;
}) {
  const computers = useQuery({
    queryKey: ["view", { type: "Computers", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Computers", workspace_id: workspaceId! }),
  });
  const conn = daemonConnectionStatus({ isError, status: live?.status });
  const host = hostname?.trim() || osShortLabel(os) || "本机";
  const registered = asComputers(computers.data);
  return (
    <Pane
      title="Daemon"
      description="绿灯表示桌面当前可通过 Unix socket 完成对 coordyd 的 Health 查询。本机电脑在绿灯时登记到当前工作区。"
    >
      <Row
        label="本机"
        hint={
          conn.tone === "red"
            ? "Health 查询失败，coordyd 未响应。"
            : "本机 coordyd 进程"
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
      <div className="pt-4">
        <h3 className="mb-2 text-sm font-medium">已登记电脑</h3>
        {registered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Daemon 绿灯后会以主机名登记当前电脑。</p>
        ) : (
          <ul className="space-y-2">
            {registered.map((computer) => (
              <li key={computer.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                {computer.name}
                {computer.kind ? ` · ${computer.kind}` : ""}
                {computer.concurrency_limit ? ` · 并发 ${computer.concurrency_limit}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
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
    <Pane title="个人资料" description="名称保存在本机工作区成员表中，不是云账号。">
      <Row label="头像" hint="使用姓名首字母生成，不支持上传照片。">
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
  const fontSizePx = useThemeStore((s) => s.fontSizePx);
  const setFontSizePx = useThemeStore((s) => s.setFontSizePx);
  return (
    <Pane title="偏好设置" description="外观仅保存在本机。">
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
      <div>
        <Label>界面字号</Label>
        <p className="mt-1 text-xs text-muted-foreground">默认 18px。也可使用 Ctrl/⌘ +、−、0 调整。</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {FONT_SIZE_OPTIONS.map((item) => (
            <button
              key={item.px}
              type="button"
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                fontSizePx === item.px ? "border-foreground bg-muted/60" : "border-border hover:bg-muted/40",
              )}
              onClick={() => setFontSizePx(item.px)}
            >
              {item.label}
              <span className="ml-1 text-xs text-muted-foreground">{item.px}px</span>
            </button>
          ))}
        </div>
      </div>
      <Row label="语言" hint="当前版本仅提供简体中文。">
        <span className="text-sm">简体中文</span>
      </Row>
    </Pane>
  );
}

function ShortcutsPane({ os }: { os?: string }) {
  return (
    <Pane title="快捷键" description="在输入框内键入时，仅允许在编辑区触发的快捷键会生效。">
      {SHORTCUT_CATEGORIES.map((category) => (
        <div key={category.id} className="space-y-2">
          <h3 className="text-sm font-medium">{category.label}</h3>
          {SHORTCUTS.filter((item) => item.category === category.id).map((item) => (
            <ShortcutRow key={item.id} keys={formatShortcut(item.chord, os)} action={item.label} />
          ))}
        </div>
      ))}
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
    <Pane title="通知" description="这些开关仅影响收件箱写入，不会向操作系统发送推送。">
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
      setNotice("密钥已保存在本机，不会上传。");
      await qc.invalidateQueries({ queryKey: ["secrets"] });
    },
    onError: (err: unknown) => setNotice(err instanceof Error ? err.message : String(err)),
  });
  return (
    <Pane
      title="模型密钥"
      description="本机 harness 使用的模型密钥。不是云账号登录用的 API Token。"
    >
      <p className="text-sm text-muted-foreground">
        Coordy 没有云账号，也不会签发个人访问令牌。CLI 通过本机 Unix socket 通信。此处密钥写入本机 0600 文件，启动运行时注入环境变量，不写入 SQLite。
      </p>
      <div className="flex items-center gap-2 text-sm">
        {status?.key_configured ? <Badge>密钥已保存</Badge> : <Badge variant="secondary">未配置密钥</Badge>}
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
            placeholder={status?.key_configured ? "已保存，留空则保持原值" : "sk-…"}
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
    <Pane title="常规" description="工作区名称、智能体背景上下文与事项前缀保存在本机内核。">
      <div className="space-y-1.5">
        <Label htmlFor="ws-name">名称</Label>
        <Input id="ws-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ws-desc">说明</Label>
        <Textarea id="ws-desc" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ws-context">智能体背景上下文</Label>
        <Textarea
          id="ws-context"
          rows={5}
          value={context}
          onChange={(event) => setContext(event.target.value)}
          placeholder="启动运行时前置到指令。留空则不附加。"
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
        <p className="text-sm text-muted-foreground">暂无成员。</p>
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
    <Pane title="标签" description="工作区标签可附加到事项。">
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
        <p className="text-sm text-muted-foreground">暂无标签。</p>
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
