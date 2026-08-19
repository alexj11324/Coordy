import { describe, expect, it } from "vitest";
import {
  declareDependencyCommand,
  dependencyIdFromGraphEdgeId,
  graphConductorStatusLabel,
  reaffirmCommandForStaleEdge,
  removeCommandForDependencyEdge,
  staleDependencyHoldLabel,
  updateWorkspaceConductorCommand,
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

  it("assembles UpdateWorkspace to set or clear the graph conductor", () => {
    expect(updateWorkspaceConductorCommand("ws_1", "agent_2")).toEqual({
      type: "UpdateWorkspace",
      workspace_id: "ws_1",
      conductor_agent_id: "agent_2",
    });
    expect(updateWorkspaceConductorCommand("ws_1", "none")).toEqual({
      type: "UpdateWorkspace",
      workspace_id: "ws_1",
      conductor_agent_id: "",
    });
    expect(updateWorkspaceConductorCommand("ws_1", null)).toEqual({
      type: "UpdateWorkspace",
      workspace_id: "ws_1",
      conductor_agent_id: "",
    });
  });

  it("labels stale holds and conductor status for the inspector", () => {
    expect(staleDependencyHoldLabel(false)).toBe("已失效");
    expect(staleDependencyHoldLabel(true)).toBe("等待总管批准");
    expect(graphConductorStatusLabel(false)).toBeNull();
    expect(graphConductorStatusLabel(true)).toBe("总管托管中");
  });
});
