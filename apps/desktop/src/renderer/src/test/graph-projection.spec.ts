import { describe, expect, it } from "vitest";
import type { AgentView, DependencyView, RunView, TaskView } from "@coordy/protocol";
import { projectGraph } from "../lib/coordy/graph-projection";

function agent(partial: Partial<AgentView> & Pick<AgentView, "id" | "name">): AgentView {
  return {
    workspace_id: "ws",
    principal_id: "p1",
    harness: "codex",
    ...partial,
  };
}

function task(partial: Partial<TaskView> & Pick<TaskView, "id" | "title" | "status">): TaskView {
  return {
    workspace_id: "ws",
    ...partial,
  };
}

describe("projectGraph", () => {
  const backend = agent({ id: "agent_backend", name: "Backend" });
  const web = agent({ id: "agent_web", name: "Web" });
  const api = task({
    id: "task_api",
    title: "API",
    status: "done",
    assignee_agent_id: "agent_backend",
  });
  const ui = task({
    id: "task_ui",
    title: "UI",
    status: "open",
    assignee_agent_id: "agent_web",
    blocker_ids: ["task_api"],
  });
  const staleDep: DependencyView = {
    id: "dep_1",
    from_id: "task_ui",
    to_id: "task_api",
    entity: "repo",
    valid: false,
  };

  it("projects assigned and depends_on edges, marking invalid dependencies stale", () => {
    const { nodes, edges } = projectGraph({
      agents: [backend, web],
      tasks: [api, ui],
      dependencies: [staleDep],
    });
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
          source: "task_ui",
          target: "task_api",
          stale: true,
          label: "失效",
        }),
      ]),
    );
    expect(nodes.find((node) => node.id === "agent_web")?.replan).toBe(true);
  });

  it("skips deleted tasks from the board projection", () => {
    const { nodes } = projectGraph({
      agents: [backend],
      tasks: [api, task({ id: "task_gone", title: "Gone", status: "deleted" })],
    });
    expect(nodes.map((node) => node.id)).toEqual(["agent_backend", "task_api"]);
  });

  it("hides task nodes and their edges when the tasks layer is off", () => {
    const { nodes, edges } = projectGraph({
      agents: [backend, web],
      tasks: [api, ui],
      dependencies: [staleDep],
      layers: { tasks: false },
    });
    expect(nodes.every((node) => node.kind === "agent")).toBe(true);
    expect(edges).toEqual([]);
  });

  it("keeps assigned edges when depends is off", () => {
    const { edges } = projectGraph({
      agents: [backend],
      tasks: [api],
      dependencies: [staleDep],
      layers: { depends: false },
    });
    expect(edges.every((edge) => edge.kind === "assigned")).toBe(true);
    expect(edges.some((edge) => edge.stale)).toBe(false);
  });

  it("marks an agent for replan when its run is paused", () => {
    const runs: RunView[] = [
      {
        id: "run_1",
        task_id: "task_api",
        agent_id: "agent_backend",
        status: "paused",
        harness: "codex",
        compaction_count: 1,
      },
    ];
    const { nodes } = projectGraph({
      agents: [backend],
      tasks: [api],
      runs,
    });
    expect(nodes[0]?.replan).toBe(true);
    expect(nodes[0]?.status).toBe("paused");
  });

  it("skips placeholder harness agents", () => {
    const { nodes } = projectGraph({
      agents: [agent({ id: "agent_demo", name: "Demo", harness: "jsonl" })],
      tasks: [],
    });
    expect(nodes).toEqual([]);
  });
});
