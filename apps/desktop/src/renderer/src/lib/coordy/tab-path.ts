export type AppTab = {
  id: string;
  path: string;
  title: string;
};

export function normalizePath(path: string): string {
  const raw = path.trim() || "/";
  const [pathnamePart, searchPart] = raw.split("?");
  const pathname = (pathnamePart || "/").replace(/\/+$/, "") || "/";
  return searchPart ? `${pathname}?${searchPart}` : pathname;
}

export function titleFromPath(path: string): string {
  const pathname = normalizePath(path).split("?")[0] ?? "/";
  switch (pathname) {
    case "/":
      return "开始";
    case "/inbox":
      return "收件箱";
    case "/chat":
      return "聊天";
    case "/mine":
      return "我的任务";
    case "/board":
      return "任务";
    case "/projects":
      return "项目";
    case "/automations":
      return "自动化";
    case "/squads":
      return "小队";
    case "/stats":
      return "统计";
    case "/skills":
      return "Skills";
    case "/agents":
      return "智能体";
    case "/agents/new":
    case "/agents/new/blank":
    case "/agents/new/ai":
      return "创建智能体";
    case "/harnesses":
    case "/runtimes":
      return "Harness";
    case "/settings":
      return "设置";
    case "/runs":
      return "动态";
    case "/principals":
      return "成员";
    case "/authority":
      return "权限";
    case "/memory":
      return "备忘";
    case "/contracts":
      return "约定";
    case "/dependencies":
      return "关联";
    case "/conflicts":
      return "冲突";
    default:
      break;
  }
  if (pathname.startsWith("/board/")) return "事项";
  if (pathname.startsWith("/agents/new/")) return "创建智能体";
  if (pathname.startsWith("/agents/")) return "智能体";
  if (pathname.startsWith("/projects/")) return "项目";
  if (pathname.startsWith("/automations/")) return "自动化";
  if (pathname.startsWith("/skills/")) return "Skills";
  if (pathname.startsWith("/squads/")) return "小队";
  return pathname;
}

function makeTab(path: string, id?: string): AppTab {
  const normalized = normalizePath(path);
  return {
    id: id ?? normalized,
    path: normalized,
    title: titleFromPath(normalized),
  };
}

function newTabId(): string {
  return `tab:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

/** Sidebar / in-app navigation: keep tab count, rewrite the active tab. */
export function replaceActiveTab(
  tabs: AppTab[],
  activeId: string,
  path: string,
): { tabs: AppTab[]; activeId: string } {
  const normalized = normalizePath(path);
  if (tabs.length === 0) {
    const tab = makeTab(normalized);
    return { tabs: [tab], activeId: tab.id };
  }
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0]!;
  if (active.path === normalized) return { tabs, activeId: active.id };
  return {
    tabs: tabs.map((tab) =>
      tab.id === active.id ? { ...tab, path: normalized, title: titleFromPath(normalized) } : tab,
    ),
    activeId: active.id,
  };
}

/** Only the + control and Mod+T create a tab. */
export function openNewTab(tabs: AppTab[], path = "/"): { tabs: AppTab[]; activeId: string } {
  const tab = makeTab(path, newTabId());
  return { tabs: [...tabs, tab], activeId: tab.id };
}

export function closeTab(
  tabs: AppTab[],
  activeId: string,
  id: string,
): { tabs: AppTab[]; activeId: string } {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return { tabs, activeId };
  if (tabs.length === 1) {
    const home: AppTab = { id: "/", path: "/", title: titleFromPath("/") };
    return { tabs: [home], activeId: home.id };
  }
  const next = tabs.filter((tab) => tab.id !== id);
  if (activeId !== id) return { tabs: next, activeId };
  const neighbor = next[index] ?? next[index - 1] ?? next[0];
  return { tabs: next, activeId: neighbor?.id ?? "/" };
}

export function renameTab(tabs: AppTab[], path: string, title: string, activeId?: string): AppTab[] {
  const normalized = normalizePath(path);
  const nextTitle = title.trim();
  if (!nextTitle) return tabs;
  const target =
    (activeId ? tabs.find((tab) => tab.id === activeId && tab.path === normalized) : undefined) ??
    tabs.find((tab) => tab.path === normalized);
  if (!target) return tabs;
  return tabs.map((tab) => (tab.id === target.id ? { ...tab, title: nextTitle } : tab));
}

export function activePath(tabs: AppTab[], activeId: string): string {
  return tabs.find((tab) => tab.id === activeId)?.path ?? "/";
}
