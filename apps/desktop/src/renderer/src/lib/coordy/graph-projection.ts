import type { AgentView, DependencyView, RunView, TaskView } from "@coordy/protocol";
import { taskIdentifier } from "./issues";
import { agentDisplayName, listableAgents } from "./labels";

export type GraphLayerId = "agents" | "tasks" | "depends";

export type GraphLayers = Record<GraphLayerId, boolean>;

export const DEFAULT_GRAPH_LAYERS: GraphLayers = {
  agents: true,
  tasks: true,
  depends: true,
};

export const COMING_GRAPH_LAYERS = [
  { id: "memory", label: "Memory" },
  { id: "files", label: "Files" },
  { id: "contract", label: "Contract" },
  { id: "authority", label: "Authority" },
  { id: "communication", label: "通信" },
] as const;

export type GraphNodeKind = "agent" | "task";
export type GraphEdgeKind = "assigned" | "depends_on";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  status: string;
  replan?: boolean;
  subtitle?: string;
};

export type GraphEdge = {
  id: string;
  kind: GraphEdgeKind;
  source: string;
  target: string;
  stale?: boolean;
  label?: string;
};

export type GraphProjectionInput = {
  agents: AgentView[];
  tasks: TaskView[];
  dependencies?: DependencyView[];
  runs?: RunView[];
  layers?: Partial<GraphLayers>;
};

function pausedRun(run: RunView): boolean {
  return run.status === "paused" || run.queue_status === "paused";
}

function runningRun(run: RunView): boolean {
  return run.status === "running" || run.queue_status === "running";
}

function resolveLayers(layers?: Partial<GraphLayers>): GraphLayers {
  return { ...DEFAULT_GRAPH_LAYERS, ...layers };
}

export function projectGraph(input: GraphProjectionInput): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const layers = resolveLayers(input.layers);
  const agents = listableAgents(input.agents);
  const tasks = input.tasks.filter((task) => Boolean(task.id) && task.status !== "deleted");
  const dependencies = input.dependencies ?? [];
  const runs = input.runs ?? [];

  const staleFromIds = new Set(
    dependencies.filter((dep) => !dep.valid).map((dep) => dep.from_id),
  );

  const nodes: GraphNode[] = [];
  if (layers.agents) {
    for (const agent of agents) {
      const agentRuns = runs.filter((run) => run.agent_id === agent.id);
      const replan =
        agentRuns.some(pausedRun) ||
        staleFromIds.has(agent.id) ||
        tasks.some((task) => task.assignee_agent_id === agent.id && staleFromIds.has(task.id));
      const status = agentRuns.some(runningRun) ? "running" : replan ? "paused" : "idle";
      nodes.push({
        id: agent.id,
        kind: "agent",
        label: agentDisplayName(agent),
        status,
        replan,
        subtitle: agent.harness,
      });
    }
  }
  if (layers.tasks) {
    for (const task of tasks) {
      nodes.push({
        id: task.id,
        kind: "task",
        label: task.title,
        status: task.status,
        subtitle: taskIdentifier(task),
      });
    }
  }

  const visible = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = [];

  if (layers.agents && layers.tasks) {
    for (const task of tasks) {
      const agentId = task.assignee_agent_id?.trim();
      if (!agentId || !visible.has(agentId) || !visible.has(task.id)) continue;
      edges.push({
        id: `assigned:${agentId}:${task.id}`,
        kind: "assigned",
        source: agentId,
        target: task.id,
        label: "指派",
      });
    }
  }

  if (layers.depends) {
    for (const task of tasks) {
      for (const blockerId of task.blocker_ids ?? []) {
        if (!blockerId || blockerId === task.id) continue;
        if (!visible.has(blockerId) || !visible.has(task.id)) continue;
        edges.push({
          id: `blocker:${blockerId}:${task.id}`,
          kind: "depends_on",
          source: blockerId,
          target: task.id,
          label: "前置",
        });
      }
    }
    for (const dep of dependencies) {
      if (!dep.from_id || !dep.to_id || dep.from_id === dep.to_id) continue;
      if (!visible.has(dep.from_id) || !visible.has(dep.to_id)) continue;
      edges.push({
        id: `dep:${dep.id}`,
        kind: "depends_on",
        source: dep.from_id,
        target: dep.to_id,
        stale: !dep.valid,
        label: dep.valid ? dep.entity || "依赖" : "失效",
      });
    }
  }

  return { nodes, edges };
}
