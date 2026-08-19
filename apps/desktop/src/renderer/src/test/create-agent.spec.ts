import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  applyBuilderTurn,
  applyDraftCompletion,
  applyDraftFastChange,
  applyDraftModelChange,
  applyDraftRuntimeChange,
  classifyCreateAgentError,
  CODEX_FAST_SPEED,
  DEFAULT_MODEL_VALUE,
  draftAgentFromGoal,
  EMPTY_AGENT_DRAFT,
  emptyAgentDraft,
  harnessHasFastToggle,
  modelsForHarness,
  modelSelectValue,
  parseToolAccess,
  thinkingForHarness,
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
import {
  catalogItemForHarness,
  harnessIdsMatch,
  osShortLabel,
  pickerRuntimes,
  runtimeChipLabel,
  runtimeSubtitle,
} from "../lib/coordy/labels";
import { FIRST_CLASS_PROVIDER_IDS, firstClassIconSignature, registryIconUrl } from "../features/provider-logo";
import { RuntimePicker } from "../features/runtime-picker";

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

  it("clears the model, thinking, and speed when the harness changes", () => {
    const next = applyDraftRuntimeChange(
      { ...EMPTY_AGENT_DRAFT, harness: "claude-acp", model: "opus", thinking: "high", speed: "fast" },
      "codex-acp",
    );
    expect(next.harness).toBe("codex-acp");
    expect(next.model).toBe("");
    expect(next.thinking).toBe("");
    expect(next.speed).toBe("");
  });

  it("drops thinking that the next model does not accept", () => {
    const next = applyDraftModelChange(
      { ...EMPTY_AGENT_DRAFT, harness: "claude", model: "claude-opus-4-8", thinking: "xhigh" },
      "claude-haiku-4-5-20251001",
    );
    expect(next.model).toBe("claude-haiku-4-5-20251001");
    expect(next.thinking).toBe("");
  });

  it("treats an empty model as the provider default", () => {
    expect(modelSelectValue("")).toBe(DEFAULT_MODEL_VALUE);
    expect(modelSelectValue("gpt-5")).toBe("gpt-5");
  });

  it("fills the live draft locally without calling a harness", () => {
    const first = applyBuilderTurn(EMPTY_AGENT_DRAFT, 0, "审查前端 Pull Request");
    expect(first.draft.name).toBe("审查前端 Pull Request");
    expect(first.reply).toContain("禁止事项");
    const second = applyBuilderTurn(first.draft, 1, "不要直接改代码");
    expect(second.draft.instructions).toContain("不要直接改代码");
    expect(second.reply).toContain("交付");
    const third = applyBuilderTurn(second.draft, 2, "把结论写在 issue 评论里");
    expect(third.draft.instructions).toContain("issue 评论");
    expect(third.reply).toContain("右侧草稿");
  });

  it("merges a model draft completion into the live form", () => {
    const next = applyDraftCompletion(
      { ...EMPTY_AGENT_DRAFT, name: "旧名", harness: "claude" },
      { name: "审查员", description: "看 PR", instructions: "只评论" },
    );
    expect(next.name).toBe("审查员");
    expect(next.description).toBe("看 PR");
    expect(next.instructions).toBe("只评论");
    expect(next.harness).toBe("claude");
    const kept = applyDraftCompletion(next, { name: "", description: "", instructions: "" });
    expect(kept.name).toBe("审查员");
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

  it("seeds a local DiceBear avatar and keeps a stored seed stable", () => {
    const draft = emptyAgentDraft();
    expect(draft.avatar.startsWith("dicebear:bottts-neutral:")).toBe(true);
    const store = memoryStore();
    writeManualDraft("ws", { ...EMPTY_AGENT_DRAFT, name: "审查员", avatar: "dicebear:bottts-neutral:kept" }, store);
    expect(readManualDraft("ws", store)?.avatar).toBe("dicebear:bottts-neutral:kept");
    writeManualDraft("ws", { ...EMPTY_AGENT_DRAFT, name: "审查员" }, store);
    expect(readManualDraft("ws", store)?.avatar).toBe("dicebear:bottts-neutral:审查员");
  });

  it("shows only the harness identity in the picker", () => {
    expect(osShortLabel("darwin")).toBe("Mac");
    expect(runtimeChipLabel({ id: "claude-acp", name: "Claude Code" }, "darwin")).toBe("Claude Code");
    expect(runtimeSubtitle({ command: "claude -p", protocol_family: "claude" })).toBe("");
  });

  it("has a distinct local icon mapping for every first-class runtime", () => {
    const expected = [
      "antigravity", "claude", "codebuddy", "codex", "copilot", "cursor", "deveco", "dsh",
      "gemini", "grok", "hermes", "kimi", "kiro", "mcode", "omp", "openclaw", "opencode",
      "pi", "qoder", "qoderclicn", "qwen", "qwenpaw", "reasonix", "traecli",
    ];
    expect(FIRST_CLASS_PROVIDER_IDS).toHaveLength(24);
    expect(new Set(FIRST_CLASS_PROVIDER_IDS).size).toBe(24);
    expect([...FIRST_CLASS_PROVIDER_IDS].sort()).toEqual(expected);
    const signatures = FIRST_CLASS_PROVIDER_IDS.map((id) => firstClassIconSignature(id));
    expect(signatures.every(Boolean)).toBe(true);
    expect(new Set(signatures).size).toBe(24);
  });

  it("keeps missing first-class runtimes visible while only ready and on-demand runtimes are selectable", () => {
    const catalog = [
      { id: "hermes", name: "Hermes Agent", installed: false, launch_state: "missing", command: "hermes acp", source: "builtin", protocol_family: "acp" },
      { id: "grok", name: "Grok Build", installed: false, launch_state: "on_demand", command: "npx grok", source: "registry", protocol_family: "acp" },
    ];
    expect(pickerRuntimes(catalog).map((item) => item.id)).toEqual(["hermes", "grok"]);
    const html = renderToStaticMarkup(createElement(RuntimePicker, {
      items: catalog,
      value: "grok",
      onChange: () => undefined,
    }));
    expect(html).toContain("Hermes Agent");
    expect(html).toContain("Grok Build");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Hermes Agent/);
    expect(html).toContain("未安装");
  });

  it("builds registry icons only from a stable registry identity", () => {
    expect(registryIconUrl("grok-build")).toBe(
      "https://cdn.agentclientprotocol.com/registry/v1/latest/grok-build.svg",
    );
    expect(registryIconUrl("https://evil.example/icon.svg")).toBeNull();
    expect(registryIconUrl("../escape")).toBeNull();
  });

  it("offers vendor model ids, thinking tokens, and Codex speed tiers", () => {
    expect(modelsForHarness("claude-acp").map((item) => item.id)).toContain("claude-opus-4-6");
    expect(modelsForHarness("claude").map((item) => item.id)).toEqual(
      expect.arrayContaining(["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"]),
    );
    expect(modelsForHarness("codex-acp").map((item) => item.id)).toEqual(
      expect.arrayContaining(["gpt-5.6-sol", "gpt-5.4", "gpt-5.3-codex"]),
    );
    expect(modelsForHarness("gemini-cli").map((item) => item.id)).toContain("gemini-2.5-pro");
    expect(modelsForHarness("copilot").map((item) => item.id)).toContain("claude-sonnet-4.6");
    expect(modelsForHarness("copilot").map((item) => item.id)).not.toContain("claude-sonnet-4-6");
    expect(modelsForHarness("cursor").map((item) => item.id)).toContain("auto");
    expect(modelsForHarness("coordy-stub")).toEqual([]);

    expect(thinkingForHarness("claude", "claude-opus-4-8").map((item) => item.id)).toEqual(
      expect.arrayContaining(["low", "high", "xhigh", "max"]),
    );
    expect(thinkingForHarness("claude", "claude-haiku-4-5-20251001").map((item) => item.id)).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(thinkingForHarness("codex", "gpt-5.6-sol").map((item) => item.id)).toEqual(
      expect.arrayContaining(["none", "high", "xhigh", "max", "ultra"]),
    );
    expect(thinkingForHarness("codex", "gpt-5.3-codex").map((item) => item.id)).not.toContain("ultra");
    expect(thinkingForHarness("gemini", "gemini-2.5-pro")).toEqual([]);
    expect(harnessHasFastToggle("codex")).toBe(true);
    expect(harnessHasFastToggle("codex-acp")).toBe(true);
    expect(harnessHasFastToggle("claude")).toBe(false);
  });

  it("toggles Codex Fast on and off", () => {
    const on = applyDraftFastChange({ ...EMPTY_AGENT_DRAFT, harness: "codex" }, true);
    expect(on.speed).toBe(CODEX_FAST_SPEED);
    expect(applyDraftFastChange(on, false).speed).toBe("");
  });

  it("defaults tool access to Auto and keeps Full Access on a saved draft", () => {
    expect(EMPTY_AGENT_DRAFT.toolAccess).toBe("auto");
    expect(parseToolAccess("full_access")).toBe("full_access");
    expect(parseToolAccess("bypass")).toBe("auto");
    expect(parseToolAccess("full-access")).toBe("auto");
    const store = memoryStore();
    writeManualDraft("ws", { ...EMPTY_AGENT_DRAFT, name: "助手", toolAccess: "full_access" }, store);
    expect(readManualDraft("ws", store)?.toolAccess).toBe("full_access");
  });

  it("matches leftover ACP-era harness ids onto the native catalog", () => {
    const catalog = [
      {
        id: "claude",
        name: "Claude Code",
        installed: true,
        command: "claude -p --output-format stream-json",
        source: "path",
        protocol_family: "claude",
      },
      {
        id: "made-up-acp",
        name: "Made Up",
        installed: false,
        command: "npx -y made-up --acp",
        source: "registry",
        protocol_family: "acp",
      },
    ];
    expect(harnessIdsMatch("claude-acp", "claude")).toBe(true);
    expect(catalogItemForHarness(catalog, "claude-acp")?.id).toBe("claude");
    expect(pickerRuntimes(catalog, "claude-acp").map((item) => item.id)).toEqual(["claude", "made-up-acp"]);
  });
});
