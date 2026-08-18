import { describe, expect, it } from "vitest";
import { closeTab, titleFromPath, upsertTab } from "../lib/coordy/tab-path";
import { matchShortcut, modifierSymbol } from "../lib/coordy/shortcuts";
import { filterIssues, issuesInColumn, taskIdentifier } from "../lib/coordy/issues";
import type { TaskView } from "@coordy/protocol";

function task(partial: Partial<TaskView> & Pick<TaskView, "id" | "title" | "status">): TaskView {
  return {
    workspace_id: "ws",
    ...partial,
  };
}

describe("issue identifiers and filters", () => {
  it("formats Linear-style identifiers from kernel ids", () => {
    expect(taskIdentifier("task_ab12cd34ef")).toBe("TASK-AB12CD");
    expect(taskIdentifier("task_1")).toBe("TASK-1");
  });

  it("filters by status, title, and identifier", () => {
    const tasks = [
      task({ id: "task_aaa111", title: "修登录", status: "open" }),
      task({ id: "task_bbb222", title: "写文档", status: "review" }),
    ];
    expect(filterIssues(tasks, "", "open")).toHaveLength(1);
    expect(filterIssues(tasks, "文档", "all")[0]?.title).toBe("写文档");
    expect(filterIssues(tasks, "TASK-AAA", "all")).toHaveLength(1);
  });

  it("puts cancelled tasks into the done board column", () => {
    const tasks = [task({ id: "task_x", title: "旧", status: "cancelled" })];
    expect(issuesInColumn(tasks, "done")).toHaveLength(1);
    expect(issuesInColumn(tasks, "cancelled")).toHaveLength(1);
  });
});

describe("tabs", () => {
  it("opens a new tab for a new path and reuses an existing one", () => {
    const first = upsertTab([], "/board");
    expect(first.tabs).toHaveLength(1);
    expect(first.tabs[0]?.title).toBe("任务");
    const second = upsertTab(first.tabs, "/board/task_1");
    expect(second.tabs).toHaveLength(2);
    expect(titleFromPath("/agents/new")).toBe("创建智能体");
    const reused = upsertTab(second.tabs, "/board");
    expect(reused.tabs).toHaveLength(2);
    expect(reused.activeId).toBe("/board");
  });

  it("closes a tab and reseeds home when it is the last one", () => {
    const opened = upsertTab([], "/settings");
    const closed = closeTab(opened.tabs, opened.activeId, opened.activeId);
    expect(closed.tabs[0]?.path).toBe("/");
    expect(closed.activeId).toBe("/");
  });
});

describe("shortcuts", () => {
  it("matches Multica-style search and new-task keys", () => {
    expect(matchShortcut({ key: "k", metaKey: true, ctrlKey: false, altKey: false })).toBe("search");
    expect(matchShortcut({ key: "k", metaKey: false, ctrlKey: true, altKey: false })).toBe("search");
    expect(matchShortcut({ key: "c", metaKey: false, ctrlKey: false, altKey: false })).toBe("new-task");
    expect(matchShortcut({ key: "b", metaKey: true, ctrlKey: false, altKey: false })).toBe("toggle-sidebar");
    expect(matchShortcut({ key: "w", metaKey: true, ctrlKey: false, altKey: false })).toBe("close-tab");
    expect(modifierSymbol("darwin")).toBe("⌘");
    expect(modifierSymbol("linux")).toBe("Ctrl");
  });

  it("ignores composing and modifier-only C", () => {
    expect(matchShortcut({ key: "c", metaKey: true, ctrlKey: false, altKey: false })).toBeNull();
    expect(matchShortcut({ key: "c", metaKey: false, ctrlKey: false, altKey: false, isComposing: true })).toBeNull();
  });
});
