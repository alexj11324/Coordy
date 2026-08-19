import { newAgentAvatarRef } from "./agent-avatar";
import { canonicalHarnessId } from "./labels";

export const BUILDER_STARTER_PROMPTS = [
  "审查前端 Pull Request",
  "研究竞品并整理结论",
  "帮助团队规划和撰写项目",
] as const;

export const DEFAULT_MODEL_VALUE = "__default__";

export type AgentAccess = "owner" | "workspace";

export type AgentDraft = {
  name: string;
  description: string;
  instructions: string;
  harness: string;
  model: string;
  thinking: string;
  speed: string;
  avatar: string;
  access: AgentAccess;
};

export const EMPTY_AGENT_DRAFT: AgentDraft = {
  name: "",
  description: "",
  instructions: "",
  harness: "",
  model: "",
  thinking: "",
  speed: "",
  avatar: "",
  access: "owner",
};

export function emptyAgentDraft(): AgentDraft {
  return { ...EMPTY_AGENT_DRAFT, avatar: newAgentAvatarRef() };
}

export type BuilderMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function draftAgentFromGoal(goal: string): {
  name: string;
  description: string;
  instructions: string;
} {
  const text = goal.trim();
  const firstLine = text.split(/\n/)[0]?.trim() ?? "";
  const nameSeed = firstLine.replace(/[。！？.!?].*$/, "").trim();
  const name = (nameSeed || "新智能体").slice(0, 24);
  return {
    name,
    description: firstLine.slice(0, 80),
    instructions: text,
  };
}

export function applyDraftRuntimeChange(draft: AgentDraft, harness: string): AgentDraft {
  if (draft.harness === harness) return draft;
  return { ...draft, harness, model: "", thinking: "", speed: "" };
}

export function applyDraftModelChange(draft: AgentDraft, model: string): AgentDraft {
  const next = model === DEFAULT_MODEL_VALUE ? "" : model;
  const thinking = sanitizeThinking(draft.harness, next, draft.thinking);
  return { ...draft, model: next, thinking };
}

export const CODEX_FAST_SPEED = "fast";

export function applyDraftThinkingChange(draft: AgentDraft, thinking: string): AgentDraft {
  const next = thinking === DEFAULT_MODEL_VALUE ? "" : thinking;
  return { ...draft, thinking: next };
}

export function applyDraftFastChange(draft: AgentDraft, on: boolean): AgentDraft {
  return { ...draft, speed: on ? CODEX_FAST_SPEED : "" };
}

export function isCodexFast(speed: string): boolean {
  return speed.trim() === CODEX_FAST_SPEED;
}

export function normalizeCodexFast(speed: string): string {
  return isCodexFast(speed) ? CODEX_FAST_SPEED : "";
}

export function sanitizeThinking(harness: string, model: string, thinking: string): string {
  return allowedToken(thinkingForHarness(harness, model), thinking);
}

export function modelSelectValue(model: string): string {
  return model.trim() ? model : DEFAULT_MODEL_VALUE;
}

export type HarnessModelOption = { id: string; label: string };

const CLAUDE_MODELS: HarnessModelOption[] = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

const CLAUDE_THINKING: HarnessModelOption[] = [
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
  { id: "xhigh", label: "极高" },
  { id: "max", label: "最大" },
];

const CODEX_MODELS: HarnessModelOption[] = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
];

const CODEX_THINKING: HarnessModelOption[] = [
  { id: "none", label: "无" },
  { id: "minimal", label: "最低" },
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
  { id: "xhigh", label: "极高" },
  { id: "max", label: "最大" },
  { id: "ultra", label: "Ultra" },
];

const COPILOT_MODELS: HarnessModelOption[] = [
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { id: "gpt-5.2", label: "GPT-5.2" },
  { id: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { id: "claude-opus-4.6", label: "Claude Opus 4.6" },
  { id: "claude-opus-4.5", label: "Claude Opus 4.5" },
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
];

const CURSOR_MODELS: HarnessModelOption[] = [
  { id: "auto", label: "Auto" },
  { id: "composer-2", label: "Composer 2" },
  { id: "composer-1.5", label: "Composer 1.5" },
  { id: "grok-4-5", label: "Grok 4.5" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { id: "claude-4.6-opus-high", label: "Claude 4.6 Opus High" },
  { id: "claude-4.6-sonnet", label: "Claude 4.6 Sonnet" },
  { id: "gemini-3-flash", label: "Gemini 3 Flash" },
  { id: "gemini-3-pro", label: "Gemini 3 Pro" },
];

const GEMINI_MODELS: HarnessModelOption[] = [
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

const OPENCODE_THINKING: HarnessModelOption[] = [
  { id: "none", label: "无" },
  { id: "minimal", label: "最低" },
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
  { id: "xhigh", label: "极高" },
];

export function modelsForHarness(harness: string): HarnessModelOption[] {
  switch (canonicalHarnessId(harness)) {
    case "claude":
      return CLAUDE_MODELS;
    case "codex":
      return CODEX_MODELS;
    case "copilot":
      return COPILOT_MODELS;
    case "cursor":
      return CURSOR_MODELS;
    case "gemini":
      return GEMINI_MODELS;
    default:
      return [];
  }
}

export function thinkingForHarness(harness: string, model: string): HarnessModelOption[] {
  switch (canonicalHarnessId(harness)) {
    case "claude":
      return claudeThinkingForModel(model);
    case "codex":
      return codexThinkingForModel(model);
    case "opencode":
      return OPENCODE_THINKING;
    default:
      return [];
  }
}

export function harnessHasFastToggle(harness: string): boolean {
  return canonicalHarnessId(harness) === "codex";
}

function claudeThinkingForModel(model: string): HarnessModelOption[] {
  const id = model.trim().toLowerCase();
  const opus = id.includes("opus");
  const haiku = id.includes("haiku");
  return CLAUDE_THINKING.filter((option) => {
    if (option.id === "xhigh") return opus;
    if (option.id === "max") return !haiku;
    if (haiku) return option.id === "low" || option.id === "medium" || option.id === "high";
    return true;
  });
}

function codexThinkingForModel(model: string): HarnessModelOption[] {
  const id = model.trim().toLowerCase();
  const extra =
    !id ||
    id.includes("5.6-sol") ||
    id.includes("5.6-terra") ||
    id.includes("5.6-luna") ||
    id.includes("gpt-5.5") ||
    id.includes("gpt-5.4") ||
    id.includes("gpt-5.2");
  return CODEX_THINKING.filter((option) => {
    if (option.id === "max" || option.id === "ultra") return extra;
    return true;
  });
}

function allowedToken(options: HarnessModelOption[], value: string): string {
  if (!value) return "";
  return options.some((option) => option.id === value) ? value : "";
}

/** Local Agent Builder turn. Fills the live draft; does not call a harness. */
export function applyBuilderTurn(
  draft: AgentDraft,
  previousUserCount: number,
  userText: string,
): { draft: AgentDraft; reply: string } {
  const text = userText.trim();
  if (!text) {
    return { draft, reply: "请用一两句话说明该智能体的职责。" };
  }
  if (previousUserCount === 0) {
    const seeded = draftAgentFromGoal(text);
    return {
      draft: {
        ...draft,
        name: draft.name.trim() || seeded.name,
        description: draft.description.trim() || seeded.description,
        instructions: seeded.instructions,
      },
      reply: "职责已写入草稿。请补充禁止事项，以及必须向你确认的情形。",
    };
  }
  if (previousUserCount === 1) {
    return {
      draft: {
        ...draft,
        instructions: appendInstruction(draft.instructions, text),
      },
      reply: "约束已写入指令。交付方式应为何种：评论、Pull Request，还是允许直接修改代码？",
    };
  }
  return {
    draft: {
      ...draft,
      instructions: appendInstruction(draft.instructions, text),
    },
    reply: "已更新右侧草稿。可直接编辑字段，或继续补充工作方式与交付要求。",
  };
}

export function applyDraftCompletion(
  draft: AgentDraft,
  completion: { name?: string; description?: string; instructions?: string },
): AgentDraft {
  return {
    ...draft,
    name: completion.name?.trim() || draft.name,
    description: completion.description?.trim() || draft.description,
    instructions: completion.instructions?.trim() || draft.instructions,
  };
}

export function draftCompletionReply(completion: {
  name?: string;
  description?: string;
  instructions?: string;
}): string {
  const lines = ["已根据模型回复更新右侧草稿。"];
  if (completion.name?.trim()) lines.push(`名称：${completion.name.trim()}`);
  if (completion.description?.trim()) lines.push(`描述：${completion.description.trim()}`);
  return lines.join("\n");
}

export function classifyCreateAgentError(err: unknown): { nameError: string | null; formError: string | null } {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("name is required") || message.includes("请填写名称")) {
    return { nameError: "请填写名称", formError: null };
  }
  if (message.includes("unique") || message.includes("同名")) {
    return { nameError: "工作区中已存在同名智能体。", formError: null };
  }
  return { nameError: null, formError: message || "无法创建智能体。" };
}

function appendInstruction(current: string, extra: string): string {
  const base = current.trim();
  return base ? `${base}\n\n${extra}` : extra;
}
