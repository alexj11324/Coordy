import type { Command, NodeKind } from "@coordy/protocol";

export function dependencyIdFromGraphEdgeId(edgeId: string): string | null {
  if (!edgeId.startsWith("dep:")) return null;
  const id = edgeId.slice("dep:".length);
  return id.length > 0 ? id : null;
}

export function reaffirmCommandForStaleEdge(input: {
  edgeId: string;
  stale?: boolean;
  generation?: number;
}): Command | null {
  if (!input.stale) return null;
  const dependency_id = dependencyIdFromGraphEdgeId(input.edgeId);
  if (!dependency_id) return null;
  if (input.generation == null) return null;
  return { type: "ReaffirmDependency", dependency_id, expected_generation: input.generation };
}

export function removeCommandForDependencyEdge(edgeId: string): Command | null {
  const dependency_id = dependencyIdFromGraphEdgeId(edgeId);
  if (!dependency_id) return null;
  return { type: "RemoveDependency", dependency_id };
}

export function declareDependencyCommand(
  workspaceId: string,
  sourceId: string,
  targetId: string,
  entity: string,
  sourceKind: NodeKind = "task",
  targetKind: NodeKind = "task",
): Command {
  return {
    type: "DeclareDependency",
    workspace_id: workspaceId,
    source: { kind: sourceKind, id: sourceId },
    target: { kind: targetKind, id: targetId },
    entity: entity.trim() || "repo",
  };
}

export function updateWorkspaceConductorCommand(
  workspaceId: string,
  agentId: string | null,
): Command {
  return {
    type: "UpdateWorkspace",
    workspace_id: workspaceId,
    conductor_agent_id: agentId && agentId !== "none" ? agentId : "",
  };
}

export function staleDependencyHoldLabel(hasConductor: boolean): string {
  return hasConductor ? "等待总管批准" : "已失效";
}

export function graphConductorStatusLabel(hasConductor: boolean): string | null {
  return hasConductor ? "总管托管中" : null;
}
