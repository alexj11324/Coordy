// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskPlanDraft, TaskPlanProposalView } from "@coordy/protocol";
import { TaskPlanCard } from "../features/task-plan-card";

function proposal(): TaskPlanProposalView {
  return {
    id: "plan",
    revision: 3,
    created_by: "agent",
    created_at: "now",
    draft: {
      version: "COORDY_TASK_PLAN_V1",
      workspace_id: "ws",
      chat_id: "chat",
      source_run_id: "run",
      source_agent_id: "agent",
      parent: { mode: "create", title: "Ship", description: "Release" },
      children: [
        { key: "design", title: "Design", description: "Design it", acceptance_criteria: ["Approved"], priority: "high", stage: 1, depends_on: [] },
        { key: "build", title: "Build", description: "Build it", acceptance_criteria: ["Tests pass"], priority: "medium", stage: 2, depends_on: ["design"] },
      ],
    },
  };
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`missing button: ${label}`);
  return match;
}

function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const match = document.querySelector(`[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement) && !(match instanceof HTMLTextAreaElement)) {
    throw new Error(`missing field: ${label}`);
  }
  return match;
}

async function changeField(label: string, value: string) {
  const input = field(label);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("task plan card", () => {
  let root: Root | null = null;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("previews, edits, regenerates, and exposes both apply modes", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onSave = vi.fn(async (_draft: TaskPlanDraft) => undefined);
    const onRegenerate = vi.fn(async (_draft: TaskPlanDraft) => undefined);
    const onApply = vi.fn(async (_draft: TaskPlanDraft, _mode: "create_only" | "confirm_and_start") => undefined);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(
      <TaskPlanCard proposal={proposal()} agents={[]} squads={[]} projects={[]} tasks={[]} onSave={onSave} onRegenerate={onRegenerate} onApply={onApply} />,
    ));

    expect(document.body.textContent).toContain("任务拆分方案");
    expect(document.body.textContent).toContain("修订 3");
    expect(document.body.textContent).not.toContain("source_run_id");
    expect(field("子事项 1 标题").value).toBe("Design");

    await changeField("子事项 1 标题", "Research");
    await act(async () => button("保存修改").click());
    expect(onSave.mock.calls[0]?.[0].children[0]?.title).toBe("Research");

    await act(async () => button("重新生成").click());
    expect(onRegenerate.mock.calls[0]?.[0].children[0]?.title).toBe("Research");

    await act(async () => button("仅创建").click());
    await act(async () => button("确认并开始").click());
    expect(onApply.mock.calls.map((call) => call[1])).toEqual(["create_only", "confirm_and_start"]);
  });

  it("disables invalid apply and removes dangling dependencies with a child", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onSave = vi.fn(async (_draft: TaskPlanDraft) => undefined);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(
      <TaskPlanCard proposal={proposal()} agents={[]} squads={[]} projects={[]} tasks={[]} onSave={onSave} onRegenerate={vi.fn()} onApply={vi.fn()} />,
    ));

    await changeField("子事项 1 验收标准", "");
    expect(button("仅创建").disabled).toBe(true);
    expect(button("确认并开始").disabled).toBe(true);
    expect(document.body.textContent).toContain("缺少验收标准");

    await changeField("子事项 1 验收标准", "Approved");
    await act(async () => button("删除子事项 1").click());
    expect(button("保存修改").disabled).toBe(false);
    await act(async () => button("保存修改").click());
    expect(onSave.mock.calls[0]?.[0].children).toHaveLength(1);
    expect(onSave.mock.calls[0]?.[0].children[0]?.depends_on).toEqual([]);
  });
});
