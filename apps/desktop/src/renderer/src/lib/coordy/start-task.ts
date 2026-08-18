import type { Outcome } from "@coordy/protocol";
import { submit, view } from "./client";
import { asAgents, isPlaceholderHarness, outcomeId } from "./views";

export function acpRunSource(prompt: string) {
  return { type: "Acp" as const, prompt };
}

export async function syncDiscoveredAgents(
  workspaceId: string,
  principalId: string,
  refresh = false,
) {
  if (refresh) {
    await window.coordy.discoverAgents(true);
  }
  return window.coordy.importAgents({
    workspace_id: workspaceId,
    principal_id: principalId,
  });
}

export async function pickAgentId(workspaceId: string, preferredId?: string | null): Promise<string> {
  const agents = asAgents(await view({ type: "Agents", workspace_id: workspaceId }));
  if (preferredId && agents.some((agent) => agent.id === preferredId)) return preferredId;
  const live =
    agents.find((agent) => !isPlaceholderHarness(agent.harness) && agent.harness !== "coordy-stub") ??
    agents.find((agent) => !isPlaceholderHarness(agent.harness)) ??
    agents[0];
  if (live) return live.id;
  throw new Error("还没有助手。本机会从 PATH 和 ACP Registry 自动导入，请稍后再试或打开「助手」页。");
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
