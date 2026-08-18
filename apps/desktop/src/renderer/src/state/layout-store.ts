import { create } from "zustand";

const STORAGE_KEY = "coordy.sidebar-collapsed";

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

type LayoutState = {
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  pendingFocus: "new-task" | null;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setPaletteOpen: (open: boolean) => void;
  requestNewTaskFocus: () => void;
  consumePendingFocus: () => "new-task" | null;
};

export const useLayoutStore = create<LayoutState>((set, get) => ({
  sidebarCollapsed: readCollapsed(),
  paletteOpen: false,
  pendingFocus: null,
  setSidebarCollapsed: (collapsed) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    }
    set({ sidebarCollapsed: collapsed });
  },
  toggleSidebar: () => get().setSidebarCollapsed(!get().sidebarCollapsed),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  requestNewTaskFocus: () => set({ pendingFocus: "new-task" }),
  consumePendingFocus: () => {
    const next = get().pendingFocus;
    if (next) set({ pendingFocus: null });
    return next;
  },
}));
