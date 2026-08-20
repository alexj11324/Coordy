import { describe, expect, it } from "vitest";
import type { TaskPlanDraft } from "@coordy/protocol";
import { cloneTaskPlan, nextTaskPlanKey, suppressStreamingTaskPlanJson, taskPlanApplyCommand, taskPlanRegenerationPrompt, taskPlanValidationError } from "../lib/coordy/task-plan";

function draft(): TaskPlanDraft {
  return {
    version: "COORDY_TASK_PLAN_V1",
    workspace_id: "ws",
    chat_id: "chat",
    source_run_id: "run",
    source_agent_id: "agent",
    parent: { mode: "create", title: "Ship", description: "Release" },
    children: [
      { key: "design", title: "Design", description: "Design it", acceptance_criteria: ["Approved"], priority: "high", stage: 1, depends_on: [] },
      { key: "build", title: "Build", description: "Build it", acceptance_criteria: ["Tests pass"], priority: "medium", stage: 2, depends_on: ["design"], assignee: { type: "agent", id: "agent" } },
    ],
  };
}

describe("chat task plan editor helpers", () => {
  it("accepts an editable complete plan and clones without mutating the proposal", () => {
    const original = draft();
    const edited = cloneTaskPlan(original);
    edited.children[0]!.title = "Research";
    expect(original.children[0]!.title).toBe("Design");
    expect(taskPlanValidationError(edited)).toBeNull();
  });

  it("disables apply for missing acceptance criteria and dependency cycles", () => {
    const missing = draft();
    missing.children[0]!.acceptance_criteria = [""];
    expect(taskPlanValidationError(missing)).toContain("验收标准");

    const cycle = draft();
    cycle.children[1]!.stage = 1;
    cycle.children[0]!.depends_on = ["build"];
    expect(taskPlanValidationError(cycle)).toContain("循环");
  });

  it("matches kernel validation for draft keys, priorities, and stage ordering", () => {
    const invalidKey = draft();
    invalidKey.children[0]!.key = " bad key ";
    expect(taskPlanValidationError(invalidKey)).toContain("标识");

    const invalidPriority = draft();
    invalidPriority.children[0]!.priority = "whenever";
    expect(taskPlanValidationError(invalidPriority)).toContain("优先级");

    const laterStage = draft();
    laterStage.children[0]!.stage = 2;
    laterStage.children[1]!.stage = 1;
    expect(taskPlanValidationError(laterStage)).toContain("更晚阶段");
  });

  it("allocates a stable unused key when adding a child", () => {
    const plan = draft();
    plan.children.push({ key: "task_3", title: "Review", description: "Review it", acceptance_criteria: ["Reviewed"], priority: "none", stage: 3 });
    expect(nextTaskPlanKey(plan)).toBe("task_4");
  });

  it("keeps create-only and confirm-and-start explicit and idempotent", () => {
    expect(taskPlanApplyCommand("plan", 3, "create_only")).toEqual({
      type: "ApplyTaskPlan",
      proposal_id: "plan",
      expected_revision: 3,
      idempotency_key: "desktop:plan:3:create_only",
      mode: "create_only",
    });
    expect(taskPlanApplyCommand("plan", 3, "confirm_and_start").mode).toBe("confirm_and_start");
  });

  it("regenerates through another chat turn with the edited proposal", () => {
    const plan = draft();
    plan.children[0]!.title = "Edited";
    const prompt = taskPlanRegenerationPrompt(plan, 4);
    expect(prompt).toContain("修订 4");
    expect(prompt).toContain("Edited");
    expect(prompt).toContain("COORDY_TASK_PLAN_V1");
  });

  it("suppresses only the fenced JSON while a plan streams", () => {
    const events = [
      { seq: 1, kind: "tool", payload: "search in={} out=ok exit=0" },
      { seq: 2, kind: "message", payload: "assistant: 先说明方案。\n```COORDY_TASK_PLAN_V1\n{\"version\":" },
      { seq: 3, kind: "message", payload: "assistant: \"COORDY_TASK_PLAN_V1\"}\n```\n请确认。" },
    ];
    expect(suppressStreamingTaskPlanJson(events)).toEqual([
      events[0],
      { seq: 2, kind: "message", payload: "assistant: 先说明方案。" },
      { seq: 3, kind: "message", payload: "assistant: 请确认。" },
    ]);
  });
});
