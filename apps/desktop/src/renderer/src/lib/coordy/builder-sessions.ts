import { formatAgentAvatar } from "./agent-avatar";
import { EMPTY_AGENT_DRAFT, normalizeCodexFast, type AgentDraft, type BuilderMessage } from "./agent-draft";

export const BUILDER_SESSION_KEY_PREFIX = "coordy.agent-builder.";
export const MANUAL_DRAFT_KEY_PREFIX = "coordy.agent-create.manual.";

export type BuilderSession = {
  id: string;
  workspaceId: string;
  draft: AgentDraft;
  messages: BuilderMessage[];
  updatedAt: string;
};

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

export function browserStore(): KeyValueStore | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function newBuilderSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `builder_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function listBuilderSessions(workspaceId: string, store: KeyValueStore): BuilderSession[] {
  const raw = store.getItem(BUILDER_SESSION_KEY_PREFIX + workspaceId);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(asBuilderSession)
      .filter((item): item is BuilderSession => item != null && item.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function upsertBuilderSession(session: BuilderSession, store: KeyValueStore): BuilderSession[] {
  const next = listBuilderSessions(session.workspaceId, store).filter((item) => item.id !== session.id);
  next.unshift({ ...session, updatedAt: session.updatedAt || new Date().toISOString() });
  store.setItem(BUILDER_SESSION_KEY_PREFIX + session.workspaceId, JSON.stringify(next));
  return next;
}

export function removeBuilderSession(workspaceId: string, sessionId: string, store: KeyValueStore): BuilderSession[] {
  const next = listBuilderSessions(workspaceId, store).filter((item) => item.id !== sessionId);
  const key = BUILDER_SESSION_KEY_PREFIX + workspaceId;
  if (next.length === 0) store.removeItem(key);
  else store.setItem(key, JSON.stringify(next));
  return next;
}

export function readManualDraft(workspaceId: string, store: KeyValueStore): AgentDraft | null {
  const raw = store.getItem(MANUAL_DRAFT_KEY_PREFIX + workspaceId);
  if (!raw) return null;
  try {
    return asAgentDraft(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeManualDraft(workspaceId: string, draft: AgentDraft, store: KeyValueStore): void {
  store.setItem(MANUAL_DRAFT_KEY_PREFIX + workspaceId, JSON.stringify(draft));
}

export function clearManualDraft(workspaceId: string, store: KeyValueStore): void {
  store.removeItem(MANUAL_DRAFT_KEY_PREFIX + workspaceId);
}

export function sessionTitle(session: BuilderSession): string {
  return session.draft.name.trim();
}

export function sessionPreview(session: BuilderSession): string {
  const last = session.messages[session.messages.length - 1];
  if (last?.content.trim()) return last.content.trim();
  return session.draft.description.trim() || session.draft.instructions.trim();
}

function asBuilderSession(value: unknown): BuilderSession | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<BuilderSession>;
  if (typeof row.id !== "string" || !row.id) return null;
  if (typeof row.workspaceId !== "string" || !row.workspaceId) return null;
  const draft = asAgentDraft(row.draft);
  if (!draft) return null;
  const messages = Array.isArray(row.messages)
    ? row.messages.filter(isBuilderMessage)
    : [];
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    draft,
    messages,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
  };
}

function asAgentDraft(value: unknown): AgentDraft | null {
  if (!value || typeof value !== "object") return { ...EMPTY_AGENT_DRAFT };
  const row = value as Partial<AgentDraft>;
  const name = typeof row.name === "string" ? row.name : "";
  const description = typeof row.description === "string" ? row.description : "";
  const instructions = typeof row.instructions === "string" ? row.instructions : "";
  const harness = typeof row.harness === "string" ? row.harness : "";
  const storedAvatar = typeof row.avatar === "string" ? row.avatar.trim() : "";
  return {
    name,
    description,
    instructions,
    harness,
    model: typeof row.model === "string" ? row.model : "",
    thinking: typeof row.thinking === "string" ? row.thinking : "",
    speed: typeof row.speed === "string" ? normalizeCodexFast(row.speed) : "",
    avatar: storedAvatar || formatAgentAvatar([name, harness, instructions].filter(Boolean).join("|") || "agent"),
    access: row.access === "workspace" ? "workspace" : "owner",
  };
}

function isBuilderMessage(value: unknown): value is BuilderMessage {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<BuilderMessage>;
  return (
    typeof row.id === "string" &&
    (row.role === "user" || row.role === "assistant") &&
    typeof row.content === "string"
  );
}
