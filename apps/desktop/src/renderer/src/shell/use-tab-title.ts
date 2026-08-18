import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useTabStore } from "../state/tab-store";

export function useTabTitle(title: string | undefined) {
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;
  useEffect(() => {
    if (!title?.trim()) return;
    useTabStore.getState().setTitle(path, title);
  }, [path, title]);
}
