import { create } from "zustand";
import {
  activePath,
  closeTab,
  normalizePath,
  openNewTab,
  renameTab,
  replaceActiveTab,
  titleFromPath,
  type AppTab,
} from "../lib/coordy/tab-path";

const STORAGE_KEY = "coordy.tabs.v2";

function homeTab(): AppTab {
  return { id: "/", path: "/", title: titleFromPath("/") };
}

function readTabs(): { tabs: AppTab[]; activeId: string } {
  if (typeof window === "undefined") {
    const home = homeTab();
    return { tabs: [home], activeId: home.id };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const home = homeTab();
      return { tabs: [home], activeId: home.id };
    }
    const parsed = JSON.parse(raw) as { tabs?: AppTab[]; activeId?: string };
    const tabs = (parsed.tabs ?? []).filter(
      (tab) => tab && typeof tab.id === "string" && typeof tab.path === "string" && typeof tab.title === "string",
    );
    if (tabs.length === 0) {
      const home = homeTab();
      return { tabs: [home], activeId: home.id };
    }
    const activeId = tabs.some((tab) => tab.id === parsed.activeId) ? parsed.activeId! : tabs[0]!.id;
    return { tabs, activeId };
  } catch {
    const home = homeTab();
    return { tabs: [home], activeId: home.id };
  }
}

function persist(tabs: AppTab[], activeId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId }));
}

type TabState = {
  tabs: AppTab[];
  activeId: string;
  sync: (path: string) => void;
  openNew: (path?: string) => string;
  activate: (id: string) => string;
  close: (id: string) => string;
  setTitle: (path: string, title: string) => void;
};

export const useTabStore = create<TabState>((set, get) => {
  const initial = readTabs();
  return {
    tabs: initial.tabs,
    activeId: initial.activeId,
    sync: (path) => {
      const next = replaceActiveTab(get().tabs, get().activeId, path);
      persist(next.tabs, next.activeId);
      set(next);
    },
    openNew: (path = "/") => {
      const next = openNewTab(get().tabs, path);
      persist(next.tabs, next.activeId);
      set(next);
      return next.tabs.find((tab) => tab.id === next.activeId)?.path ?? "/";
    },
    activate: (id) => {
      const tab = get().tabs.find((item) => item.id === id);
      if (!tab) return activePath(get().tabs, get().activeId);
      persist(get().tabs, tab.id);
      set({ activeId: tab.id });
      return tab.path;
    },
    close: (id) => {
      const next = closeTab(get().tabs, get().activeId, id);
      persist(next.tabs, next.activeId);
      set(next);
      return activePath(next.tabs, next.activeId);
    },
    setTitle: (path, title) => {
      const tabs = renameTab(get().tabs, normalizePath(path), title, get().activeId);
      persist(tabs, get().activeId);
      set({ tabs });
    },
  };
});
