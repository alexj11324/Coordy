import { create } from "zustand";
import type { IssueCreateMode } from "../lib/coordy/issue-create";

const STORAGE_KEY = "coordy.sidebar-collapsed";
const CREATE_MODE_KEY = "coordy.create-mode";

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

function readLastCreateMode(): IssueCreateMode {
  if (typeof window === "undefined") return "agent";
  return window.localStorage.getItem(CREATE_MODE_KEY) === "manual" ? "manual" : "agent";
}

export type PendingFocus =
  | "new-task"
  | "new-squad"
  | "new-project"
  | "new-automation"
  | "new-skill"
  | "new-chat";

export type ChatDock = "closed" | "open" | "minimized";

type LayoutState = {
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  pendingFocus: PendingFocus | null;
  issueComposerOpen: boolean;
  issueComposerStatus: string;
  issueComposerForceManual: boolean;
  lastCreateMode: IssueCreateMode;
  chatDock: ChatDock;
  chatExpanded: boolean;
  activeChatId: string | null;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setPaletteOpen: (open: boolean) => void;
  requestNewTaskFocus: () => void;
  openIssueComposer: (status?: string) => void;
  closeIssueComposer: () => void;
  setLastCreateMode: (mode: IssueCreateMode) => void;
  requestFocus: (focus: PendingFocus) => void;
  consumePendingFocus: () => PendingFocus | null;
  openChatDock: (chatId?: string | null) => void;
  startNewChat: () => void;
  closeChatDock: () => void;
  minimizeChatDock: () => void;
  toggleChatDock: () => void;
  toggleChatExpanded: () => void;
  setActiveChatId: (chatId: string | null) => void;
};

export const useLayoutStore = create<LayoutState>((set, get) => ({
  sidebarCollapsed: readCollapsed(),
  paletteOpen: false,
  pendingFocus: null,
  issueComposerOpen: false,
  issueComposerStatus: "open",
  issueComposerForceManual: false,
  lastCreateMode: readLastCreateMode(),
  chatDock: "closed",
  chatExpanded: false,
  activeChatId: null,
  setSidebarCollapsed: (collapsed) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    }
    set({ sidebarCollapsed: collapsed });
  },
  toggleSidebar: () => get().setSidebarCollapsed(!get().sidebarCollapsed),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  requestNewTaskFocus: () =>
    set({
      pendingFocus: "new-task",
      issueComposerOpen: true,
      issueComposerStatus: "open",
      issueComposerForceManual: false,
    }),
  openIssueComposer: (status) => {
    const seeded = status?.trim() ?? "";
    set({
      issueComposerOpen: true,
      issueComposerStatus: seeded || "open",
      issueComposerForceManual: Boolean(seeded),
    });
  },
  closeIssueComposer: () => set({ issueComposerOpen: false, issueComposerForceManual: false }),
  setLastCreateMode: (mode) => {
    if (typeof window !== "undefined") window.localStorage.setItem(CREATE_MODE_KEY, mode);
    set({ lastCreateMode: mode });
  },
  requestFocus: (focus) => {
    if (focus === "new-task") {
      set({
        pendingFocus: focus,
        issueComposerOpen: true,
        issueComposerStatus: "open",
        issueComposerForceManual: false,
      });
      return;
    }
    if (focus === "new-chat") {
      set({ pendingFocus: focus, chatDock: "open", chatExpanded: false, activeChatId: null });
      return;
    }
    set({ pendingFocus: focus });
  },
  openChatDock: (chatId) =>
    set({
      chatDock: "open",
      chatExpanded: false,
      activeChatId: chatId === undefined ? get().activeChatId : chatId,
    }),
  startNewChat: () =>
    set({
      pendingFocus: null,
      chatDock: "open",
      chatExpanded: false,
      activeChatId: null,
    }),
  closeChatDock: () => set({ chatDock: "closed", chatExpanded: false }),
  minimizeChatDock: () => set({ chatDock: "minimized", chatExpanded: false }),
  toggleChatDock: () =>
    set({
      chatDock: get().chatDock === "open" ? "closed" : "open",
      chatExpanded: get().chatDock === "open" ? false : get().chatExpanded,
    }),
  toggleChatExpanded: () => set({ chatExpanded: !get().chatExpanded }),
  setActiveChatId: (chatId) => set({ activeChatId: chatId }),
  consumePendingFocus: () => {
    const next = get().pendingFocus;
    if (next) set({ pendingFocus: null });
    return next;
  },
}));
