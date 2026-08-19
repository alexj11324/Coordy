export const PROJECT_STATUS_ITEMS: Record<string, string> = {
  planned: "规划中",
  active: "进行中",
  paused: "暂停",
  done: "已完成",
};

export const AUTOMATION_SCHEDULE_ITEMS: Record<string, string> = {
  none: "手动触发",
  "every:30m": "每 30 分钟",
  "every:1h": "每小时",
  "every:1d": "每天",
};

export const PROJECT_ICON_PRESETS = ["📁", "🧭", "🧪", "🚀", "🛠", "📚"] as const;

export type AutomationStarterId = "daily-digest" | "backlog-triage" | "doc-gaps";

export type AutomationStarter = {
  id: AutomationStarterId;
  title: string;
  summary: string;
  runbook: string;
  schedule: string;
  createIssue: boolean;
};

export const AUTOMATION_STARTERS: AutomationStarter[] = [
  {
    id: "daily-digest",
    title: "每日进度汇总",
    summary: "每天汇总已完成、进行中与受阻事项。",
    schedule: "every:1d",
    createIssue: true,
    runbook: [
      "1. 列出本工作区过去 24 小时内变为「已完成」的事项",
      "2. 列出当前「进行中」与「受阻」事项及负责人",
      "3. 用短条目汇总：完成、进行中、受阻",
      "4. 将汇总写入本事项评论",
    ].join("\n"),
  },
  {
    id: "backlog-triage",
    title: "待办分拣",
    summary: "检查未排优先级的待规划事项并给出建议。",
    schedule: "every:1d",
    createIssue: true,
    runbook: [
      "1. 列出状态为「待规划」且尚未设置优先级的事项",
      "2. 根据标题与描述建议优先级（紧急 / 高 / 中 / 低）",
      "3. 为每条写一句下一步建议",
      "4. 将评估写入本事项评论",
    ].join("\n"),
  },
  {
    id: "doc-gaps",
    title: "文档缺口",
    summary: "对照近期已完成事项，标出缺少说明的条目。",
    schedule: "every:1d",
    createIssue: true,
    runbook: [
      "1. 查看本工作区近期已完成事项",
      "2. 标出可能缺少说明或验收标准的条目",
      "3. 列出建议补充的文档要点",
      "4. 将缺口清单写入本事项评论",
    ].join("\n"),
  },
];

export function projectStatusLabel(status: string | undefined): string {
  const key = status?.trim() || "planned";
  return PROJECT_STATUS_ITEMS[key] ?? key;
}

export function projectStatusDotClass(status: string | undefined): string {
  switch (status) {
    case "active":
      return "bg-sky-500";
    case "paused":
      return "bg-amber-500";
    case "done":
      return "bg-emerald-500";
    default:
      return "bg-muted-foreground/40";
  }
}

export function scheduleLabel(schedule: string | undefined): string {
  const raw = schedule?.trim() ?? "";
  if (!raw) return AUTOMATION_SCHEDULE_ITEMS.none;
  const mapped = AUTOMATION_SCHEDULE_ITEMS[raw];
  if (mapped) return mapped;
  const rest = raw.toLowerCase().startsWith("every:") ? raw.slice("every:".length).trim() : "";
  const match = /^(\d+)([mhd])$/i.exec(rest);
  if (!match) return raw;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return raw;
  if (unit === "m") return n === 1 ? "每分钟" : `每 ${n} 分钟`;
  if (unit === "h") return n === 1 ? "每小时" : `每 ${n} 小时`;
  return n === 1 ? "每天" : `每 ${n} 天`;
}

export function automationModeLabel(createIssue: boolean | undefined): string {
  return createIssue ? "创建事项" : "仅触发";
}

export function projectIssueStats(
  tasks: { project_id?: string | null; status?: string }[],
  projectId: string,
): { total: number; done: number; progress: number } {
  const related = tasks.filter((task) => task.project_id === projectId);
  const done = related.filter((task) => task.status === "done").length;
  const total = related.length;
  return {
    total,
    done,
    progress: total === 0 ? 0 : Math.floor((done * 100) / total),
  };
}

export function formatRelativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso?.trim()) return "从未运行";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const delta = Math.abs(now - ms);
  if (delta < 60_000) return "刚刚";
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(ms).toLocaleDateString("zh-CN");
}

export function scheduleSelectItems(current: string | undefined): Record<string, string> {
  const items = { ...AUTOMATION_SCHEDULE_ITEMS };
  const key = current?.trim() && current !== "none" ? current.trim() : "";
  if (key && !(key in items)) items[key] = scheduleLabel(key);
  return items;
}

export function starterById(id: AutomationStarterId | null | undefined): AutomationStarter | null {
  if (!id) return null;
  return AUTOMATION_STARTERS.find((item) => item.id === id) ?? null;
}

export type SkillStarterId = "coordy-graph";

export type SkillStarter = {
  id: SkillStarterId;
  title: string;
  summary: string;
  body: string;
};

export const SKILL_STARTERS: SkillStarter[] = [
  {
    id: "coordy-graph",
    title: "协调图",
    summary: "按 Coordy 内核前缀声明目标、约束与依赖，供图模式投影。",
    body: [
      "在计划和评论中用内核可解析的前缀写结构化状态。绑定后下一次运行会注入本说明；不要写进 Codex / Claude Code 全局技能目录。",
      "",
      "适用：多智能体协作、跨任务依赖、改共享契约或仓库实体。",
      "",
      "开始前：先写当前目标与约束，再改代码。不要发明私有图语法。",
      "",
      "格式（每行一条）：",
      "GOAL: <当前目标>",
      "CONSTRAINT: <必须遵守的约束>",
      "DECISION: <已做决定>",
      "DEPENDS: <id 或 COOR-n> [entity]",
      "PLAN: <下一步计划>",
      "ACCEPTANCE: <怎样算完成>",
      "",
      "DEPENDS 第一段必须是内核能唯一解析的事项 id、智能体 id、契约 id 或编号（例如 task_… / COOR-12）。自由描述不会建边。第二段是实体，默认 repo。成功解析后写入 source→target 的 Consumes 边。",
      "",
      "边的方向是上游 source 到下游 target。改上游产物后，只失效 Consumes 且 source 等于变更节点的边。失效后须带当前 generation 确认（或移除后重规划）才能再跑；确认不会自动 StartRun。未指派执行者时内核不会开工。",
      "",
      "目标冲突、无法声明依赖、或必须打破 CONSTRAINT 时，停下来询问成员。",
    ].join("\n"),
  },
];

export function skillStarterById(id: SkillStarterId | null | undefined): SkillStarter | null {
  if (!id) return null;
  return SKILL_STARTERS.find((item) => item.id === id) ?? null;
}
