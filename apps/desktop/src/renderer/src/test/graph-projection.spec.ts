import { describe, expect, it } from "vitest";
import type { GraphSnapshotView } from "@coordy/protocol";
import { projectGraph } from "../lib/coordy/graph-projection";

function snapshot(partial: Partial<GraphSnapshotView> = {}): GraphSnapshotView {
  return {
    type: "GraphSnapshot",
    workspace_id: "ws",
    revision: 1,
    event_cursor: 0,
    nodes: [
      {
        id: "agent_backend",
        kind: "agent",
        title: "Backend",
        status: "idle",
        workspace_id: "ws",
        subtitle: "codex",
        harness: "codex",
      },
      {
        id: "agent_web",
        kind: "agent",
        title: "Web",
        status: "paused",
        workspace_id: "ws",
        subtitle: "codex",
        harness: "codex",
        replan: true,
      },
      {
        id: "task_api",
        kind: "task",
        title: "API",
        status: "done",
        workspace_id: "ws",
        subtitle: "COOR-1",
        assignee_agent_id: "agent_backend",
      },
      {
        id: "task_ui",
        kind: "task",
        title: "UI",
        status: "open",
        workspace_id: "ws",
        subtitle: "COOR-2",
        assignee_agent_id: "agent_web",
      },
    ],
    edges: [
      {
        id: "assigned:agent_backend:task_api",
        workspace_id: "ws",
        source: { kind: "agent", id: "agent_backend" },
        target: { kind: "task", id: "task_api" },
        kind: "assigned_to",
        entity: "assignment",
        state: "active",
        generation: 0,
        valid: true,
      },
      {
        id: "assigned:agent_web:task_ui",
        workspace_id: "ws",
        source: { kind: "agent", id: "agent_web" },
        target: { kind: "task", id: "task_ui" },
        kind: "assigned_to",
        entity: "assignment",
        state: "active",
        generation: 0,
        valid: true,
      },
      {
        id: "blocker:task_api:task_ui",
        workspace_id: "ws",
        source: { kind: "task", id: "task_api" },
        target: { kind: "task", id: "task_ui" },
        kind: "precedence",
        entity: "issue",
        state: "active",
        generation: 0,
        valid: true,
      },
      {
        id: "dep_1",
        workspace_id: "ws",
        source: { kind: "task", id: "task_api" },
        target: { kind: "task", id: "task_ui" },
        kind: "consumes",
        entity: "repo",
        state: "stale",
        generation: 2,
        valid: false,
      },
    ],
    materializations: [],
    health: { consistent: true, lag: 0 },
    ...partial,
  };
}

describe("projectGraph", () => {
  it("keeps contract nodes out of the task layer until the contract layer exists", () => {
    const result = projectGraph({
      snapshot: snapshot({
        nodes: [
          {
            id: "contract_1",
            kind: "contract",
            title: "Approval contract",
            status: "active",
            workspace_id: "ws_1",
          },
        ],
        edges: [],
      }),
    });

    expect(result).toEqual({ nodes: [], edges: [] });
  });

  it("projects assigned and depends_on edges source→target, marking invalid consumes stale", () => {
    const { nodes, edges } = projectGraph({ snapshot: snapshot() });
    expect(nodes.map((node) => node.id).sort()).toEqual([
      "agent_backend",
      "agent_web",
      "task_api",
      "task_ui",
    ]);
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "assigned:agent_backend:task_api",
          kind: "assigned",
          source: "agent_backend",
          target: "task_api",
        }),
        expect.objectContaining({
          id: "blocker:task_api:task_ui",
          kind: "depends_on",
          source: "task_api",
          target: "task_ui",
        }),
        expect.objectContaining({
          id: "dep:dep_1",
          kind: "depends_on",
          source: "task_api",
          target: "task_ui",
          stale: true,
          label: "失效",
        }),
      ]),
    );
    expect(nodes.find((node) => node.id === "agent_web")?.replan).toBe(true);
  });

  it("skips deleted or hidden task nodes when the tasks layer is off", () => {
    const { nodes, edges } = projectGraph({
      snapshot: snapshot(),
      layers: { tasks: false },
    });
    expect(nodes.every((node) => node.kind === "agent")).toBe(true);
    expect(edges).toEqual([]);
  });

  it("keeps assigned edges when depends is off", () => {
    const { edges } = projectGraph({
      snapshot: snapshot(),
      layers: { depends: false },
    });
    expect(edges.every((edge) => edge.kind === "assigned")).toBe(true);
    expect(edges.some((edge) => edge.stale)).toBe(false);
  });

  it("skips placeholder harness agents", () => {
    const { nodes } = projectGraph({
      snapshot: snapshot({
        nodes: [
          {
            id: "agent_demo",
            kind: "agent",
            title: "Demo",
            status: "idle",
            workspace_id: "ws",
            subtitle: "jsonl",
            harness: "jsonl",
          },
        ],
        edges: [],
      }),
    });
    expect(nodes).toEqual([]);
  });
});
