import type { Actor, AgentView, Outcome } from "@coordy/protocol";
import { storedAgentAvatar } from "./agent-avatar";
import { submit, view } from "./client";
import { asAgents, isPlaceholderHarness, outcomeId } from "./views";
import { useSession } from "../../state/session-store";

export function acpRunSource(prompt: string) {
  return { type: "Acp" as const, prompt };
}

export function taskSplitRequest(input: {
  workspaceId: string;
  taskId: string;
  principalId: string;
}) {
  return {
    workspace_id: input.workspaceId,
    task_id: input.taskId,
    principal_id: input.principalId,
  };
}

export async function createNamedAgent(input: {
  workspaceId: string;
  principalId: string;
  name: string;
  harness: string;
  description?: string;
  instructions?: string;
  model?: string;
  thinking?: string;
  speed?: string;
  access?: string;
  toolAccess?: string;
  avatar?: string;
}): Promise<string> {
  const created = await submit({
    type: "CreateConfiguredAgent",
    workspace_id: input.workspaceId,
    principal_id: input.principalId,
    name: input.name.trim(),
    harness: input.harness,
    description: input.description?.trim() ?? "",
    instructions: input.instructions?.trim() ?? "",
    model: input.model?.trim() ?? "",
    thinking: input.thinking?.trim() ?? "",
    speed: input.speed?.trim() ?? "",
    access: input.access?.trim() || "owner",
    tool_access: input.toolAccess?.trim() || "auto",
    avatar: storedAgentAvatar(input.avatar, input.name.trim() || "agent"),
  });
  return outcomeId(created.ids, "agent_id");
}

export async function pickAgentId(
  workspaceId: string,
  preferredId?: string | null,
  actor?: Actor,
): Promise<string> {
  const agents = asAgents(
    await view({ type: "Agents", workspace_id: workspaceId }, actor),
  );
  return resolveAgentId(agents, preferredId);
}

export function normalizedAgentId(
  agents: AgentView[],
  selectedId?: string | null,
): string {
  if (selectedId && agents.some((agent) => agent.id === selectedId)) {
    return selectedId;
  }
  return agents[0]?.id ?? "";
}

export function resolveAgentId(
  agents: AgentView[],
  preferredId?: string | null,
): string {
  if (preferredId) {
    if (agents.some((agent) => agent.id === preferredId)) return preferredId;
    throw new Error("所选智能体不属于当前工作区。请重新选择。");
  }
  const live =
    agents.find(
      (agent) =>
        !isPlaceholderHarness(agent.harness) && agent.harness !== "coordy-stub",
    ) ??
    agents.find((agent) => !isPlaceholderHarness(agent.harness)) ??
    agents[0];
  if (live) return live.id;
  throw new Error("工作区中暂无智能体。请先在「智能体」页创建。");
}

export async function startAcpRun(input: {
  workspaceId: string;
  principalId: string;
  title: string;
  prompt: string;
  agentId?: string | null;
}): Promise<{ taskId: string; runId: string; agentId: string }> {
  const actor = useSession.getState().actor;
  const agentId = await pickAgentId(input.workspaceId, input.agentId, actor);
  const created = await submit({
    type: "CreateTask",
    workspace_id: input.workspaceId,
    title: input.title.trim() || "新事项",
    description: input.prompt.trim(),
  }, actor);
  const taskId = outcomeId(created.ids, "task_id");
  await submit({ type: "AssignTask", task_id: taskId, agent_id: agentId }, actor);
  const run = await submit({
    type: "StartRun",
    task_id: taskId,
    source: acpRunSource(input.prompt.trim() || input.title),
  }, actor);
  return { taskId, runId: outcomeId(run.ids, "run_id"), agentId };
}

export async function startAcpOnTask(
  taskId: string,
  prompt: string,
  agentId?: string,
): Promise<Outcome> {
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
    {
      type: "AssignTask" as const,
      task_id: input.taskId,
      agent_id: input.agentId,
    },
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
