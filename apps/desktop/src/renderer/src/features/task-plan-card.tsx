import type { AgentView, ProjectView, SquadView, TaskPlanApplyMode, TaskPlanDraft, TaskPlanProposalView, TaskView } from "@coordy/protocol";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@coordy/ui";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { agentDisplayName } from "../lib/coordy/labels";
import { cloneTaskPlan, nextTaskPlanKey, taskPlanValidationError } from "../lib/coordy/task-plan";

type Props = {
  proposal: TaskPlanProposalView;
  agents: AgentView[];
  squads: SquadView[];
  projects: ProjectView[];
  tasks: TaskView[];
  busy?: boolean;
  onSave: (draft: TaskPlanDraft) => Promise<void>;
  onRegenerate: (draft: TaskPlanDraft) => Promise<void>;
  onApply: (draft: TaskPlanDraft, mode: TaskPlanApplyMode) => Promise<void>;
};

export function TaskPlanCard({ proposal, agents, squads, projects, tasks, busy, onSave, onRegenerate, onApply }: Props) {
  const [draft, setDraft] = useState(() => cloneTaskPlan(proposal.draft));
  useEffect(() => setDraft(cloneTaskPlan(proposal.draft)), [proposal.id, proposal.revision]);
  const changed = useMemo(() => JSON.stringify(draft) !== JSON.stringify(proposal.draft), [draft, proposal.draft]);
  const validationError = taskPlanValidationError(draft);
  const existingParentId = draft.parent.mode === "existing" ? draft.parent.task_id : null;
  const updateCreateParent = (patch: Partial<Extract<TaskPlanDraft["parent"], { mode: "create" }>>) => {
    setDraft((current) => current.parent.mode === "create"
      ? { ...current, parent: { ...current.parent, ...patch } }
      : current);
  };
  const updateChild = (index: number, patch: Partial<TaskPlanDraft["children"][number]>) => {
    setDraft((current) => ({
      ...current,
      children: current.children.map((child, childIndex) => childIndex === index ? { ...child, ...patch } : child),
    }));
  };
  const removeChild = (key: string) => {
    setDraft((current) => ({
      ...current,
      children: current.children
        .filter((child) => child.key !== key)
        .map((child) => ({
          ...child,
          depends_on: (child.depends_on ?? []).filter((dependency) => dependency !== key),
        })),
    }));
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3" aria-label="任务拆分方案">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">任务拆分方案</p>
          <p className="text-xs text-muted-foreground">修订 {proposal.revision} · 确认前不会创建事项</p>
        </div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onRegenerate(draft)}>重新生成</Button>
      </div>

      {draft.parent.mode === "create" ? (
        <div className="space-y-2 rounded-md bg-background p-2">
          <Input aria-label="父事项标题" value={draft.parent.title} onChange={(event) => updateCreateParent({ title: event.target.value })} />
          <Textarea aria-label="父事项说明" rows={2} value={draft.parent.description ?? ""} onChange={(event) => updateCreateParent({ description: event.target.value })} />
          <Select value={draft.parent.project_id ?? "none"} onValueChange={(value) => value && updateCreateParent({ project_id: value === "none" ? null : value })}>
            <SelectTrigger aria-label="父事项项目"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">无项目</SelectItem>{projects.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ) : (
        <p className="rounded-md bg-background p-2 text-sm">添加到：{tasks.find((task) => task.id === existingParentId)?.title ?? existingParentId}</p>
      )}

      <div className="space-y-3">
        {draft.children.map((child, index) => (
          <fieldset key={child.key} className="space-y-2 rounded-md bg-background p-2">
            <div className="flex items-center gap-2">
              <Input aria-label={`子事项 ${index + 1} 标题`} value={child.title} onChange={(event) => updateChild(index, { title: event.target.value })} />
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`删除子事项 ${index + 1}`} onClick={() => removeChild(child.key)}><Trash2 /></Button>
            </div>
            <Textarea aria-label={`子事项 ${index + 1} 说明`} rows={2} value={child.description} onChange={(event) => updateChild(index, { description: event.target.value })} />
            <Textarea aria-label={`子事项 ${index + 1} 验收标准`} rows={2} value={child.acceptance_criteria.join("\n")} onChange={(event) => updateChild(index, { acceptance_criteria: event.target.value.split("\n") })} />
            <div className="grid grid-cols-2 gap-2">
              <Select value={child.priority} onValueChange={(value) => value && updateChild(index, { priority: value })}>
                <SelectTrigger aria-label={`子事项 ${index + 1} 优先级`}><SelectValue /></SelectTrigger>
                <SelectContent>{["urgent", "high", "medium", "low", "none"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
              </Select>
              <Input aria-label={`子事项 ${index + 1} 阶段`} type="number" min={1} value={child.stage} onChange={(event) => updateChild(index, { stage: Number(event.target.value) })} />
            </div>
            <Select
              value={child.assignee ? `${child.assignee.type}:${child.assignee.id}` : "none"}
              onValueChange={(value) => {
                if (!value) return;
                const [type, id] = value.split(":");
                updateChild(index, { assignee: value === "none" ? null : type === "agent" ? { type: "agent", id: id! } : { type: "squad", id: id! } });
              }}
            >
              <SelectTrigger aria-label={`子事项 ${index + 1} 负责人`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">暂不指派</SelectItem>
                {agents.map((item) => <SelectItem key={item.id} value={`agent:${item.id}`}>智能体 · {agentDisplayName(item)}</SelectItem>)}
                {squads.map((item) => <SelectItem key={item.id} value={`squad:${item.id}`}>小队 · {item.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {draft.children.length > 1 ? (
              <div className="space-y-1" aria-label={`子事项 ${index + 1} 依赖`}>
                <p className="text-xs text-muted-foreground">前置事项</p>
                {draft.children.filter((candidate) => candidate.key !== child.key).map((candidate) => (
                  <label key={candidate.key} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={(child.depends_on ?? []).includes(candidate.key)} onChange={(event) => updateChild(index, { depends_on: event.target.checked ? [...(child.depends_on ?? []), candidate.key] : (child.depends_on ?? []).filter((key) => key !== candidate.key) })} />
                    <span>{candidate.title || candidate.key}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </fieldset>
        ))}
      </div>

      <Button type="button" size="sm" variant="ghost" onClick={() => {
        const key = nextTaskPlanKey(draft);
        setDraft({ ...draft, children: [...draft.children, { key, title: "", description: "", acceptance_criteria: [""], priority: "none", stage: 1, depends_on: [], assignee: null }] });
      }}><Plus />添加子事项</Button>
      {validationError ? <p className="text-xs text-destructive">{validationError}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={busy || !changed || Boolean(validationError)} onClick={() => void onSave(draft)}>保存修改</Button>
        <Button size="sm" variant="secondary" disabled={busy || Boolean(validationError)} onClick={() => void onApply(draft, "create_only")}>仅创建</Button>
        <Button size="sm" disabled={busy || Boolean(validationError)} onClick={() => void onApply(draft, "confirm_and_start")}>确认并开始</Button>
      </div>
    </section>
  );
}
