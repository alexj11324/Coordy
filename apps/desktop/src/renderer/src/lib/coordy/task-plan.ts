import type { Command, TaskPlanApplyMode, TaskPlanDraft } from "@coordy/protocol";

const TASK_PLAN_FENCE = "```COORDY_TASK_PLAN_V1";

type RunEvent = { seq: number; kind: string; payload: string };

export function cloneTaskPlan(draft: TaskPlanDraft): TaskPlanDraft {
  return JSON.parse(JSON.stringify(draft)) as TaskPlanDraft;
}

export function taskPlanValidationError(draft: TaskPlanDraft): string | null {
  if (draft.parent.mode === "create" && !draft.parent.title.trim()) return "父事项标题不能为空。";
  if (draft.children.length === 0) return "至少需要一个子事项。";
  const keys = new Set<string>();
  const byKey = new Map(draft.children.map((child) => [child.key, child]));
  for (const child of draft.children) {
    if (
      child.key !== child.key.trim()
      || !child.key
      || child.key.length > 64
      || !/^[A-Za-z0-9_-]+$/.test(child.key)
      || keys.has(child.key)
    ) return "每个子事项需要有效且唯一的标识。";
    keys.add(child.key);
    if (!child.title.trim()) return `子事项 ${child.key} 缺少标题。`;
    if (!child.description.trim()) return `子事项 ${child.key} 缺少说明。`;
    if (child.acceptance_criteria.length === 0 || child.acceptance_criteria.some((item) => !item.trim())) {
      return `子事项 ${child.key} 缺少验收标准。`;
    }
    if (!["urgent", "high", "medium", "low", "none"].includes(child.priority)) {
      return `子事项 ${child.key} 的优先级无效。`;
    }
    if (!Number.isInteger(child.stage) || child.stage < 1) return `子事项 ${child.key} 的阶段无效。`;
  }
  for (const child of draft.children) {
    const dependencies = child.depends_on ?? [];
    if (new Set(dependencies).size !== dependencies.length) return `子事项 ${child.key} 有重复依赖。`;
    if (dependencies.some((key) => key === child.key || !keys.has(key))) return `子事项 ${child.key} 的依赖无效。`;
    if (dependencies.some((key) => (byKey.get(key)?.stage ?? 0) > child.stage)) {
      return `子事项 ${child.key} 不能依赖更晚阶段的事项。`;
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    const found = (byKey.get(key)?.depends_on ?? []).some(cyclic);
    visiting.delete(key);
    visited.add(key);
    return found;
  };
  if (draft.children.some((child) => cyclic(child.key))) return "子事项依赖形成了循环。";
  return null;
}

/**
 * Hide an unfinished plan artifact while it streams. Completed malformed
 * artifacts are intentionally left untouched by calling this only while the
 * run is active; the kernel then exposes the exact parse error and raw output.
 */
export function suppressStreamingTaskPlanJson(events: RunEvent[]): RunEvent[] {
  let insideArtifact = false;
  return events.flatMap((event) => {
    if (event.kind !== "message" || !event.payload.startsWith("assistant: ")) return [event];
    const content = event.payload.slice("assistant: ".length);
    let cursor = 0;
    let visible = "";
    while (cursor < content.length) {
      if (!insideArtifact) {
        const open = content.indexOf(TASK_PLAN_FENCE, cursor);
        if (open < 0) {
          visible += content.slice(cursor);
          break;
        }
        visible += content.slice(cursor, open);
        insideArtifact = true;
        cursor = open + TASK_PLAN_FENCE.length;
      } else {
        const close = content.indexOf("```", cursor);
        if (close < 0) break;
        insideArtifact = false;
        cursor = close + 3;
      }
    }
    if (!visible.trim()) return [];
    return [{ ...event, payload: `assistant: ${visible.trim()}` }];
  });
}

export function nextTaskPlanKey(draft: TaskPlanDraft): string {
  const used = new Set(draft.children.map((child) => child.key));
  let index = draft.children.length + 1;
  while (used.has(`task_${index}`)) index += 1;
  return `task_${index}`;
}

export function taskPlanApplyCommand(
  proposalId: string,
  revision: number,
  mode: TaskPlanApplyMode,
): Extract<Command, { type: "ApplyTaskPlan" }> {
  return {
    type: "ApplyTaskPlan",
    proposal_id: proposalId,
    expected_revision: revision,
    idempotency_key: `desktop:${proposalId}:${revision}:${mode}`,
    mode,
  };
}

export function taskPlanRegenerationPrompt(draft: TaskPlanDraft, revision: number): string {
  return `请基于任务方案修订 ${revision} 重新生成一个更好的 COORDY_TASK_PLAN_V1 提案。保留用户明确编辑过的约束。当前方案：\n${JSON.stringify(draft)}`;
}
