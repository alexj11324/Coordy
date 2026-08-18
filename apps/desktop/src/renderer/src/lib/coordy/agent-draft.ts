import { newAgentAvatarRef } from "./agent-avatar";

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
  avatar: string;
  access: AgentAccess;
};

export const EMPTY_AGENT_DRAFT: AgentDraft = {
  name: "",
  description: "",
  instructions: "",
  harness: "",
  model: "",
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
  return { ...draft, harness, model: "" };
}

export function applyDraftModelChange(draft: AgentDraft, model: string): AgentDraft {
  const next = model === DEFAULT_MODEL_VALUE ? "" : model;
  return { ...draft, model: next };
}

export function modelSelectValue(model: string): string {
  return model.trim() ? model : DEFAULT_MODEL_VALUE;
}

export type HarnessModelOption = { id: string; label: string };

export function modelsForHarness(harness: string): HarnessModelOption[] {
  switch (harness) {
    case "claude-acp":
    case "claude":
      return [
        { id: "claude-opus-4-6", label: "Opus 4.6" },
        { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
        { id: "claude-haiku-4-5", label: "Haiku 4.5" },
      ];
    case "codex-acp":
    case "codex":
      return [
        { id: "gpt-5.4", label: "GPT-5.4" },
        { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
      ];
    case "gemini":
      return [
        { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
        { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      ];
    default:
      return [];
  }
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
