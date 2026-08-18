import type { Outcome } from "@coordy/protocol";
import { submit, view } from "./client";
import { asAgents, isPlaceholderHarness, outcomeId } from "./views";

export function acpRunSource(prompt: string) {
  return { type: "Acp" as const, prompt };
}

export async function createNamedAgent(input: {
  workspaceId: string;
  principalId: string;
  name: string;
  harness: string;
  description?: string;
  instructions?: string;
}): Promise<string> {
  const created = await submit({
    type: "CreateAgent",
    workspace_id: input.workspaceId,
    principal_id: input.principalId,
    name: input.name.trim(),
    harness: input.harness,
  });
  const agentId = outcomeId(created.ids, "agent_id");
  const description = input.description?.trim() ?? "";
  const instructions = input.instructions?.trim() ?? "";
  if (description || instructions) {
    await submit({
      type: "UpdateAgent",
      agent_id: agentId,
      description: description || null,
      instructions: instructions || null,
    });
  }
  return agentId;
}

export async function pickAgentId(workspaceId: string, preferredId?: string | null): Promise<string> {
  const agents = asAgents(await view({ type: "Agents", workspace_id: workspaceId }));
  if (preferredId && agents.some((agent) => agent.id === preferredId)) return preferredId;
  const live =
    agents.find((agent) => !isPlaceholderHarness(agent.harness) && agent.harness !== "coordy-stub") ??
    agents.find((agent) => !isPlaceholderHarness(agent.harness)) ??
    agents[0];
  if (live) return live.id;
  throw new Error("还没有智能体。请先打开「智能体」页，点新建智能体。");
}

export async function startAcpRun(input: {
  workspaceId: string;
  principalId: string;
  title: string;
  prompt: string;
  agentId?: string | null;
}): Promise<{ taskId: string; runId: string; agentId: string }> {
  const agentId = await pickAgentId(input.workspaceId, input.agentId);
  const created = await submit({
    type: "CreateTask",
    workspace_id: input.workspaceId,
    title: input.title.trim() || "新事项",
    description: input.prompt.trim(),
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
