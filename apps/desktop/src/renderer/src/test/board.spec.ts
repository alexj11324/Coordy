import { describe, expect, it } from "vitest";
import { acpRunSource } from "../lib/coordy/start-task";
import { asTasks, boardColumn, latestRunForTask, outcomeId } from "../lib/coordy/views";
import type { RunView, View } from "@coordy/protocol";

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
});
