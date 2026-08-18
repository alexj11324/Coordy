import { create } from "zustand";
import {
  canGoBack,
  canGoForward,
  emptyHistory,
  historyBack,
  historyForward,
  recordVisit,
  type NavHistory,
} from "../lib/coordy/nav-history";

type NavHistoryState = {
  history: NavHistory;
  record: (path: string) => void;
  back: () => string | null;
  forward: () => string | null;
};

export const useNavHistoryStore = create<NavHistoryState>((set, get) => ({
  history: emptyHistory("/"),
  record: (path) => set({ history: recordVisit(get().history, path) }),
  back: () => {
    const next = historyBack(get().history);
    if (!next) return null;
    set({ history: next.history });
    return next.path;
  },
  forward: () => {
    const next = historyForward(get().history);
    if (!next) return null;
    set({ history: next.history });
    return next.path;
  },
}));

export function useNavHistoryFlags() {
  const history = useNavHistoryStore((s) => s.history);
  return {
    canBack: canGoBack(history),
    canForward: canGoForward(history),
  };
}
