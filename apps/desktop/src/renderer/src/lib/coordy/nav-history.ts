export type NavHistory = {
  stack: string[];
  index: number;
};

export function emptyHistory(path = "/"): NavHistory {
  return { stack: [path], index: 0 };
}

export function recordVisit(history: NavHistory, path: string): NavHistory {
  const current = history.stack[history.index];
  if (current === path) return history;
  const kept = history.stack.slice(0, history.index + 1);
  kept.push(path);
  const stack = kept.length > 80 ? kept.slice(kept.length - 80) : kept;
  return { stack, index: stack.length - 1 };
}

export function historyBack(history: NavHistory): { history: NavHistory; path: string } | null {
  if (history.index <= 0) return null;
  const index = history.index - 1;
  const path = history.stack[index];
  if (!path) return null;
  return { history: { stack: history.stack, index }, path };
}

export function historyForward(history: NavHistory): { history: NavHistory; path: string } | null {
  if (history.index >= history.stack.length - 1) return null;
  const index = history.index + 1;
  const path = history.stack[index];
  if (!path) return null;
  return { history: { stack: history.stack, index }, path };
}

export function canGoBack(history: NavHistory): boolean {
  return history.index > 0;
}

export function canGoForward(history: NavHistory): boolean {
  return history.index < history.stack.length - 1;
}
