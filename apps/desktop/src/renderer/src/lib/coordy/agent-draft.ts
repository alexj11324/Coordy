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
  access: AgentAccess;
};

export const EMPTY_AGENT_DRAFT: AgentDraft = {
  name: "",
  description: "",
  instructions: "",
  harness: "",
  model: "",
  access: "owner",
};

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

/** Local Agent Builder turn. Fills the live draft; does not call a runtime. */
export function applyBuilderTurn(
  draft: AgentDraft,
  previousUserCount: number,
  userText: string,
): { draft: AgentDraft; reply: string } {
  const text = userText.trim();
  if (!text) {
    return { draft, reply: "先用一两句话描述这个智能体要负责什么。" };
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
      reply: "先记下职责。还需要明确：它不该做什么，以及什么时候必须找你确认？",
    };
  }
  if (previousUserCount === 1) {
    return {
      draft: {
        ...draft,
        instructions: appendInstruction(draft.instructions, text),
      },
      reply: "边界已经写进指令。输出应该怎么交付？评论、Pull Request，还是可以直接改代码？",
    };
  }
  return {
    draft: {
      ...draft,
      instructions: appendInstruction(draft.instructions, text),
    },
    reply: "已经更新右侧草稿。可以直接改字段，或继续补充工作方式和交付要求。",
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
