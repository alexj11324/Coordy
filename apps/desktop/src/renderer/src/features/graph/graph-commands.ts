import type { Command, GraphTimelineEventView, NodeKind } from "@coordy/protocol";

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
  return {
    type: "ValidationDecision",
    dependency_id,
    expected_generation: input.generation,
    decision: "reaffirm",
    evidence_refs: ["graph-inspector"],
    rationale: "Member reaffirmed the stale dependency in Graph Inspector.",
    validator_run_id: null,
  };
}

export function removeCommandForDependencyEdge(edgeId: string, generation?: number): Command | null {
  const dependency_id = dependencyIdFromGraphEdgeId(edgeId);
  if (!dependency_id) return null;
  if (generation == null) return null;
  return {
    type: "ValidationDecision",
    dependency_id,
    expected_generation: generation,
    decision: "remove",
    evidence_refs: ["graph-inspector"],
    rationale: "Member removed the dependency in Graph Inspector.",
    validator_run_id: null,
  };
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

export type GraphTimelineEntry = {
  id: string;
  kind: string;
  at: string;
  summary: string;
  edge_id?: string | null;
  node_id?: string | null;
};

export function timelineEntries(events: GraphTimelineEventView[] | undefined): GraphTimelineEntry[] {
  return (events ?? []).map((event) => ({
    id: event.id,
    kind: event.kind,
    at: event.at,
    summary: event.summary,
    edge_id: event.edge_id,
    node_id: event.node_id,
  }));
}
