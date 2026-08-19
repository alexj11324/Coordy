import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type EdgeTypes,
  type NodeMouseHandler,
  type NodeTypes,
  type OnNodesChange,
} from "@xyflow/react";
import { Badge, Button, ScrollArea, Switch } from "@coordy/ui";
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
import { taskIdentifier } from "../../lib/coordy/issues";
import {
  agentDisplayName,
  harnessLabel,
  runStatusLabel,
  taskStatusLabel,
} from "../../lib/coordy/labels";
import { asAgents, asDependencies, asRuns, asTasks } from "../../lib/coordy/views";
import { resolvedTheme, useThemeStore } from "../../state/theme-store";
import { useWorkspaceQuery } from "../pages";
import { StatusLamp } from "../status-lamp";
import { AgentGraphNode, TaskGraphNode, type GraphCanvasNode } from "./canvas-nodes";
import { DataEdge, type DataEdgeType } from "./data-edge";
import { layoutGraph } from "./layout";

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

function toFlowEdges(edges: GraphEdge[]): DataEdgeType[] {
  return edges.map((edge) => ({
    id: edge.id,
    type: "data",
    source: edge.source,
    target: edge.target,
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

function GraphCanvas({
  nodes: sourceNodes,
  edges: sourceEdges,
  selectedId,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { fitView } = useReactFlow();
  const preference = useThemeStore((s) => s.preference);
  const colorMode = resolvedTheme(preference);
  const [nodes, setNodes] = useState<GraphCanvasNode[]>([]);
  const [edges, setEdges] = useState<DataEdgeType[]>([]);
  const signature = useMemo(() => graphSignature(sourceNodes, sourceEdges), [sourceEdges, sourceNodes]);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const generation = useRef(0);

  useEffect(() => {
    const token = ++generation.current;
    const nextNodes = toFlowNodes(sourceNodes, selectedRef.current);
    const nextEdges = toFlowEdges(sourceEdges);
    if (nextNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }
    let cancelled = false;
    void layoutGraph(nextNodes, nextEdges).then((laidOut) => {
      if (cancelled || token !== generation.current) return;
      setNodes(laidOut.map((node) => ({ ...node, selected: node.id === selectedRef.current })));
      setEdges(nextEdges);
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

  const onNodesChange: OnNodesChange<GraphCanvasNode> = useCallback((changes) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const onNodeClick: NodeMouseHandler<GraphCanvasNode> = useCallback(
    (_event, node) => {
      onSelect(node.id);
    },
    [onSelect],
  );

  return (
    <ReactFlow<GraphCanvasNode, DataEdgeType>
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodesChange={onNodesChange}
      onNodeClick={onNodeClick}
      onPaneClick={() => onSelect(null)}
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

function GraphInspector({
  selected,
  agents,
  tasks,
}: {
  selected: GraphNode | null;
  agents: ReturnType<typeof asAgents>;
  tasks: ReturnType<typeof asTasks>;
}) {
  const navigate = useNavigate();
  if (!selected) {
    return (
      <div className="flex h-full items-center px-4 text-sm text-muted-foreground">选中节点查看只读详情</div>
    );
  }
  if (selected.kind === "agent") {
    const agent = agents.find((item) => item.id === selected.id);
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Bot className="size-4 text-muted-foreground" />
          <h2 className="truncate text-sm font-medium">{selected.label}</h2>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-4">
            <InspectorField label="名称" value={agent ? agentDisplayName(agent) : selected.label} />
            <InspectorField label="Harness" value={agent ? harnessLabel(agent.harness) : selected.subtitle ?? ""} />
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
  const task = tasks.find((item) => item.id === selected.id);
  const assignee = agents.find((item) => item.id === task?.assignee_agent_id);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <ListTodo className="size-4 text-muted-foreground" />
        <h2 className="truncate text-sm font-medium">{selected.label}</h2>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">
          <InspectorField label="标题" value={task?.title ?? selected.label} />
          <InspectorField label="编号" value={task ? taskIdentifier(task) : selected.subtitle ?? ""} />
          <InspectorField label="状态" value={taskStatusLabel(task?.status ?? selected.status)} />
          <InspectorField label="指派智能体" value={assignee ? agentDisplayName(assignee) : "未指派"} />
          {task?.blocked_reason ? <InspectorField label="阻塞原因" value={task.blocked_reason} /> : null}
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
  const board = useWorkspaceQuery((workspace_id) => ({ type: "Board", workspace_id }));
  const agentsQuery = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const depsQuery = useWorkspaceQuery((workspace_id) => ({ type: "Dependencies", workspace_id }));
  const runsQuery = useWorkspaceQuery((workspace_id) => ({ type: "Runs", workspace_id }));
  const tasks = asTasks(board.data);
  const agents = asAgents(agentsQuery.data);
  const dependencies = asDependencies(depsQuery.data);
  const runs = asRuns(runsQuery.data);
  const [layers, setLayers] = useState<GraphLayers>(DEFAULT_GRAPH_LAYERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const projected = useMemo(
    () => projectGraph({ agents, tasks, dependencies, runs, layers }),
    [agents, dependencies, layers, runs, tasks],
  );
  const selected = projected.nodes.find((node) => node.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !projected.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(null);
    }
  }, [projected.nodes, selectedId]);

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
              onSelect={setSelectedId}
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
        <aside className="w-72 shrink-0 border-l border-border">
          <GraphInspector selected={selected} agents={agents} tasks={tasks} />
        </aside>
      </div>
      <footer className="flex h-8 shrink-0 items-center gap-2 border-t border-border px-3 text-xs text-muted-foreground">
        <StatusLamp tone="green" label="Live" />
        <span>Live</span>
      </footer>
    </section>
  );
}
