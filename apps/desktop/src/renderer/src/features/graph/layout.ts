import type { Edge, Node } from "@xyflow/react";
import ElkConstructor from "elkjs/lib/elk.bundled.js";

const elk = new ElkConstructor();

const NODE_WIDTH = 220;
const NODE_HEIGHT = 88;

export async function layoutGraph<N extends Node, E extends Edge>(nodes: N[], edges: E[]): Promise<N[]> {
  if (nodes.length === 0) return nodes;
  const laidOut = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "SPLINES",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.spacing.nodeNode": "40",
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: node.measured?.width ?? NODE_WIDTH,
      height: node.measured?.height ?? NODE_HEIGHT,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  });
  const positions = new Map(
    (laidOut.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]),
  );
  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
}
