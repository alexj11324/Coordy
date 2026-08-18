export type ShortcutAction =
  | "search"
  | "new-task"
  | "toggle-sidebar"
  | "toggle-chat"
  | "new-tab"
  | "close-tab";

export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(target.closest("[contenteditable='true'], [role='textbox']"));
}

export function modifierSymbol(os?: string): string {
  return os === "darwin" ? "⌘" : "Ctrl";
}

export function matchShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  target?: EventTarget | null;
}): ShortcutAction | null {
  if (event.isComposing) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const mod = event.metaKey || event.ctrlKey;
  if (event.altKey) return null;
  if (mod && key === "k") return "search";
  if (mod && key === "b") return "toggle-sidebar";
  if (mod && key === "j") return "toggle-chat";
  if (mod && key === "t") return "new-tab";
  if (mod && key === "w") return "close-tab";
  if (mod) return null;
  if (isTypingTarget(event.target ?? null)) return null;
  if (key === "c") return "new-task";
  return null;
}
