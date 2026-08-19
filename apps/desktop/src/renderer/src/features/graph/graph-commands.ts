import type { Command } from "@coordy/protocol";

export function dependencyIdFromGraphEdgeId(edgeId: string): string | null {
  if (!edgeId.startsWith("dep:")) return null;
  const id = edgeId.slice("dep:".length);
  return id.length > 0 ? id : null;
}

export function reaffirmCommandForStaleEdge(input: {
  edgeId: string;
  stale?: boolean;
}): Command | null {
  if (!input.stale) return null;
  const dependency_id = dependencyIdFromGraphEdgeId(input.edgeId);
  if (!dependency_id) return null;
  return { type: "ReaffirmDependency", dependency_id };
}

export function removeCommandForDependencyEdge(edgeId: string): Command | null {
  const dependency_id = dependencyIdFromGraphEdgeId(edgeId);
  if (!dependency_id) return null;
  return { type: "RemoveDependency", dependency_id };
}

export function declareDependencyCommand(
  workspaceId: string,
  fromId: string,
  toId: string,
  entity: string,
): Command {
  return {
    type: "DeclareDependency",
    workspace_id: workspaceId,
    from_id: fromId,
    to_id: toId,
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
