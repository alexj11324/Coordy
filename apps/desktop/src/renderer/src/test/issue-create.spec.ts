import { describe, expect, it } from "vitest";
import {
  promptFromManual,
  resolveIssueCreateMode,
  titleFromPrompt,
} from "../lib/coordy/issue-create";

describe("issue create modes", () => {
  it("opens the last mode unless a board column seeded a status", () => {
    expect(resolveIssueCreateMode(false, "agent")).toBe("agent");
    expect(resolveIssueCreateMode(false, "manual")).toBe("manual");
    expect(resolveIssueCreateMode(true, "agent")).toBe("manual");
  });

  it("joins the manual title and description into the agent prompt", () => {
    expect(promptFromManual("修登录", "先复现")).toBe("修登录\n\n先复现");
    expect(promptFromManual("修登录", "")).toBe("修登录");
    expect(promptFromManual("  ", "  ")).toBe("");
  });

  it("takes the first line of the prompt as the created issue title", () => {
    expect(titleFromPrompt("审查仓库\n然后等待")).toBe("审查仓库");
    expect(titleFromPrompt("   ")).toBe("新事项");
    expect(titleFromPrompt("x".repeat(85)).length).toBe(80);
  });
});
