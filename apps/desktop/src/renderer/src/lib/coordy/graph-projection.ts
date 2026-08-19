import type { GraphEdgeKind as ProtocolEdgeKind, GraphEdgeView, GraphNodeView, GraphSnapshotView } from "@coordy/protocol";
import { isPlaceholderHarness } from "./views";

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
  generation?: number;
};

export type GraphProjectionInput = {
  snapshot?: GraphSnapshotView | null;
  layers?: Partial<GraphLayers>;
};

function resolveLayers(layers?: Partial<GraphLayers>): GraphLayers {
  return { ...DEFAULT_GRAPH_LAYERS, ...layers };
}

function canvasKind(kind: GraphNodeView["kind"]): GraphNodeKind {
  return kind === "agent" ? "agent" : "task";
}

function projectedEdgeId(edge: GraphEdgeView): string {
  if (edge.id.startsWith("dep:") || edge.id.startsWith("blocker:") || edge.id.startsWith("assigned:")) {
    return edge.id;
  }
  return `dep:${edge.id}`;
}

function edgeVisible(kind: ProtocolEdgeKind, layers: GraphLayers): boolean {
  if (kind === "assigned_to") return layers.agents && layers.tasks;
  if (kind === "consumes" || kind === "precedence") return layers.depends;
  return layers.depends;
}

function edgeKind(kind: ProtocolEdgeKind): GraphEdgeKind {
  return kind === "assigned_to" ? "assigned" : "depends_on";
}

function edgeLabel(edge: GraphEdgeView): string {
  if (edge.kind === "assigned_to") return "指派";
  if (edge.kind === "precedence") return "前置";
  if (!edge.valid || edge.state !== "active") return "失效";
  return edge.entity || "依赖";
}

export function projectGraph(input: GraphProjectionInput): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const layers = resolveLayers(input.layers);
  const snapshot = input.snapshot;
  if (!snapshot) return { nodes: [], edges: [] };

  const nodes: GraphNode[] = [];
  for (const node of snapshot.nodes) {
    if (node.kind === "agent") {
      if (!layers.agents) continue;
      if (isPlaceholderHarness(node.harness ?? node.subtitle ?? "")) continue;
    } else if (!layers.tasks) {
      continue;
    }
    nodes.push({
      id: node.id,
      kind: canvasKind(node.kind),
      label: node.title,
      status: node.status,
      replan: Boolean(node.replan),
      subtitle: node.subtitle,
    });
  }

  const visible = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = [];
  for (const edge of snapshot.edges) {
    if (!edgeVisible(edge.kind, layers)) continue;
    if (!edge.source?.id || !edge.target?.id || edge.source.id === edge.target.id) continue;
    if (!visible.has(edge.source.id) || !visible.has(edge.target.id)) continue;
    const stale = edge.kind === "consumes" && (!edge.valid || edge.state !== "active");
    edges.push({
      id: projectedEdgeId(edge),
      kind: edgeKind(edge.kind),
      source: edge.source.id,
      target: edge.target.id,
      stale,
      label: edgeLabel(edge),
      generation: edge.generation,
    });
  }

  return { nodes, edges };
}
