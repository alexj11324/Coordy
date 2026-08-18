import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { matchShortcut, SHORTCUT_PATHS } from "../lib/coordy/shortcuts";
import { useLayoutStore } from "../state/layout-store";
import { useNavHistoryStore } from "../state/nav-history-store";
import { useTabStore } from "../state/tab-store";
import { useThemeStore } from "../state/theme-store";

export function GlobalShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const paletteOpen = useLayoutStore.getState().paletteOpen;
      if (event.key === "Escape" && paletteOpen) {
        event.preventDefault();
        useLayoutStore.getState().setPaletteOpen(false);
        return;
      }
      const action = matchShortcut(event);
      if (!action) return;
      if (action === "search") {
        event.preventDefault();
        useLayoutStore.getState().setPaletteOpen(!paletteOpen);
        return;
      }
      if (paletteOpen) return;
      if (action === "new-task") {
        event.preventDefault();
        useLayoutStore.getState().requestNewTaskFocus();
        return;
      }
      if (action === "toggle-sidebar") {
        event.preventDefault();
        useLayoutStore.getState().toggleSidebar();
        return;
      }
      if (action === "toggle-chat") {
        event.preventDefault();
        useLayoutStore.getState().toggleChatDock();
        return;
      }
      if (action === "new-tab") {
        event.preventDefault();
        const path = useTabStore.getState().openNew("/");
        navigate(path);
        return;
      }
      if (action === "close-tab") {
        event.preventDefault();
        const next = useTabStore.getState().close(useTabStore.getState().activeId);
        navigate(next);
        return;
      }
      if (action === "go-back") {
        event.preventDefault();
        const path = useNavHistoryStore.getState().back();
        if (path) navigate(path);
        return;
      }
      if (action === "go-forward") {
        event.preventDefault();
        const path = useNavHistoryStore.getState().forward();
        if (path) navigate(path);
        return;
      }
      if (action === "zoom-in") {
        event.preventDefault();
        useThemeStore.getState().bumpFontSize(1);
        return;
      }
      if (action === "zoom-out") {
        event.preventDefault();
        useThemeStore.getState().bumpFontSize(-1);
        return;
      }
      if (action === "zoom-reset") {
        event.preventDefault();
        useThemeStore.getState().resetFontSize();
        return;
      }
      const path = SHORTCUT_PATHS[action];
      if (path) {
        event.preventDefault();
        navigate(path);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return null;
}
