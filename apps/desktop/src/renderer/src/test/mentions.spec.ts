import { describe, expect, it } from "vitest";
import { insertAgentMention, mentionsFromBody } from "../lib/coordy/mentions";

describe("issue mention tokens", () => {
  it("parses agent, squad, all, and principal mentions", () => {
    expect(mentionsFromBody("请看 @agent:ag_1 和 @squad:sq_2，以及 @all 与 @mem_3")).toEqual([
      { kind: "agent", id: "ag_1" },
      { kind: "squad", id: "sq_2" },
      { kind: "all", id: "all" },
      { kind: "principal", id: "mem_3" },
    ]);
  });

  it("inserts an agent token without changing surrounding text", () => {
    expect(insertAgentMention("请继续", "ag_9")).toBe("请继续 @agent:ag_9 ");
    expect(insertAgentMention("", "ag_9")).toBe("@agent:ag_9 ");
  });
});
