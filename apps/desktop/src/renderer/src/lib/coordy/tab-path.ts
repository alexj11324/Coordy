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
    case "/board":
      return "任务";
    case "/agents":
      return "智能体";
    case "/agents/new":
      return "创建智能体";
    case "/runtimes":
      return "运行时";
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
  if (pathname.startsWith("/agents/")) return "智能体";
  return pathname;
}

export function upsertTab(tabs: AppTab[], path: string): { tabs: AppTab[]; activeId: string } {
  const normalized = normalizePath(path);
  const existing = tabs.find((tab) => tab.path === normalized);
  if (existing) return { tabs, activeId: existing.id };
  const tab: AppTab = {
    id: normalized,
    path: normalized,
    title: titleFromPath(normalized),
  };
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

export function renameTab(tabs: AppTab[], path: string, title: string): AppTab[] {
  const normalized = normalizePath(path);
  const nextTitle = title.trim();
  if (!nextTitle) return tabs;
  return tabs.map((tab) => (tab.path === normalized ? { ...tab, title: nextTitle } : tab));
}

export function activePath(tabs: AppTab[], activeId: string): string {
  return tabs.find((tab) => tab.id === activeId)?.path ?? "/";
}
