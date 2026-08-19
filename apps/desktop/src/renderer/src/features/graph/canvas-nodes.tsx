import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Badge } from "@coordy/ui";
import type { GraphNodeKind } from "../../lib/coordy/graph-projection";
import { harnessLabel, taskStatusLabel } from "../../lib/coordy/labels";
import { StatusGlyph } from "../issue-status";
import { BaseNode, BaseNodeContent, BaseNodeHeader, BaseNodeHeaderTitle } from "./base-node";
import { NodeStatusIndicator, type NodeStatus } from "./node-status-indicator";

export type GraphCanvasNodeData = {
  kind: GraphNodeKind;
  label: string;
  status: string;
  replan: boolean;
  subtitle: string;
};

export type GraphCanvasNode = Node<GraphCanvasNodeData, GraphNodeKind>;

function statusIndicator(kind: GraphNodeKind, status: string, replan: boolean): NodeStatus {
  if (replan || status === "paused" || status === "blocked") return "error";
  if (status === "running") return "loading";
  if (kind === "task" && status === "done") return "success";
  return "initial";
}

function GraphEntityNode({
  data,
  selected,
}: NodeProps<GraphCanvasNode>) {
  return (
    <NodeStatusIndicator status={statusIndicator(data.kind, data.status, data.replan)}>
      <BaseNode selected={selected} className="w-[220px]">
        <Handle type="target" position={Position.Left} className="!size-2 !border-border !bg-muted-foreground/50" />
        <BaseNodeHeader>
          <StatusGlyph status={data.kind === "task" ? data.status : data.status === "running" ? "running" : "open"} />
          <BaseNodeHeaderTitle>{data.label}</BaseNodeHeaderTitle>
          {data.replan ? (
            <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
              重规划
            </Badge>
          ) : null}
        </BaseNodeHeader>
        <BaseNodeContent>
          <p className="truncate text-[11px] text-muted-foreground">
            {data.kind === "agent"
              ? harnessLabel(data.subtitle) || data.subtitle || "智能体"
              : data.subtitle || taskStatusLabel(data.status)}
          </p>
        </BaseNodeContent>
        <Handle type="source" position={Position.Right} className="!size-2 !border-border !bg-muted-foreground/50" />
      </BaseNode>
    </NodeStatusIndicator>
  );
}

export function AgentGraphNode(props: NodeProps<GraphCanvasNode>) {
  return <GraphEntityNode {...props} />;
}

export function TaskGraphNode(props: NodeProps<GraphCanvasNode>) {
  return <GraphEntityNode {...props} />;
}
