import { describe, expect, it } from "vitest";
import {
  declareDependencyCommand,
  dependencyIdFromGraphEdgeId,
  reaffirmCommandForStaleEdge,
  removeCommandForDependencyEdge,
  timelineEntries,
} from "../features/graph/graph-commands";

describe("graph inspector commands", () => {
  it("maps a selected stale dependency edge to ReaffirmDependency with generation", () => {
    expect(
      reaffirmCommandForStaleEdge({
        edgeId: "dep:dep_1",
        stale: true,
        generation: 2,
      }),
    ).toEqual({ type: "ReaffirmDependency", dependency_id: "dep_1", expected_generation: 2 });
  });

  it("does not reaffirm assigned, blocker, valid, or generation-less edges", () => {
    expect(reaffirmCommandForStaleEdge({ edgeId: "dep:dep_1", stale: false, generation: 2 })).toBeNull();
    expect(reaffirmCommandForStaleEdge({ edgeId: "blocker:task_api:task_ui", stale: true, generation: 2 })).toBeNull();
    expect(reaffirmCommandForStaleEdge({ edgeId: "assigned:agent:task", stale: true, generation: 2 })).toBeNull();
    expect(reaffirmCommandForStaleEdge({ edgeId: "dep:dep_1", stale: true })).toBeNull();
  });

  it("removes only kernel dependency edges", () => {
    expect(removeCommandForDependencyEdge("dep:dep_1")).toEqual({
      type: "RemoveDependency",
      dependency_id: "dep_1",
    });
    expect(removeCommandForDependencyEdge("blocker:task_api:task_ui")).toBeNull();
    expect(dependencyIdFromGraphEdgeId("dep:")).toBeNull();
  });

  it("declares a dependency from upstream source to the selected target", () => {
    expect(declareDependencyCommand("ws_1", "task_api", "task_ui", "  ")).toEqual({
      type: "DeclareDependency",
      workspace_id: "ws_1",
      source: { kind: "task", id: "task_api" },
      target: { kind: "task", id: "task_ui" },
      entity: "repo",
    });
  });

  it("assembles timeline entries from graph_events without inventing dual-start", () => {
    expect(
      timelineEntries([
        {
          id: "gev_1",
          kind: "declare",
          at: "t1",
          summary: "声明 task_api → task_ui",
          edge_id: "dep_1",
        },
        {
          id: "gev_2",
          kind: "attempt_started",
          at: "t2",
          summary: "尝试开始",
          node_id: "task_api",
        },
      ]),
    ).toEqual([
      {
        id: "gev_1",
        kind: "declare",
        at: "t1",
        summary: "声明 task_api → task_ui",
        edge_id: "dep_1",
        node_id: undefined,
      },
      {
        id: "gev_2",
        kind: "attempt_started",
        at: "t2",
        summary: "尝试开始",
        edge_id: undefined,
        node_id: "task_api",
      },
    ]);
    expect(timelineEntries(undefined)).toEqual([]);
  });
});
