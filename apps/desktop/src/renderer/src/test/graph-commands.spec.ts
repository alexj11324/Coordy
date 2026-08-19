import { describe, expect, it } from "vitest";
import {
  declareDependencyCommand,
  dependencyIdFromGraphEdgeId,
  reaffirmCommandForStaleEdge,
  removeCommandForDependencyEdge,
} from "../features/graph/graph-commands";

describe("graph inspector commands", () => {
  it("maps a selected stale dependency edge to ReaffirmDependency", () => {
    expect(
      reaffirmCommandForStaleEdge({
        edgeId: "dep:dep_1",
        stale: true,
      }),
    ).toEqual({ type: "ReaffirmDependency", dependency_id: "dep_1" });
  });

  it("does not reaffirm assigned, blocker, or valid edges", () => {
    expect(reaffirmCommandForStaleEdge({ edgeId: "dep:dep_1", stale: false })).toBeNull();
    expect(reaffirmCommandForStaleEdge({ edgeId: "blocker:task_api:task_ui", stale: true })).toBeNull();
    expect(reaffirmCommandForStaleEdge({ edgeId: "assigned:agent:task", stale: true })).toBeNull();
  });

  it("removes only kernel dependency edges", () => {
    expect(removeCommandForDependencyEdge("dep:dep_1")).toEqual({
      type: "RemoveDependency",
      dependency_id: "dep_1",
    });
    expect(removeCommandForDependencyEdge("blocker:task_api:task_ui")).toBeNull();
    expect(dependencyIdFromGraphEdgeId("dep:")).toBeNull();
  });

  it("declares a dependency from the selected task", () => {
    expect(declareDependencyCommand("ws_1", "task_ui", "task_api", "  ")).toEqual({
      type: "DeclareDependency",
      workspace_id: "ws_1",
      from_id: "task_ui",
      to_id: "task_api",
      entity: "repo",
    });
  });
});
