import type { Outcome } from "@coordy/protocol";
import { storedAgentAvatar } from "./agent-avatar";
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
  model?: string;
  access?: string;
  avatar?: string;
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
  const model = input.model?.trim() ?? "";
  const access = input.access?.trim() ?? "";
  const avatar = storedAgentAvatar(input.avatar, agentId);
  await submit({
    type: "UpdateAgent",
    agent_id: agentId,
    description: description || null,
    instructions: instructions || null,
    model: model || null,
    access: access || null,
    avatar,
  });
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
  throw new Error("工作区中还没有智能体。请先在「智能体」页创建。");
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

export function chatTurnCommands(input: {
  chatId: string;
  taskId: string;
  agentId: string;
  prompt: string;
}) {
  return [
    { type: "SetTaskStatus" as const, task_id: input.taskId, status: "open" },
    { type: "AssignTask" as const, task_id: input.taskId, agent_id: input.agentId },
    {
      type: "StartRun" as const,
      task_id: input.taskId,
      source: acpRunSource(input.prompt),
      agent_id: input.agentId,
      chat_id: input.chatId,
      trigger: "chat" as const,
    },
  ] as const;
}

export async function startChatTurn(input: {
  chatId: string;
  taskId: string;
  agentId: string;
  prompt: string;
}): Promise<Outcome> {
  const [status, assign, run] = chatTurnCommands(input);
  await submit(status);
  await submit(assign);
  return submit(run);
}
