import { describe, expect, it } from "vitest";
import { acpRunSource } from "../lib/coordy/start-task";
import { draftAgentFromGoal } from "../lib/coordy/agent-draft";
import { agentDisplayName, listableAgents, selectableRuntimes, taskStatusLabel } from "../lib/coordy/labels";
import { asTasks, boardColumn, isPlaceholderHarness, latestRunForTask, outcomeId } from "../lib/coordy/views";
import type { AgentView, RunView, View } from "@coordy/protocol";

describe("board view helpers", () => {
  it("reads tasks from a Board view", () => {
    const view: View = {
      type: "Board",
      tasks: [
        {
          id: "task_1",
          workspace_id: "ws",
          title: "Ship",
          status: "open",
        },
      ],
    };
    expect(asTasks(view)).toHaveLength(1);
    expect(asTasks(view)[0]?.title).toBe("Ship");
  });

  it("extracts outcome ids", () => {
    expect(outcomeId({ task_id: "task_1" }, "task_id")).toBe("task_1");
  });

  it("builds an ACP run source instead of a JSONL fixture", () => {
    expect(acpRunSource("hello")).toEqual({ type: "Acp", prompt: "hello" });
  });

  it("puts running and review tasks in kanban columns", () => {
    expect(boardColumn("open")).toBe("open");
    expect(boardColumn("running")).toBe("running");
    expect(boardColumn("review")).toBe("review");
    expect(boardColumn("blocked")).toBe("blocked");
  });

  it("picks the latest run for a task", () => {
    const runs: RunView[] = [
      { id: "run_1", task_id: "t1", agent_id: "a", status: "completed", harness: "claude-acp", compaction_count: 0 },
      { id: "run_2", task_id: "t1", agent_id: "a", status: "running", harness: "claude-acp", compaction_count: 0 },
      { id: "run_3", task_id: "t2", agent_id: "a", status: "completed", harness: "claude-acp", compaction_count: 0 },
    ];
    expect(latestRunForTask(runs, "t1")?.id).toBe("run_2");
  });

  it("hides leftover placeholder agents that are not a real CLI", () => {
    const agents: AgentView[] = [
      { id: "ag_1", workspace_id: "ws", principal_id: "p", name: "助手", harness: "acp" },
      { id: "ag_2", workspace_id: "ws", principal_id: "p", name: "助手", harness: "acp" },
      { id: "ag_3", workspace_id: "ws", principal_id: "p", name: "Coordy 演示", harness: "coordy-stub" },
    ];
    expect(agents.filter((agent) => isPlaceholderHarness(agent.harness))).toHaveLength(2);
    expect(listableAgents(agents).map((agent) => agent.harness)).toEqual(["coordy-stub"]);
  });

  it("keeps a custom 智能体 name instead of replacing it with the CLI", () => {
    expect(agentDisplayName({ name: "前端审查", harness: "claude-acp" })).toBe("前端审查");
    expect(agentDisplayName({ name: "助手", harness: "acp" })).toBe("未对应任何 CLI");
    expect(
      agentDisplayName(
        { name: "助手", harness: "claude-acp" },
        [{ id: "claude-acp", name: "Claude Code", installed: true, command: "claude acp", source: "path" }],
      ),
    ).toBe("Claude Code");
  });

  it("only offers installed tools as selectable runtimes", () => {
    expect(
      selectableRuntimes([
        { id: "claude-acp", name: "Claude Code", installed: true, command: "claude acp", source: "path" },
        { id: "made-up", name: "Made Up", installed: false, command: "npx -y made-up", source: "registry" },
      ]).map((item) => item.id),
    ).toEqual(["claude-acp"]);
  });

  it("drafts 智能体 fields from a goal description", () => {
    const draft = draftAgentFromGoal("审查前端 Pull Request。\n只看 TypeScript。");
    expect(draft.name).toBe("审查前端 Pull Request");
    expect(draft.description).toContain("审查前端");
    expect(draft.instructions).toContain("只看 TypeScript");
  });

  it("uses Multica status words for issue columns", () => {
    expect(taskStatusLabel("review")).toBe("待验收");
    expect(boardColumn("done")).toBe("done");
    expect(boardColumn("cancelled")).toBe("done");
  });
});
