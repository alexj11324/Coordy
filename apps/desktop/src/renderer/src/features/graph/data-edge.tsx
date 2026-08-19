import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { cn } from "@coordy/ui";
import type { GraphEdgeKind } from "../../lib/coordy/graph-projection";

export type DataEdgeData = {
  kind: GraphEdgeKind;
  stale: boolean;
  label: string;
};

export type DataEdgeType = Edge<DataEdgeData, "data">;

export function DataEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  style,
  selected,
}: EdgeProps<DataEdgeType>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const stale = Boolean(data?.stale);
  const label = data?.label?.trim();

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        className={cn("data-edge", stale && "data-edge-stale")}
        style={{
          stroke: stale ? "var(--destructive)" : undefined,
          strokeDasharray: stale ? "6 4" : data?.kind === "assigned" ? "5 4" : undefined,
          strokeWidth: selected ? 2 : 1,
          ...style,
        }}
      />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className={cn(
              "nodrag nopan pointer-events-none absolute rounded-sm px-1 py-px text-[10px]",
              stale ? "bg-destructive/15 text-destructive" : "bg-background/90 text-muted-foreground",
            )}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
