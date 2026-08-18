import type { AgentView, DiscoveredAgentView } from "@coordy/protocol";
import { isPlaceholderHarness } from "./views";

/** Status words follow Multica's issue status meanings. */
export const TASK_STATUS_ITEMS: Record<string, string> = {
  backlog: "待办箱",
  open: "待办",
  running: "进行中",
  review: "待验收",
  blocked: "暂时做不了",
  done: "已完成",
  cancelled: "不做了",
};

/** Map Coordy harness / ACP ids onto Multica-style provider keys. */
export function providerKey(harness: string): string {
  switch (harness) {
    case "claude-acp":
    case "claude":
      return "claude";
    case "codex-acp":
    case "codex":
      return "codex";
    case "gemini":
      return "gemini";
    case "github-copilot-cli":
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
  switch (harness) {
    case "claude-acp":
      return "Claude Code";
    case "codex-acp":
      return "Codex";
    case "gemini":
      return "Gemini CLI";
    case "github-copilot-cli":
      return "GitHub Copilot";
    case "opencode":
      return "OpenCode";
    case "cursor":
      return "Cursor";
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
  const discovered = catalog?.find((item) => item.id === agent.harness);
  if (discovered?.name) return discovered.name;
  if (isPlaceholderHarness(agent.harness)) return harnessLabel(agent.harness);
  return harnessLabel(agent.harness);
}

export function agentSubtitle(
  agent: { harness: string; description?: string },
  catalog?: DiscoveredAgentView[],
): string {
  if (agent.description?.trim()) return agent.description.trim();
  const discovered = catalog?.find((item) => item.id === agent.harness);
  if (isPlaceholderHarness(agent.harness)) {
    return "旧数据，无法对应具体工具";
  }
  const bits = [presenceLabel(agentPresence(agent, catalog))];
  if (discovered?.command) bits.push(discovered.command);
  else bits.push(harnessLabel(agent.harness));
  return bits.join(" · ");
}

export type AgentPresence = "online" | "offline" | "demo" | "unknown";

export function agentPresence(
  agent: { harness: string },
  catalog: DiscoveredAgentView[] | undefined,
): AgentPresence {
  if (isPlaceholderHarness(agent.harness)) return "unknown";
  if (agent.harness === "coordy-stub") return "demo";
  const item = catalog?.find((entry) => entry.id === agent.harness);
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

export function selectableRuntimes(catalog: DiscoveredAgentView[] | undefined): DiscoveredAgentView[] {
  return (catalog ?? []).filter((item) => item.installed);
}

export function pickerRuntimes(
  catalog: DiscoveredAgentView[] | undefined,
  selectedId?: string,
): DiscoveredAgentView[] {
  const installed = selectableRuntimes(catalog);
  if (!selectedId || installed.some((item) => item.id === selectedId)) return installed;
  const extra = catalog?.find((item) => item.id === selectedId);
  return extra ? [extra, ...installed] : installed;
}

export function healthLabel(status: string): string {
  if (status === "ok") return "在线";
  if (status === "connecting") return "正在连接";
  return status;
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
      return "已派出";
    case "waiting_local_directory":
      return "等本机目录";
    case "deferred":
      return "已推迟";
    default:
      return status;
  }
}

export function eventKindLabel(kind: string): string {
  switch (kind) {
    case "message":
      return "留言";
    case "tool":
      return "执行";
    case "compaction":
      return "整理";
    case "patch":
      return "改文件";
    default:
      return kind;
  }
}

export function formatActivity(event: { kind: string; payload: string }): { label: string; body: string } {
  if (event.kind === "message") {
    const idx = event.payload.indexOf(": ");
    if (idx > 0) {
      const role = event.payload.slice(0, idx);
      const body = event.payload.slice(idx + 2);
      if (role === "user") return { label: "你", body };
      if (role === "assistant") return { label: "智能体", body };
      if (role === "system") return { label: "系统", body };
      return { label: role, body };
    }
  }
  if (event.kind === "tool" && event.payload.startsWith("coordy.session")) {
    return { label: "系统", body: "这一轮结束了" };
  }
  return { label: eventKindLabel(event.kind), body: event.payload };
}

export function memoryVisibilityLabel(value: string): string {
  if (value === "principal") return "只有我可见";
  if (value === "agent_private") return "只有智能体可见";
  return value;
}

export function memoryStatusLabel(value: string): string {
  if (value === "active") return "已记下";
  if (value === "proposed_share") return "等人收下";
  if (value === "published") return "已公开";
  return value;
}

export function contractStatusLabel(value: string): string {
  if (value === "proposed") return "等人点头";
  if (value === "active") return "已生效";
  return value;
}

export function inboxKindLabel(kind: string): string {
  switch (kind) {
    case "action_gate":
      return "被拦住了";
    case "causal_prelabel":
      return "需要你看一眼";
    case "pause":
      return "先停一下";
    case "replan":
      return "需要重做计划";
    case "drift":
      return "计划和约定不一致";
    case "assignment":
      return "指派";
    case "mention":
      return "提到你";
    case "comment":
      return "评论";
    case "status":
      return "状态变了";
    case "priority":
      return "优先级变了";
    case "date":
      return "日期变了";
    case "agent_failed":
      return "智能体失败";
    case "automation":
      return "自动化";
    default:
      return kind;
  }
}

export function entityLabel(entity: string): string {
  if (entity === "repo") return "这个项目";
  if (entity === "folder") return "这个文件夹";
  return entity;
}

export function authorityLabel(value: string): string {
  if (value === "USER") return "你定的";
  if (value === "AGENT") return "智能体提的";
  return value;
}

export function commitmentStatusLabel(value: string): string {
  if (value === "ACTIVE") return "有效";
  return value;
}
