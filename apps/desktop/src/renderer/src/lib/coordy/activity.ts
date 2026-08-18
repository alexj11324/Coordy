import { HARNESS_SESSION_TOOL } from "@coordy/protocol";

export type ActivityIconName =
  | "pencil"
  | "fold"
  | "file"
  | "search"
  | "terminal"
  | "globe"
  | "folder"
  | "check"
  | "wrench";

export type DescribedActivity =
  | {
      tone: "message";
      role: string;
      label: string;
      body: string;
    }
  | {
      tone: "marker";
      icon: ActivityIconName;
      title: string;
      detail?: string;
      pending: boolean;
    };

type ToolClass = "edit" | "read" | "search" | "shell" | "web" | "list" | "session" | "other";

const STATUS_OUTPUTS = new Set([
  "pending",
  "in_progress",
  "inprogress",
  "running",
  "started",
  "none",
  "null",
  "completed",
  "success",
  "ok",
  "done",
]);

const TOOL_COPY: Record<ToolClass, { icon: ActivityIconName; title: string }> = {
  edit: { icon: "pencil", title: "编辑了文件" },
  read: { icon: "file", title: "读取了文件" },
  search: { icon: "search", title: "搜索了代码" },
  shell: { icon: "terminal", title: "执行了命令" },
  web: { icon: "globe", title: "访问了网页" },
  list: { icon: "folder", title: "查看了目录" },
  session: { icon: "check", title: "这一轮结束了" },
  other: { icon: "wrench", title: "调用了工具" },
};

/** Kernel stores tools as `{name} in={input} out={output} exit={exit_code:?}`. */
export function parseToolPayload(payload: string): {
  name: string;
  input: string;
  output: string;
  exit: string;
} {
  const inAt = payload.indexOf(" in=");
  const outAt = payload.indexOf(" out=");
  const exitAt = payload.lastIndexOf(" exit=");
  if (inAt <= 0 || outAt < inAt || exitAt < outAt) {
    return { name: payload.trim() || "tool", input: "", output: "", exit: "" };
  }
  return {
    name: payload.slice(0, inAt).trim() || "tool",
    input: payload.slice(inAt + " in=".length, outAt),
    output: payload.slice(outAt + " out=".length, exitAt),
    exit: payload.slice(exitAt + " exit=".length),
  };
}

function unwrapJsonString(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function soften(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_./:-]+/g, " ")
    .toLowerCase();
}

function isPendingOutput(output: string, exit: string): boolean {
  const status = unwrapJsonString(output).toLowerCase().replace(/[\s-]/g, "_");
  if (status === "" || status === "pending" || status === "in_progress" || status === "inprogress" || status === "running" || status === "started") {
    return exit === "None" || exit === "" || exit === "null";
  }
  return false;
}

function looksLikeStatusOnly(output: string): boolean {
  const status = unwrapJsonString(output).toLowerCase().replace(/[\s-]/g, "_");
  return status === "" || STATUS_OUTPUTS.has(status);
}

function firstPathish(value: unknown, depth = 0): string | undefined {
  if (depth > 3 || value == null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/[/\\]/.test(trimmed) || /\.[a-z0-9]{1,8}$/i.test(trimmed)) return trimmed;
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstPathish(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["path", "file", "file_path", "filePath", "target", "filename"]) {
      const found = firstPathish(record[key], depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function extractHint(raw: string): string | undefined {
  const text = unwrapJsonString(raw);
  if (!text) return undefined;
  try {
    const path = firstPathish(JSON.parse(text));
    if (path) return path;
  } catch {
    // not JSON
  }
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  if (firstLine.length > 0 && firstLine.length <= 80) return firstLine;
  return undefined;
}

function classifyTool(name: string, input: string): ToolClass {
  if (name === HARNESS_SESSION_TOOL || name.startsWith(`${HARNESS_SESSION_TOOL} `)) {
    return "session";
  }
  const hay = `${soften(name)} ${soften(input)}`;
  if (/(apply.?patch|str replace|search replace|write file|edit file|create file|overwrite|update file)/.test(hay)) {
    return "edit";
  }
  if (/\b(edited|wrote|writing|editing|patch|edit|write)\b/.test(hay) || /编辑/.test(name)) {
    return "edit";
  }
  if (/\b(grep|glob|rg|ripgrep|codebase search|semantic search|find|search)\b/.test(hay) || /搜索/.test(name)) {
    return "search";
  }
  if (/\b(read file|read|view|cat|open)\b/.test(hay) || /读取|打开/.test(name)) {
    return "read";
  }
  if (/\b(bash|shell|exec command|execute|terminal|command|ran)\b/.test(hay) || /执行|命令/.test(name)) {
    return "shell";
  }
  if (/\b(web search|web fetch|fetch|http|browser)\b/.test(hay) || /网页|网络/.test(name)) {
    return "web";
  }
  if (/\b(list dir|listdir|directory|ls)\b/.test(hay) || /目录|列出/.test(name)) {
    return "list";
  }
  return "other";
}

function alreadyQuietTitle(name: string): boolean {
  const title = name.trim();
  return title.length >= 2 && title.length <= 16 && /[\u4e00-\u9fff]/.test(title);
}

function clipDetail(value: string, max = 2000): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\n…`;
}

export function describeActivity(event: { kind: string; payload: string }): DescribedActivity {
  switch (event.kind) {
    case "message": {
      const idx = event.payload.indexOf(": ");
      if (idx > 0) {
        const role = event.payload.slice(0, idx);
        const body = event.payload.slice(idx + 2);
        if (role === "user") return { tone: "message", role, label: "你", body };
        if (role === "assistant") return { tone: "message", role, label: "智能体", body };
        if (role === "system") return { tone: "message", role, label: "系统", body };
        return { tone: "message", role, label: role, body };
      }
      return { tone: "message", role: "assistant", label: "智能体", body: event.payload };
    }
    case "compaction":
      return {
        tone: "marker",
        icon: "fold",
        title: "上下文已自动压缩",
        detail: clipDetail(event.payload),
        pending: false,
      };
    case "patch":
      return {
        tone: "marker",
        icon: "pencil",
        title: "编辑了文件",
        detail: clipDetail(event.payload),
        pending: false,
      };
    case "tool": {
      const parsed = parseToolPayload(event.payload);
      const cls = classifyTool(parsed.name, parsed.input);
      const copy = cls === "other" && alreadyQuietTitle(parsed.name) ? { icon: "wrench" as const, title: parsed.name.trim() } : TOOL_COPY[cls];
      const pending = isPendingOutput(parsed.output, parsed.exit);
      const detailParts: string[] = [];
      if (cls !== "session") {
        const hint = extractHint(parsed.input);
        const output = looksLikeStatusOnly(parsed.output) ? undefined : clipDetail(unwrapJsonString(parsed.output));
        if (hint) detailParts.push(hint);
        if (output && output !== hint) detailParts.push(output);
      }
      return {
        tone: "marker",
        icon: copy.icon,
        title: copy.title,
        detail: detailParts.length > 0 ? detailParts.join("\n") : undefined,
        pending,
      };
    }
    default:
      return {
        tone: "marker",
        icon: "wrench",
        title: event.kind,
        detail: clipDetail(event.payload),
        pending: false,
      };
  }
}

export type ChatTimelineItem =
  | { type: "message"; id: string; role: string; body: string }
  | { type: "marker"; id: string; event: { kind: string; payload: string } };

export function chatTimeline(
  stored: { id: string; role: string; body: string }[],
  runEvents: { seq: number; kind: string; payload: string }[],
  runId?: string,
): ChatTimelineItem[] {
  const lines: ChatTimelineItem[] = [];
  const seen = new Set<string>();
  for (const item of stored) {
    lines.push({ type: "message", id: item.id, role: item.role, body: item.body });
    seen.add(item.body);
  }
  for (const event of runEvents) {
    const described = describeActivity(event);
    const id = `run-${runId ?? "run"}-${event.seq}`;
    if (described.tone === "message") {
      if (seen.has(described.body)) continue;
      seen.add(described.body);
      lines.push({
        type: "message",
        id,
        role: described.role === "user" ? "user" : "assistant",
        body: described.body,
      });
      continue;
    }
    lines.push({ type: "marker", id, event });
  }
  return lines;
}
