import { describe, expect, it } from "vitest";
import { closeTab, titleFromPath, upsertTab } from "../lib/coordy/tab-path";
import { matchShortcut, modifierSymbol } from "../lib/coordy/shortcuts";
import { filterIssues, issuesInColumn, taskIdentifier } from "../lib/coordy/issues";
import { canGoBack, canGoForward, emptyHistory, historyBack, historyForward, recordVisit } from "../lib/coordy/nav-history";
import { navItemActive, personalNav, workspaceNav } from "../shell/nav";
import type { TaskView } from "@coordy/protocol";

function task(partial: Partial<TaskView> & Pick<TaskView, "id" | "title" | "status">): TaskView {
  return {
    workspace_id: "ws",
    ...partial,
  };
}

describe("issue identifiers and filters", () => {
  it("formats Linear-style identifiers from kernel ids", () => {
    expect(taskIdentifier({ id: "task_ab12cd34ef" })).toBe("COOR-AB12CD");
    expect(taskIdentifier({ id: "task_1" })).toBe("COOR-1");
    expect(taskIdentifier({ id: "task_x", identifier: "COOR-12" })).toBe("COOR-12");
  });

  it("filters by status, title, and identifier", () => {
    const tasks = [
      task({ id: "task_aaa111", title: "修登录", status: "open" }),
      task({ id: "task_bbb222", title: "写文档", status: "review" }),
    ];
    expect(filterIssues(tasks, "", "open")).toHaveLength(1);
    expect(filterIssues(tasks, "文档", "all")[0]?.title).toBe("写文档");
    expect(filterIssues(tasks, "COOR-AAA", "all")).toHaveLength(1);
  });

  it("filters board scope by members or agents", () => {
    const tasks = [
      task({ id: "task_1", title: "人", status: "open", assignee_principal_id: "p1" }),
      task({ id: "task_2", title: "机", status: "open", assignee_agent_id: "a1" }),
      task({ id: "task_3", title: "空", status: "open" }),
    ];
    expect(filterIssues(tasks, { query: "", status: "all", assignee: "members", project: "all", priority: "all" }).map((item) => item.id)).toEqual(["task_1"]);
    expect(filterIssues(tasks, { query: "", status: "all", assignee: "agents", project: "all", priority: "all" }).map((item) => item.id)).toEqual(["task_2"]);
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
    expect(titleFromPath("/agents/new/blank")).toBe("创建智能体");
    expect(titleFromPath("/agents/new/ai")).toBe("创建智能体");
    expect(titleFromPath("/agents/new/ai/session-1")).toBe("创建智能体");
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

describe("sidebar nav", () => {
  it("groups personal and workspace destinations like the shadcn sidebar", () => {
    expect(personalNav.map((item) => item.to)).toEqual(["/inbox", "/chat", "/mine"]);
    expect(workspaceNav.map((item) => item.label)).toContain("智能体");
    expect(navItemActive("/agents/new", { to: "/agents" })).toBe(true);
    expect(navItemActive("/agents/new/ai", { to: "/agents" })).toBe(true);
    expect(navItemActive("/board", { to: "/inbox" })).toBe(false);
  });
});

describe("shortcuts", () => {
  it("matches Multica-style search and new-task keys", () => {
    expect(matchShortcut({ key: "k", metaKey: true, ctrlKey: false, altKey: false })).toBe("search");
    expect(matchShortcut({ key: "k", metaKey: false, ctrlKey: true, altKey: false })).toBe("search");
    expect(matchShortcut({ key: "c", metaKey: false, ctrlKey: false, altKey: false })).toBe("new-task");
    expect(matchShortcut({ key: "j", metaKey: true, ctrlKey: false, altKey: false })).toBe("toggle-chat");
    expect(matchShortcut({ key: "j", metaKey: false, ctrlKey: true, altKey: false })).toBe("toggle-chat");
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

describe("nav history", () => {
  it("records visits and walks back and forward", () => {
    const first = recordVisit(emptyHistory("/"), "/squads");
    const second = recordVisit(first, "/projects");
    expect(canGoBack(second)).toBe(true);
    expect(canGoForward(second)).toBe(false);
    const back = historyBack(second);
    expect(back?.path).toBe("/squads");
    expect(canGoForward(back!.history)).toBe(true);
    const forward = historyForward(back!.history);
    expect(forward?.path).toBe("/projects");
  });

  it("does not push the same path twice", () => {
    const history = recordVisit(emptyHistory("/squads"), "/squads");
    expect(history.stack).toEqual(["/squads"]);
    expect(history.index).toBe(0);
  });
});
