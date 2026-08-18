import type { Outcome } from "@coordy/protocol";
import { submit, view } from "./client";
import { asAgents, outcomeId } from "./views";

export function acpRunSource(prompt: string) {
  return { type: "Acp" as const, prompt };
}

export async function ensureAcpAgent(workspaceId: string, principalId: string): Promise<string> {
  const agents = asAgents(await view({ type: "Agents", workspace_id: workspaceId }));
  const existing = agents.find((agent) => agent.harness === "acp") ?? agents[0];
  if (existing) return existing.id;
  const created = await submit({
    type: "CreateAgent",
    workspace_id: workspaceId,
    principal_id: principalId,
    name: "助手",
    harness: "acp",
  });
  return outcomeId(created.ids, "agent_id");
}

export async function startAcpRun(input: {
  workspaceId: string;
  principalId: string;
  title: string;
  prompt: string;
}): Promise<{ taskId: string; runId: string; agentId: string }> {
  const agentId = await ensureAcpAgent(input.workspaceId, input.principalId);
  const created = await submit({
    type: "CreateTask",
    workspace_id: input.workspaceId,
    title: input.title.trim() || "新任务",
  });
  const taskId = outcomeId(created.ids, "task_id");
  await submit({ type: "AssignTask", task_id: taskId, agent_id: agentId });
  const run = await submit({
    type: "StartRun",
    task_id: taskId,
    source: acpRunSource(input.prompt.trim() || input.title),
  });
  return { taskId, runId: outcomeId(run.ids, "run_id"), agentId };
}

export async function startAcpOnTask(taskId: string, prompt: string, agentId?: string): Promise<Outcome> {
  if (agentId) {
    await submit({ type: "AssignTask", task_id: taskId, agent_id: agentId });
  }
  return submit({
    type: "StartRun",
    task_id: taskId,
    source: acpRunSource(prompt),
  });
}
