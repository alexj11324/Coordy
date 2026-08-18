import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { matchShortcut } from "../lib/coordy/shortcuts";
import { useLayoutStore } from "../state/layout-store";
import { useTabStore } from "../state/tab-store";

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
      if (action === "toggle-chat") {
        event.preventDefault();
        useLayoutStore.getState().toggleChatDock();
        return;
      }
      if (action === "new-tab") {
        event.preventDefault();
        useTabStore.getState().ensure("/board");
        navigate("/board");
        return;
      }
      if (action === "close-tab") {
        event.preventDefault();
        const next = useTabStore.getState().close(useTabStore.getState().activeId);
        navigate(next);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return null;
}
