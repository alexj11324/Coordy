// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost" }

import { beforeEach, describe, expect, it } from "vitest";
import { bootstrap } from "../app";
import { useSession } from "../state/session-store";
import { StatefulCoordyBridge } from "./stateful-bridge";

describe("desktop bootstrap", () => {
  let bridge: StatefulCoordyBridge;

  beforeEach(() => {
    bridge = new StatefulCoordyBridge();
    Object.assign(window, { coordy: bridge });
    useSession.setState({ workspaceId: null, principalId: null });
  });

  it("uses an existing workspace and principal without mutating state", async () => {
    bridge.views.set("Workspaces", {
      type: "Workspaces",
      items: [{ id: "ws-existing", name: "Existing" }],
    });
    bridge.views.set("Principals", {
      type: "Principals",
      items: [{ id: "p-existing", workspace_id: "ws-existing", name: "Me" }],
    });

    await bootstrap();

    expect(useSession.getState()).toMatchObject({
      workspaceId: "ws-existing",
      principalId: "p-existing",
    });
    expect(bridge.commands).toHaveLength(0);
  });

  it("creates the missing workspace and principal on a clean state", async () => {
    await bootstrap();

    expect(bridge.commands.map((item) => item.command.type)).toEqual([
      "CreateWorkspace",
      "CreatePrincipal",
    ]);
    expect(useSession.getState()).toMatchObject({
      workspaceId: "workspace_id_1",
      principalId: "principal_id_2",
    });
  });

  it("surfaces the first failing bootstrap boundary and stops", async () => {
    bridge.failQueries.set("Health", "daemon unavailable");

    await expect(bootstrap()).rejects.toThrow("daemon unavailable");
    expect(bridge.commands).toHaveLength(0);
    expect(useSession.getState().workspaceId).toBeNull();
  });
});
