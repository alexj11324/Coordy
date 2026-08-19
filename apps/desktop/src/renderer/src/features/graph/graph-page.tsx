import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type EdgeMouseHandler,
  type EdgeTypes,
  type NodeMouseHandler,
  type NodeTypes,
  type OnNodesChange,
} from "@xyflow/react";
import {
  Badge,
  Button,
  Input,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@coordy/ui";
import type { GraphEdgeView, GraphEvaluationView, GraphNodeView, GraphTimelineEventView, NodeKind } from "@coordy/protocol";
import { Bot, ListTodo, Share2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  COMING_GRAPH_LAYERS,
  DEFAULT_GRAPH_LAYERS,
  projectGraph,
  type GraphEdge,
  type GraphLayerId,
  type GraphLayers,
  type GraphNode,
} from "../../lib/coordy/graph-projection";
import {
  harnessLabel,
  runStatusLabel,
  taskStatusLabel,
} from "../../lib/coordy/labels";
import { asGraphSnapshot } from "../../lib/coordy/views";
import { useSession } from "../../state/session-store";
import { resolvedTheme, useThemeStore } from "../../state/theme-store";
import { useCommand, useWorkspaceQuery } from "../pages";
import { StatusLamp } from "../status-lamp";
import { AgentGraphNode, TaskGraphNode, type GraphCanvasNode } from "./canvas-nodes";
import { DataEdge, type DataEdgeType } from "./data-edge";
import {
  declareDependencyCommand,
  reaffirmCommandForStaleEdge,
  removeCommandForDependencyEdge,
  timelineEntries,
} from "./graph-commands";
import { layoutGraph } from "./layout";
import { applyGraphDeltaRevision, graphLiveState } from "../../lib/coordy/graph-stream";

const NODE_TYPES: NodeTypes = {
  agent: AgentGraphNode,
  task: TaskGraphNode,
};

const EDGE_TYPES: EdgeTypes = {
  data: DataEdge,
};

const LAYER_ITEMS: { id: GraphLayerId; label: string }[] = [
  { id: "agents", label: "Agents" },
  { id: "tasks", label: "Tasks" },
  { id: "depends", label: "Depends" },
];

function graphSignature(nodes: GraphNode[], edges: GraphEdge[]): string {
  return JSON.stringify({
    nodes: nodes.map((node) => [node.id, node.kind, node.label, node.status, node.replan, node.subtitle]),
    edges: edges.map((edge) => [edge.id, edge.source, edge.target, edge.kind, edge.stale, edge.label]),
  });
}

function toFlowNodes(nodes: GraphNode[], selectedId: string | null): GraphCanvasNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: { x: 0, y: 0 },
    selected: node.id === selectedId,
    data: {
      kind: node.kind,
      label: node.label,
      status: node.status,
      replan: Boolean(node.replan),
      subtitle: node.subtitle ?? "",
    },
  }));
}

function toFlowEdges(edges: GraphEdge[], selectedEdgeId: string | null): DataEdgeType[] {
  return edges.map((edge) => ({
    id: edge.id,
    type: "data",
    source: edge.source,
    target: edge.target,
    selected: edge.id === selectedEdgeId,
    data: {
      kind: edge.kind,
      stale: Boolean(edge.stale),
      label: edge.label ?? "",
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: edge.stale ? "var(--destructive)" : "var(--muted-foreground)",
    },
    style: {
      stroke: edge.stale ? "var(--destructive)" : "var(--muted-foreground)",
    },
  }));
}

function agentStatusLabel(status: string): string {
  if (status === "idle") return "空闲";
  return runStatusLabel(status);
}

function nodeLabel(nodes: GraphNode[], id: string): string {
  return nodes.find((node) => node.id === id)?.label ?? id;
}

function GraphCanvas({
  nodes: sourceNodes,
  edges: sourceEdges,
  selectedId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
}) {
  const { fitView } = useReactFlow();
  const preference = useThemeStore((s) => s.preference);
  const colorMode = resolvedTheme(preference);
  const [nodes, setNodes] = useState<GraphCanvasNode[]>([]);
  const [edges, setEdges] = useState<DataEdgeType[]>([]);
  const signature = useMemo(() => graphSignature(sourceNodes, sourceEdges), [sourceEdges, sourceNodes]);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const selectedEdgeRef = useRef(selectedEdgeId);
  selectedEdgeRef.current = selectedEdgeId;
  const generation = useRef(0);

  useEffect(() => {
    const token = ++generation.current;
    const nextNodes = toFlowNodes(sourceNodes, selectedRef.current);
    const nextEdges = toFlowEdges(sourceEdges, selectedEdgeRef.current);
    if (nextNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }
    let cancelled = false;
    void layoutGraph(nextNodes, nextEdges).then((laidOut) => {
      if (cancelled || token !== generation.current) return;
      setNodes(laidOut.map((node) => ({ ...node, selected: node.id === selectedRef.current })));
      setEdges(nextEdges.map((edge) => ({ ...edge, selected: edge.id === selectedEdgeRef.current })));
      window.requestAnimationFrame(() => {
        void fitView({ padding: 0.18, duration: 180 });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [fitView, signature, sourceEdges, sourceNodes]);

  useEffect(() => {
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === selectedId })));
  }, [selectedId]);

  useEffect(() => {
    setEdges((current) => current.map((edge) => ({ ...edge, selected: edge.id === selectedEdgeId })));
  }, [selectedEdgeId]);

  const onNodesChange: OnNodesChange<GraphCanvasNode> = useCallback((changes) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const onNodeClick: NodeMouseHandler<GraphCanvasNode> = useCallback(
    (_event, node) => {
      onSelectNode(node.id);
    },
    [onSelectNode],
  );

  const onEdgeClick: EdgeMouseHandler<DataEdgeType> = useCallback(
    (_event, edge) => {
      onSelectEdge(edge.id);
    },
    [onSelectEdge],
  );

  return (
    <ReactFlow<GraphCanvasNode, DataEdgeType>
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodesChange={onNodesChange}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onPaneClick={() => {
        onSelectNode(null);
        onSelectEdge(null);
      }}
      nodesConnectable={false}
      edgesReconnectable={false}
      elementsSelectable
      deleteKeyCode={null}
      minZoom={0.2}
      maxZoom={1.6}
      colorMode={colorMode}
      proOptions={{ hideAttribution: true }}
      className="bg-background"
    >
      <Background gap={18} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

function InspectorField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate text-sm">{value || "—"}</p>
    </div>
  );
}

function DependencyActions({
  dependency,
  disabled,
  onReaffirm,
  onRemove,
}: {
  dependency: GraphEdgeView;
  disabled: boolean;
  onReaffirm: (id: string, generation: number) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex gap-2">
      {dependency.valid ? null : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onReaffirm(dependency.id, dependency.generation)}
        >
          确认仍有效
        </Button>
      )}
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onRemove(dependency.id)}>
        移除
      </Button>
    </div>
  );
}

function snapshotNode(nodes: GraphNodeView[], id: string | undefined): GraphNodeView | undefined {
  return nodes.find((node) => node.id === id);
}

function nodeKind(nodes: GraphNodeView[], id: string): NodeKind {
  return snapshotNode(nodes, id)?.kind ?? "task";
}

function GraphInspector({
  selected,
  selectedEdge,
  snapshotNodes,
  snapshotEdges,
  nodes,
  workspaceId,
  events,
  evaluation,
}: {
  selected: GraphNode | null;
  selectedEdge: GraphEdge | null;
  snapshotNodes: GraphNodeView[];
  snapshotEdges: GraphEdgeView[];
  nodes: GraphNode[];
  workspaceId: string | null;
  events: GraphTimelineEventView[];
  evaluation: GraphEvaluationView | undefined;
}) {
  const navigate = useNavigate();
  const command = useCommand();
  const sources = nodes.filter((node) => node.id !== selected?.id);
  const sourceItems = Object.fromEntries(sources.map((node) => [node.id, node.label]));
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [entity, setEntity] = useState("repo");

  useEffect(() => {
    setSourceId(sources[0]?.id ?? "");
    setEntity("repo");
  }, [selected?.id, sources[0]?.id]);

  const reaffirm = (dependencyId: string, generation: number) => {
    command.mutate({ type: "ReaffirmDependency", dependency_id: dependencyId, expected_generation: generation });
  };
  const remove = (dependencyId: string) => {
    command.mutate({ type: "RemoveDependency", dependency_id: dependencyId });
  };

  if (selectedEdge) {
    const dependencyId = selectedEdge.id.startsWith("dep:") ? selectedEdge.id.slice(4) : null;
    const dependency = dependencyId
      ? snapshotEdges.find((item) => item.id === dependencyId && item.kind === "consumes")
      : null;
    const reaffirmCmd = reaffirmCommandForStaleEdge({
      edgeId: selectedEdge.id,
      stale: selectedEdge.stale,
      generation: selectedEdge.generation,
    });
    const removeCmd = removeCommandForDependencyEdge(selectedEdge.id);
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Share2 className="size-4 text-muted-foreground" />
          <h2 className="truncate text-sm font-medium">{selectedEdge.label || "边"}</h2>
          {selectedEdge.stale ? <Badge variant="destructive">失效</Badge> : null}
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-4">
            <InspectorField label="上游 source" value={nodeLabel(nodes, selectedEdge.source)} />
            <InspectorField label="下游 target" value={nodeLabel(nodes, selectedEdge.target)} />
            <InspectorField label="类型" value={selectedEdge.kind === "assigned" ? "指派" : "依赖"} />
            {dependency ? <InspectorField label="实体" value={dependency.entity} /> : null}
            {dependency ? <InspectorField label="generation" value={String(dependency.generation)} /> : null}
          </div>
        </ScrollArea>
        {dependency && (reaffirmCmd || removeCmd) ? (
          <div className="space-y-2 border-t border-border p-3">
            <DependencyActions
              dependency={dependency}
              disabled={command.isPending}
              onReaffirm={reaffirm}
              onRemove={remove}
            />
          </div>
        ) : null}
      </div>
    );
  }

  if (!selected) {
    const timeline = timelineEntries(events);
    const diagnostics = evaluation?.diagnostics ?? [];
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Share2 className="size-4 text-muted-foreground" />
          <h2 className="truncate text-sm font-medium">图诊断</h2>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">时间线</p>
              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">还没有图事件。选中节点可声明依赖。</p>
              ) : (
                timeline.map((entry) => (
                  <div key={entry.id} className="rounded-md border border-border px-2 py-1.5">
                    <p className="text-sm">{entry.summary}</p>
                    <p className="text-[11px] text-muted-foreground">{entry.kind}</p>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">诊断</p>
              {diagnostics.length === 0 ? (
                <p className="text-sm text-muted-foreground">无阻塞诊断</p>
              ) : (
                diagnostics.map((line) => (
                  <p key={line} className="text-sm">
                    {line}
                  </p>
                ))
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }
  const detail = snapshotNode(snapshotNodes, selected.id);
  if (selected.kind === "agent") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Bot className="size-4 text-muted-foreground" />
          <h2 className="truncate text-sm font-medium">{selected.label}</h2>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-4">
            <InspectorField label="名称" value={detail?.title ?? selected.label} />
            <InspectorField
              label="Harness"
              value={detail?.harness ? harnessLabel(detail.harness) : selected.subtitle ?? ""}
            />
            <InspectorField label="状态" value={agentStatusLabel(selected.status)} />
            {selected.replan ? <Badge variant="destructive">需重规划</Badge> : null}
          </div>
        </ScrollArea>
        <div className="border-t border-border p-3">
          <Button type="button" size="sm" className="w-full" onClick={() => navigate(`/agents/${selected.id}`)}>
            打开智能体
          </Button>
        </div>
      </div>
    );
  }
  const assignee = snapshotNode(snapshotNodes, detail?.assignee_agent_id ?? undefined);
  const blockers = snapshotEdges.filter(
    (edge) => edge.kind === "precedence" && edge.target.id === selected.id,
  );
  const incoming = snapshotEdges.filter(
    (edge) => edge.kind === "consumes" && edge.target.id === selected.id,
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <ListTodo className="size-4 text-muted-foreground" />
        <h2 className="truncate text-sm font-medium">{selected.label}</h2>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <InspectorField label="标题" value={detail?.title ?? selected.label} />
          <InspectorField label="编号" value={detail?.subtitle || selected.subtitle || ""} />
          <InspectorField label="状态" value={taskStatusLabel(detail?.status ?? selected.status)} />
          <InspectorField label="指派智能体" value={assignee ? assignee.title : "未指派"} />
          {detail?.blocked_reason ? <InspectorField label="阻塞原因" value={detail.blocked_reason} /> : null}
          {evaluation?.blocked_nodes
            .find((row) => row.node_id === selected.id)
            ?.reasons.map((reason) => (
              <InspectorField key={reason} label="图阻塞" value={reason} />
            ))}
          {(evaluation?.diagnostics ?? [])
            .filter((line) => line.startsWith(`${selected.id}:`))
            .map((line) => (
              <InspectorField key={line} label="诊断" value={line} />
            ))}
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">阻塞边</p>
            {blockers.length === 0 ? (
              <p className="text-sm text-muted-foreground">无前置事项</p>
            ) : (
              blockers.map((blocker) => (
                <div key={blocker.id} className="rounded-md border border-border px-2 py-1.5 text-sm">
                  {nodeLabel(nodes, blocker.source.id)}
                </div>
              ))
            )}
          </div>
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">依赖边（上游 source）</p>
            {incoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">未声明依赖</p>
            ) : (
              incoming.map((dep) => (
                <div key={dep.id} className="space-y-2 rounded-md border border-border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm">{nodeLabel(nodes, dep.source.id)}</p>
                    {dep.valid ? (
                      <Badge variant="secondary">{dep.entity || "依赖"}</Badge>
                    ) : (
                      <Badge variant="destructive">失效</Badge>
                    )}
                  </div>
                  <DependencyActions
                    dependency={dep}
                    disabled={command.isPending}
                    onReaffirm={reaffirm}
                    onRemove={remove}
                  />
                </div>
              ))
            )}
          </div>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!workspaceId || !sourceId || sourceId === selected.id) return;
              command.mutate(
                declareDependencyCommand(
                  workspaceId,
                  sourceId,
                  selected.id,
                  entity,
                  nodeKind(snapshotNodes, sourceId),
                  nodeKind(snapshotNodes, selected.id),
                ),
              );
            }}
          >
            <p className="text-[11px] text-muted-foreground">声明依赖（选择上游 source）</p>
            <Select value={sourceId} items={sourceItems} onValueChange={(value) => value && setSourceId(value)}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sources.map((node) => (
                  <SelectItem key={node.id} value={node.id}>
                    {node.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="实体，默认 repo"
              value={entity}
              onChange={(event) => setEntity(event.target.value)}
            />
            <Button type="submit" size="sm" className="w-full" disabled={!workspaceId || !sourceId || command.isPending}>
              声明依赖
            </Button>
          </form>
        </div>
      </ScrollArea>
      <div className="border-t border-border p-3">
        <Button type="button" size="sm" className="w-full" onClick={() => navigate(`/board/${selected.id}`)}>
          打开事项
        </Button>
      </div>
    </div>
  );
}

export function GraphPage() {
  const snapQuery = useWorkspaceQuery((workspace_id) => ({ type: "GraphSnapshot", workspace_id }));
  const workspaceId = useSession((s) => s.workspaceId);
  const snapshot = asGraphSnapshot(snapQuery.data);
  const [layers, setLayers] = useState<GraphLayers>(DEFAULT_GRAPH_LAYERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [deltaRevision, setDeltaRevision] = useState<number | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const projected = useMemo(() => projectGraph({ snapshot, layers }), [layers, snapshot]);
  const selected = projected.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedEdge = projected.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const liveState = graphLiveState({
    consistent: snapshot?.health.consistent === true,
    snapshotRevision: snapshot?.revision ?? 0,
    deltaRevision,
    subscribed,
  });

  useEffect(() => {
    const api = window.coordy;
    if (!api?.subscribe) {
      setSubscribed(false);
      return;
    }
    setSubscribed(true);
    return api.subscribe((effect) => {
      if (effect.type !== "GraphDelta") return;
      if (workspaceId && effect.workspace_id !== workspaceId) return;
      setDeltaRevision((current) => applyGraphDeltaRevision(current ?? 0, effect.revision));
    });
  }, [workspaceId]);

  useEffect(() => {
    if (selectedId && !projected.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(null);
    }
  }, [projected.nodes, selectedId]);

  useEffect(() => {
    if (selectedEdgeId && !projected.edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [projected.edges, selectedEdgeId]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-48 shrink-0 flex-col border-r border-border">
          <header className="flex h-12 items-center gap-2 border-b border-border px-3">
            <Share2 className="size-4 text-muted-foreground" />
            <h1 className="text-sm font-medium">图层</h1>
          </header>
          <div className="space-y-3 p-3">
            {LAYER_ITEMS.map((item) => (
              <label key={item.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{item.label}</span>
                <Switch
                  size="sm"
                  checked={layers[item.id]}
                  onCheckedChange={(checked) =>
                    setLayers((current) => ({ ...current, [item.id]: Boolean(checked) }))
                  }
                />
              </label>
            ))}
            <div className="pt-2">
              <p className="mb-2 text-[11px] text-muted-foreground">后续图层</p>
              {COMING_GRAPH_LAYERS.map((item) => (
                <label
                  key={item.id}
                  className="mb-2 flex items-center justify-between gap-2 text-sm text-muted-foreground"
                >
                  <span>{item.label}</span>
                  <Switch size="sm" checked={false} disabled />
                </label>
              ))}
            </div>
          </div>
        </aside>
        <div className="relative min-h-0 min-w-0 flex-1">
          <ReactFlowProvider>
            <GraphCanvas
              nodes={projected.nodes}
              edges={projected.edges}
              selectedId={selectedId}
              selectedEdgeId={selectedEdgeId}
              onSelectNode={(id) => {
                setSelectedId(id);
                if (id) setSelectedEdgeId(null);
              }}
              onSelectEdge={(id) => {
                setSelectedEdgeId(id);
                if (id) setSelectedId(null);
              }}
            />
          </ReactFlowProvider>
          {projected.nodes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded-md bg-background/80 px-3 py-2 text-sm text-muted-foreground">
                还没有可投影的智能体或事项
              </p>
            </div>
          ) : null}
        </div>
        <aside className="w-80 shrink-0 border-l border-border">
          <GraphInspector
            selected={selected}
            selectedEdge={selectedEdge}
            snapshotNodes={snapshot?.nodes ?? []}
            snapshotEdges={snapshot?.edges ?? []}
            nodes={projected.nodes}
            workspaceId={workspaceId}
            events={snapshot?.events ?? []}
            evaluation={snapshot?.evaluation}
          />
        </aside>
      </div>
      <footer className="flex h-8 shrink-0 items-center gap-2 border-t border-border px-3 text-xs text-muted-foreground">
        <StatusLamp tone={liveState.tone} label="Live" />
        <span>{liveState.live ? "Live" : `cursor lag ${liveState.lag}`}</span>
      </footer>
    </section>
  );
}

