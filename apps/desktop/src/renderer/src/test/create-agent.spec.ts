import { describe, expect, it } from "vitest";
import {
  applyBuilderTurn,
  applyDraftRuntimeChange,
  classifyCreateAgentError,
  DEFAULT_MODEL_VALUE,
  draftAgentFromGoal,
  EMPTY_AGENT_DRAFT,
  modelSelectValue,
} from "../lib/coordy/agent-draft";
import {
  listBuilderSessions,
  memoryStore,
  removeBuilderSession,
  sessionPreview,
  sessionTitle,
  upsertBuilderSession,
  writeManualDraft,
  readManualDraft,
  type BuilderSession,
} from "../lib/coordy/builder-sessions";
import { osShortLabel, runtimeChipLabel } from "../lib/coordy/labels";

function session(partial: Partial<BuilderSession> & Pick<BuilderSession, "id">): BuilderSession {
  return {
    workspaceId: "ws",
    draft: { ...EMPTY_AGENT_DRAFT, name: "审查员" },
    messages: [],
    updatedAt: "2026-08-18T00:00:00.000Z",
    ...partial,
  };
}

describe("agent creation studio helpers", () => {
  it("keeps the first-line name seed from a goal", () => {
    const draft = draftAgentFromGoal("审查前端 Pull Request。\n只看 TypeScript。");
    expect(draft.name).toBe("审查前端 Pull Request");
    expect(draft.instructions).toContain("只看 TypeScript");
  });

  it("clears the model when the runtime changes", () => {
    const next = applyDraftRuntimeChange(
      { ...EMPTY_AGENT_DRAFT, harness: "claude-acp", model: "opus" },
      "codex-acp",
    );
    expect(next.harness).toBe("codex-acp");
    expect(next.model).toBe("");
  });

  it("treats an empty model as the provider default", () => {
    expect(modelSelectValue("")).toBe(DEFAULT_MODEL_VALUE);
    expect(modelSelectValue("gpt-5")).toBe("gpt-5");
  });

  it("fills the live draft over three builder turns", () => {
    const first = applyBuilderTurn(EMPTY_AGENT_DRAFT, 0, "审查前端 Pull Request");
    expect(first.draft.name).toBe("审查前端 Pull Request");
    expect(first.reply).toContain("不该做什么");
    const second = applyBuilderTurn(first.draft, 1, "不要直接改代码");
    expect(second.draft.instructions).toContain("不要直接改代码");
    expect(second.reply).toContain("交付");
    const third = applyBuilderTurn(second.draft, 2, "把结论写在 issue 评论里");
    expect(third.draft.instructions).toContain("issue 评论");
    expect(third.reply).toContain("右侧草稿");
  });

  it("maps a unique-name kernel error onto the name field", () => {
    expect(classifyCreateAgentError(new Error("agent name must be unique in this workspace"))).toEqual({
      nameError: "工作区中已存在同名智能体。",
      formError: null,
    });
    expect(classifyCreateAgentError(new Error("daemon handshake failed")).formError).toContain("handshake");
  });

  it("persists unfinished builder conversations per workspace", () => {
    const store = memoryStore();
    upsertBuilderSession(session({ id: "a", updatedAt: "2026-08-18T01:00:00.000Z" }), store);
    upsertBuilderSession(
      session({
        id: "b",
        draft: { ...EMPTY_AGENT_DRAFT, name: "研究员" },
        messages: [{ id: "m1", role: "user", content: "研究竞品" }],
        updatedAt: "2026-08-18T02:00:00.000Z",
      }),
      store,
    );
    const listed = listBuilderSessions("ws", store);
    expect(listed.map((item) => item.id)).toEqual(["b", "a"]);
    expect(sessionTitle(listed[0]!)).toBe("研究员");
    expect(sessionPreview(listed[0]!)).toBe("研究竞品");
    expect(listBuilderSessions("other", store)).toEqual([]);
    removeBuilderSession("ws", "b", store);
    expect(listBuilderSessions("ws", store)).toHaveLength(1);
  });

  it("stores a blank-form draft until it is created", () => {
    const store = memoryStore();
    writeManualDraft("ws", { ...EMPTY_AGENT_DRAFT, name: "助手" }, store);
    expect(readManualDraft("ws", store)?.name).toBe("助手");
  });

  it("labels a runtime chip with the host OS like Multica", () => {
    expect(osShortLabel("darwin")).toBe("Mac");
    expect(runtimeChipLabel({ id: "claude-acp", name: "Claude Code" }, "darwin")).toBe("Claude Code (Mac)");
  });
});
