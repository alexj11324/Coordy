// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost" }

import { beforeEach, describe, expect, it } from "vitest";
import { submit, view } from "../lib/coordy/client";
import {
  createNamedAgent,
  startAcpRun,
  startChatTurn,
} from "../lib/coordy/start-task";
import { activateWorkspace } from "../shell/workspace-switcher";
import { queryClient } from "../app/query-client";
import { useSession } from "../state/session-store";
import { StatefulCoordyBridge } from "./stateful-bridge";

describe("renderer command and query boundaries", () => {
  let bridge: StatefulCoordyBridge;

  beforeEach(() => {
    queryClient.clear();
    bridge = new StatefulCoordyBridge();
    Object.assign(window, { coordy: bridge });
    useSession.setState({ workspaceId: "ws", principalId: "p" });
    bridge.views.set("Agents", {
      type: "Agents",
      items: [
        {
          id: "agent-1",
          workspace_id: "ws",
          principal_id: "p",
          name: "Runner",
          harness: "coordy-stub",
        },
      ],
    });
  });

  it("creates an atomic configured agent and preserves the kernel error", async () => {
    await expect(
      createNamedAgent({
        workspaceId: "ws",
        principalId: "p",
        name: " Builder ",
        harness: "coordy-stub",
        instructions: "Do the work",
      }),
    ).resolves.toBe("agent_id_1");
    expect(bridge.commands[0]?.command).toMatchObject({
      type: "CreateConfiguredAgent",
      name: "Builder",
      instructions: "Do the work",
    });

    bridge.failCommands.set("CreateConfiguredAgent", "duplicate agent name");
    await expect(
      createNamedAgent({
        workspaceId: "ws",
        principalId: "p",
        name: "Builder",
        harness: "coordy-stub",
      }),
    ).rejects.toThrow("duplicate agent name");
  });

  it("creates, assigns and starts an issue in order; assignment failure stops the run", async () => {
    await expect(
      startAcpRun({
        workspaceId: "ws",
        principalId: "p",
        title: "Golden issue",
        prompt: "Complete it",
        agentId: "agent-1",
      }),
    ).resolves.toMatchObject({ agentId: "agent-1", taskId: "task_id_1", runId: "run_id_2" });
    expect(bridge.commands.map((item) => item.command.type)).toEqual([
      "CreateTask",
      "AssignTask",
      "StartRun",
    ]);

    bridge.commands.length = 0;
    bridge.failCommands.set("AssignTask", "agent unavailable");
    await expect(
      startAcpRun({
        workspaceId: "ws",
        principalId: "p",
        title: "Failure",
        prompt: "Do not start",
        agentId: "agent-1",
      }),
    ).rejects.toThrow("agent unavailable");
    expect(bridge.commands.map((item) => item.command.type)).toEqual([
      "CreateTask",
      "AssignTask",
    ]);
  });

  it("runs a chat turn in order and exposes a representative failure", async () => {
    await startChatTurn({
      chatId: "chat-1",
      taskId: "task-1",
      agentId: "agent-1",
      prompt: "hello",
    });
    expect(bridge.commands.map((item) => item.command.type)).toEqual([
      "SetTaskStatus",
      "AssignTask",
      "StartRun",
    ]);

    bridge.commands.length = 0;
    bridge.failCommands.set("StartRun", "runtime failed");
    await expect(
      startChatTurn({
        chatId: "chat-1",
        taskId: "task-1",
        agentId: "agent-1",
        prompt: "retry",
      }),
    ).rejects.toThrow("runtime failed");
  });

  it("covers project, automation, squad and Skill success and failure boundaries", async () => {
    await submit({ type: "CreateProject", workspace_id: "ws", name: "Roadmap" });
    await submit({
      type: "CreateAutomation",
      workspace_id: "ws",
      name: "Daily",
      runbook: "Check work",
    });
    await submit({
      type: "CreateSquad",
      workspace_id: "ws",
      name: "Team",
      leader_agent_id: "agent-1",
    });
    await submit({ type: "CreateSkill", workspace_id: "ws", name: "Review", body: "Review code" });
    expect(bridge.commands.map((item) => item.command.type)).toEqual([
      "CreateProject",
      "CreateAutomation",
      "CreateSquad",
      "CreateSkill",
    ]);

    for (const [command, input] of [
      ["CreateProject", { type: "CreateProject", workspace_id: "ws", name: "Blocked" }],
      ["CreateSquad", { type: "CreateSquad", workspace_id: "ws", name: "Blocked", leader_agent_id: "agent-1" }],
      ["CreateSkill", { type: "CreateSkill", workspace_id: "ws", name: "Blocked", body: "x" }],
    ] as const) {
      bridge.failCommands.set(command, `${command} failed`);
      await expect(submit(input)).rejects.toThrow(`${command} failed`);
    }
    bridge.failCommands.set("TriggerAutomation", "automation disabled");
    await expect(submit({ type: "TriggerAutomation", automation_id: "auto-1" })).rejects.toThrow(
      "automation disabled",
    );
  });

  it("covers task actions, Stats and settings through success and failure", async () => {
    await submit({ type: "SetTaskStatus", task_id: "task-1", status: "done" });
    await submit({ type: "UpdateTask", task_id: "task-1", priority: "high" });
    await expect(view({ type: "Stats", workspace_id: "ws" })).resolves.toMatchObject({ type: "Stats" });
    bridge.failCommands.set("UpdateTask", "task update failed");
    await expect(
      submit({ type: "UpdateTask", task_id: "task-1", priority: "low" }),
    ).rejects.toThrow("task update failed");

    bridge.failQueries.set("Stats", "stats unavailable");
    await expect(view({ type: "Stats", workspace_id: "ws" })).rejects.toThrow("stats unavailable");
    bridge.views.set("Settings", {
      type: "Settings",
      daemon: {
        status: "ok",
        version: "test",
        protocol_version: "coordy-local-v1",
        pid: 1,
        workspace_count: 1,
      },
      llm_advisor_enabled: false,
    });
    await expect(view({ type: "Settings", workspace_id: "ws" })).resolves.toMatchObject({
      type: "Settings",
    });
    bridge.failQueries.set("Settings", "settings unavailable");
    await expect(view({ type: "Settings", workspace_id: "ws" })).rejects.toThrow("settings unavailable");
  });

  it("switches workspaces and clears the prior actor even when principal lookup fails", async () => {
    useSession.setState({
      workspaceId: "old-ws",
      principalId: "old-principal",
      agentId: "old-agent",
      actor: { type: "agent", id: "old-agent", principal_id: "old-principal" },
    });
    bridge.views.set("Principals", {
      type: "Principals",
      items: [{ id: "new-principal", workspace_id: "new-ws", name: "New" }],
    });
    await activateWorkspace("new-ws");
    expect(useSession.getState()).toMatchObject({
      workspaceId: "new-ws",
      principalId: "new-principal",
      agentId: null,
      actor: { type: "principal", id: "new-principal" },
    });

    bridge.failQueries.set("Principals", "workspace refresh failed");
    await expect(activateWorkspace("failed-ws")).rejects.toThrow("workspace refresh failed");
    expect(useSession.getState()).toMatchObject({
      workspaceId: "failed-ws",
      principalId: null,
      agentId: null,
      actor: { type: "daemon" },
    });
  });
});
