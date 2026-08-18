export type ShortcutAction =
  | "search"
  | "new-task"
  | "toggle-sidebar"
  | "toggle-chat"
  | "new-tab"
  | "close-tab"
  | "open-settings"
  | "go-back"
  | "go-forward"
  | "go-inbox"
  | "go-chat"
  | "go-mine"
  | "go-board"
  | "go-projects"
  | "go-automations"
  | "go-agents"
  | "go-squads"
  | "go-stats"
  | "go-harnesses"
  | "go-skills"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset";

export type ShortcutCategory = "general" | "navigation" | "fixed";

export type ShortcutChord = {
  key: string;
  mod?: boolean;
  shift?: boolean;
};

export type ShortcutDefinition = {
  id: ShortcutAction;
  category: ShortcutCategory;
  label: string;
  chord: ShortcutChord | null;
  allowInEditable: boolean;
};

const primary = (key: string, extra: Partial<ShortcutChord> = {}): ShortcutChord => ({
  key,
  mod: true,
  ...extra,
});

/** Product shortcuts. Navigation uses Mod+Shift+digit so they stay out of editor typing. */
export const SHORTCUTS: readonly ShortcutDefinition[] = [
  { id: "search", category: "general", label: "打开搜索", chord: primary("k"), allowInEditable: true },
  { id: "new-task", category: "general", label: "新建任务", chord: { key: "c" }, allowInEditable: false },
  { id: "toggle-sidebar", category: "general", label: "折叠或展开侧栏", chord: primary("b"), allowInEditable: false },
  { id: "toggle-chat", category: "general", label: "开关悬浮聊天", chord: primary("j"), allowInEditable: true },
  { id: "go-back", category: "navigation", label: "后退", chord: primary("["), allowInEditable: false },
  { id: "go-forward", category: "navigation", label: "前进", chord: primary("]"), allowInEditable: false },
  { id: "go-inbox", category: "navigation", label: "前往收件箱", chord: primary("1", { shift: true }), allowInEditable: false },
  { id: "go-chat", category: "navigation", label: "前往聊天", chord: primary("2", { shift: true }), allowInEditable: false },
  { id: "go-mine", category: "navigation", label: "前往我的任务", chord: primary("3", { shift: true }), allowInEditable: false },
  { id: "go-board", category: "navigation", label: "前往任务", chord: primary("4", { shift: true }), allowInEditable: false },
  { id: "go-projects", category: "navigation", label: "前往项目", chord: primary("5", { shift: true }), allowInEditable: false },
  { id: "go-automations", category: "navigation", label: "前往自动化", chord: primary("6", { shift: true }), allowInEditable: false },
  { id: "go-agents", category: "navigation", label: "前往智能体", chord: primary("7", { shift: true }), allowInEditable: false },
  { id: "go-squads", category: "navigation", label: "前往小队", chord: primary("8", { shift: true }), allowInEditable: false },
  { id: "go-stats", category: "navigation", label: "前往统计", chord: primary("9", { shift: true }), allowInEditable: false },
  { id: "go-harnesses", category: "navigation", label: "前往 Harness", chord: primary("h", { shift: true }), allowInEditable: false },
  { id: "go-skills", category: "navigation", label: "前往 Skills", chord: primary("l", { shift: true }), allowInEditable: false },
  { id: "new-tab", category: "fixed", label: "新标签页", chord: primary("t"), allowInEditable: true },
  { id: "close-tab", category: "fixed", label: "关闭当前标签页", chord: primary("w"), allowInEditable: true },
  { id: "open-settings", category: "fixed", label: "打开设置", chord: primary(","), allowInEditable: true },
  { id: "zoom-in", category: "fixed", label: "增大字号", chord: primary("="), allowInEditable: true },
  { id: "zoom-out", category: "fixed", label: "减小字号", chord: primary("-"), allowInEditable: true },
  { id: "zoom-reset", category: "fixed", label: "重置字号", chord: primary("0"), allowInEditable: true },
];

export const SHORTCUT_PATHS: Partial<Record<ShortcutAction, string>> = {
  "open-settings": "/settings",
  "go-inbox": "/inbox",
  "go-chat": "/chat",
  "go-mine": "/mine",
  "go-board": "/board",
  "go-projects": "/projects",
  "go-automations": "/automations",
  "go-agents": "/agents",
  "go-squads": "/squads",
  "go-stats": "/stats",
  "go-harnesses": "/harnesses",
  "go-skills": "/skills",
};

export const SHORTCUT_CATEGORIES: { id: ShortcutCategory; label: string }[] = [
  { id: "general", label: "通用" },
  { id: "navigation", label: "导航" },
  { id: "fixed", label: "固定" },
];

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

export function formatShortcut(chord: ShortcutChord | null, os?: string): string {
  if (!chord) return "未绑定";
  const key = displayKey(chord.key);
  if (os === "darwin") {
    return `${chord.mod ? "⌘" : ""}${chord.shift ? "⇧" : ""}${key}`;
  }
  return [chord.mod ? "Ctrl" : null, chord.shift ? "Shift" : null, key].filter(Boolean).join("+");
}

function displayKey(key: string): string {
  if (key === "=") return "+";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function logicalKey(event: { key: string; code?: string }): string {
  const code = event.code ?? "";
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (code === "BracketLeft") return "[";
  if (code === "BracketRight") return "]";
  if (code === "Comma") return ",";
  if (code === "Minus") return "-";
  if (code === "Equal" || code === "NumpadAdd") return "=";
  if (code === "NumpadSubtract") return "-";
  const key = event.key;
  if (key === "+" || key === "=") return "=";
  if (key.length === 1) return key.toLowerCase();
  return key;
}

export function matchShortcut(event: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  target?: EventTarget | null;
}): ShortcutAction | null {
  if (event.isComposing) return null;
  if (event.altKey) return null;
  const key = logicalKey(event);
  const mod = event.metaKey || event.ctrlKey;
  const shift = Boolean(event.shiftKey);
  const typing = isTypingTarget(event.target ?? null);
  for (const item of SHORTCUTS) {
    if (!item.chord) continue;
    if (Boolean(item.chord.mod) !== mod) continue;
    const shiftOk =
      Boolean(item.chord.shift) === shift || (item.id === "zoom-in" && key === "=");
    if (!shiftOk) continue;
    if (item.chord.key !== key) continue;
    if (typing && !item.allowInEditable) return null;
    return item.id;
  }
  return null;
}
