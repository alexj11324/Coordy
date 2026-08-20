import type { AgentView, DiscoveredAgentView } from "@coordy/protocol";
import { describeActivity } from "./activity";
import { isPlaceholderHarness } from "./views";

export const SESSION_NOT_READY = "工作区尚未就绪。";
export const TASK_STATUS_ITEMS: Record<string, string> = {
  backlog: "待规划",
  open: "待办",
  running: "进行中",
  review: "审核中",
  blocked: "受阻",
  done: "已完成",
  cancelled: "已取消",
};

function latinNounGap(noun: string): string {
  return /^[A-Za-z]/.test(noun) ? " " : "";
}

export function emptyCreateHint(noun: string): string {
  return `暂无${latinNounGap(noun)}${noun}。`;
}

export function createActionLabel(noun: string): string {
  return `新建${latinNounGap(noun)}${noun}`;
}

/** Map Coordy harness / ACP ids onto Multica-style provider keys. */
export function canonicalHarnessId(harness: string): string {
  switch (harness) {
    case "claude-acp":
    case "claude_code":
    case "claude-code":
      return "claude";
    case "codebuddy-code":
      return "codebuddy";
    case "codex-acp":
      return "codex";
    case "github-copilot-cli":
      return "copilot";
    case "gemini-cli":
      return "gemini";
    case "grok-build":
      return "grok";
    case "pi-acp":
      return "pi";
    case "qwen-code":
      return "qwen";
    default:
      return harness;
  }
}

export function harnessIdsMatch(a: string, b: string): boolean {
  return canonicalHarnessId(a) === canonicalHarnessId(b);
}

export function catalogItemForHarness(
  catalog: DiscoveredAgentView[] | undefined,
  harness: string,
): DiscoveredAgentView | undefined {
  const want = canonicalHarnessId(harness);
  return catalog?.find((item) => canonicalHarnessId(item.id) === want);
}

export function providerKey(harness: string): string {
  switch (canonicalHarnessId(harness)) {
    case "claude":
      return "claude";
    case "codex":
      return "codex";
    case "gemini":
      return "gemini";
    case "copilot":
      return "copilot";
    case "opencode":
      return "opencode";
    case "cursor":
      return "cursor";
    case "coordy-stub":
    case "coordy":
      return "coordy";
    default:
      return harness;
  }
}

export function harnessLabel(harness: string): string {
  switch (canonicalHarnessId(harness)) {
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "gemini":
      return "Gemini CLI";
    case "copilot":
      return "GitHub Copilot";
    case "opencode":
      return "OpenCode";
    case "cursor":
      return "Cursor";
    case "codebuddy":
      return "CodeBuddy";
    case "deveco":
      return "DevEco Code";
    case "openclaw":
      return "OpenClaw";
    case "hermes":
      return "Hermes Agent";
    case "pi":
      return "Pi";
    case "omp":
      return "Oh My Pi";
    case "kimi":
      return "Kimi Code";
    case "reasonix":
      return "Reasonix";
    case "dsh":
      return "DeepSeek Harness";
    case "kiro":
      return "Kiro CLI";
    case "antigravity":
      return "Antigravity CLI";
    case "grok":
      return "Grok Build";
    case "qoder":
      return "Qoder";
    case "qoderclicn":
      return "Qoder CLI CN";
    case "traecli":
      return "TRAE CLI";
    case "qwen":
      return "Qwen Code";
    case "qwenpaw":
      return "QwenPaw";
    case "mcode":
      return "MiniMax Code";
    case "coordy-stub":
      return "Coordy 演示";
    case "acp":
    case "jsonl":
      return "未对应任何 CLI";
    default:
      return harness;
  }
}

export function agentDisplayName(
  agent: { name: string; harness: string },
  catalog?: DiscoveredAgentView[],
): string {
  if (agent.name.trim() && agent.name !== "助手" && agent.name !== "ACP") {
    return agent.name;
  }
  const discovered = catalogItemForHarness(catalog, agent.harness);
  if (discovered?.name) return discovered.name;
  if (isPlaceholderHarness(agent.harness)) return harnessLabel(agent.harness);
  return harnessLabel(agent.harness);
}

export function agentSubtitle(
  agent: { harness: string; description?: string },
  catalog?: DiscoveredAgentView[],
): string {
  if (agent.description?.trim()) return agent.description.trim();
  const discovered = catalogItemForHarness(catalog, agent.harness);
  if (isPlaceholderHarness(agent.harness)) {
    return "旧数据，无法对应具体工具";
  }
  const bits = [presenceLabel(agentPresence(agent, catalog))];
  bits.push(discovered?.name.trim() || harnessLabel(agent.harness));
  return bits.join(" · ");
}

export type AgentPresence = "online" | "offline" | "demo" | "unknown";

export function agentPresence(
  agent: { harness: string },
  catalog: DiscoveredAgentView[] | undefined,
): AgentPresence {
  if (isPlaceholderHarness(agent.harness)) return "unknown";
  if (agent.harness === "coordy-stub") return "demo";
  const item = catalogItemForHarness(catalog, agent.harness);
  if (item?.installed) return "online";
  return "offline";
}

export function presenceLabel(value: AgentPresence): string {
  switch (value) {
    case "online":
      return "在线";
    case "offline":
      return "离线";
    case "demo":
      return "演示";
    case "unknown":
      return "无法对应";
  }
}

export function listableAgents(agents: AgentView[]): AgentView[] {
  return agents.filter((agent) => !isPlaceholderHarness(agent.harness));
}

export function selectableRuntimes(
  catalog: DiscoveredAgentView[] | undefined,
): DiscoveredAgentView[] {
  return (catalog ?? []).filter(runtimeIsLaunchable);
}

export function runtimeIsLaunchable(
  item: DiscoveredAgentView | undefined,
): boolean {
  return runtimeReadiness(item).launchable;
}

export function initialRuntimeId(
  catalog: DiscoveredAgentView[] | undefined,
  requestedId?: string | null,
  savedId?: string | null,
): string {
  const selectable = selectableRuntimes(catalog);
  for (const candidate of [requestedId, savedId]) {
    if (!candidate) continue;
    const match = selectable.find((item) =>
      harnessIdsMatch(item.id, candidate),
    );
    if (match) return match.id;
  }
  return selectable[0]?.id ?? "";
}

export function pickerRuntimes(
  catalog: DiscoveredAgentView[] | undefined,
  selectedId?: string,
): DiscoveredAgentView[] {
  const visible = catalog ?? [];
  if (
    !selectedId ||
    visible.some((item) => harnessIdsMatch(item.id, selectedId))
  )
    return visible;
  const extra = catalogItemForHarness(catalog, selectedId);
  return extra ? [extra, ...visible] : visible;
}

export function osShortLabel(os?: string | null): string {
  if (os === "darwin") return "Mac";
  if (os === "win32") return "Windows";
  if (os === "linux") return "Linux";
  return os?.trim() || "";
}

/** Chip / dropdown title: provider identity only. */
export function runtimeChipLabel(
  item: { id: string; name: string },
  os?: string | null,
): string {
  void os;
  return item.name.trim() || harnessLabel(item.id);
}

export function runtimeSubtitle(item?: {
  command?: string;
  protocol_family?: string | null;
}): string {
  void item;
  return "";
}

export function runtimeReadinessLabel(item: {
  installed: boolean;
  launch_state?: string | null;
}): "已安装" | "未安装" {
  return runtimeReadiness(item).label;
}

export function runtimeReadiness(
  item: { installed: boolean; launch_state?: string | null } | undefined,
): {
  label: "已安装" | "未安装";
  tone: "green" | "red";
  launchable: boolean;
} {
  if (item?.installed) {
    return { label: "已安装", tone: "green", launchable: true };
  }
  return { label: "未安装", tone: "red", launchable: false };
}

export function healthLabel(status: string): string {
  if (status === "ok") return "在线";
  if (status === "connecting") return "连接中";
  return status;
}

export type LampTone = "green" | "yellow" | "red" | "gray";

/** Maps a Health query result to a lamp. Green only if the Unix socket round-trip succeeded. */
export function daemonConnectionStatus(input: {
  isError: boolean;
  status?: string | null;
}): { tone: LampTone; label: string } {
  if (input.isError) return { tone: "red", label: "离线" };
  if (!input.status) return { tone: "yellow", label: "连接中" };
  if (input.status === "ok")
    return { tone: "green", label: healthLabel(input.status) };
  if (input.status === "connecting")
    return { tone: "yellow", label: healthLabel(input.status) };
  return { tone: "red", label: healthLabel(input.status) };
}

export function presenceLampTone(presence: AgentPresence): LampTone {
  switch (presence) {
    case "online":
      return "green";
    case "demo":
      return "yellow";
    case "offline":
      return "red";
    case "unknown":
      return "gray";
  }
}

export function taskStatusLabel(status: string): string {
  return TASK_STATUS_ITEMS[status] ?? status;
}

export function runStatusLabel(status: string): string {
  switch (status) {
    case "running":
      return "进行中";
    case "completed":
      return "已结束";
    case "failed":
      return "失败";
    case "cancelled":
      return "已停止";
    case "paused":
      return "已暂停";
    case "queued":
      return "排队中";
    case "dispatched":
      return "已派发";
    case "waiting_local_directory":
      return "等待本机目录";
    case "deferred":
      return "已推迟";
    default:
      return status;
  }
}

export function eventKindLabel(kind: string): string {
  switch (kind) {
    case "message":
      return "消息";
    case "tool":
      return "工具调用";
    case "compaction":
      return "压缩";
    case "patch":
      return "补丁";
    default:
      return kind;
  }
}

export function formatActivity(event: { kind: string; payload: string }): {
  label: string;
  body: string;
} {
  const described = describeActivity(event);
  if (described.tone === "message") {
    return { label: described.label, body: described.body };
  }
  return { label: described.title, body: described.detail ?? "" };
}

export function memoryVisibilityLabel(value: string): string {
  if (value === "principal") return "仅本人可见";
  if (value === "agent_private") return "仅智能体可见";
  return value;
}

export function memoryStatusLabel(value: string): string {
  if (value === "active") return "有效";
  if (value === "proposed_share") return "待接收";
  if (value === "published") return "已发布";
  return value;
}

export function contractStatusLabel(value: string): string {
  if (value === "proposed") return "待批准";
  if (value === "active") return "已生效";
  return value;
}

export function inboxKindLabel(kind: string): string {
  switch (kind) {
    case "action_gate":
      return "操作门禁";
    case "causal_prelabel":
      return "因果预标";
    case "pause":
      return "已暂停";
    case "replan":
      return "需要重规划";
    case "drift":
      return "计划与约定不一致";
    case "assignment":
      return "指派";
    case "mention":
      return "提及";
    case "comment":
      return "评论";
    case "status":
      return "状态变更";
    case "priority":
      return "优先级变更";
    case "date":
      return "日期变更";
    case "agent_failed":
      return "智能体失败";
    case "automation":
      return "自动化";
    default:
      return kind;
  }
}

export function entityLabel(entity: string): string {
  if (entity === "repo") return "仓库";
  if (entity === "folder") return "目录";
  return entity;
}

export function authorityLabel(value: string): string {
  if (value === "USER") return "用户";
  if (value === "AGENT") return "智能体";
  return value;
}

export function commitmentStatusLabel(value: string): string {
  if (value === "ACTIVE") return "有效";
  return value;
}
