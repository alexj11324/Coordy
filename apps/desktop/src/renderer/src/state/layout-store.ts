import { create } from "zustand";

const STORAGE_KEY = "coordy.sidebar-collapsed";

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
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
  chatDock: ChatDock;
  activeChatId: string | null;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setPaletteOpen: (open: boolean) => void;
  requestNewTaskFocus: () => void;
  openIssueComposer: (status?: string) => void;
  closeIssueComposer: () => void;
  requestFocus: (focus: PendingFocus) => void;
  consumePendingFocus: () => PendingFocus | null;
  openChatDock: (chatId?: string | null) => void;
  closeChatDock: () => void;
  minimizeChatDock: () => void;
  toggleChatDock: () => void;
  setActiveChatId: (chatId: string | null) => void;
};

export const useLayoutStore = create<LayoutState>((set, get) => ({
  sidebarCollapsed: readCollapsed(),
  paletteOpen: false,
  pendingFocus: null,
  issueComposerOpen: false,
  issueComposerStatus: "open",
  chatDock: "closed",
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
    set({ pendingFocus: "new-task", issueComposerOpen: true, issueComposerStatus: "open" }),
  openIssueComposer: (status) =>
    set({ issueComposerOpen: true, issueComposerStatus: status?.trim() || "open" }),
  closeIssueComposer: () => set({ issueComposerOpen: false }),
  requestFocus: (focus) => {
    if (focus === "new-task") {
      set({ pendingFocus: focus, issueComposerOpen: true, issueComposerStatus: "open" });
      return;
    }
    if (focus === "new-chat") {
      set({ pendingFocus: focus, chatDock: "open" });
      return;
    }
    set({ pendingFocus: focus });
  },
  openChatDock: (chatId) =>
    set({
      chatDock: "open",
      activeChatId: chatId === undefined ? get().activeChatId : chatId,
    }),
  closeChatDock: () => set({ chatDock: "closed" }),
  minimizeChatDock: () => set({ chatDock: "minimized" }),
  toggleChatDock: () =>
    set({ chatDock: get().chatDock === "open" ? "closed" : "open" }),
  setActiveChatId: (chatId) => set({ activeChatId: chatId }),
  consumePendingFocus: () => {
    const next = get().pendingFocus;
    if (next) set({ pendingFocus: null });
    return next;
  },
}));
