import { describe, expect, it } from "vitest";
import { asTasks, outcomeId } from "../lib/coordy/views";
import type { View } from "@coordy/protocol";

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
});
