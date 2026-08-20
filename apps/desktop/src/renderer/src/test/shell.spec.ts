import { describe, expect, it } from "vitest";
import {
  closeTab,
  openNewTab,
  replaceActiveTab,
  titleFromPath,
} from "../lib/coordy/tab-path";
import {
  formatShortcut,
  matchShortcut,
  modifierSymbol,
  SHORTCUTS,
} from "../lib/coordy/shortcuts";
import {
  filterIssues,
  issuesInColumn,
  priorityBarCount,
  taskIdentifier,
  blockerWaitMessage,
  hasUnresolvedBlockers,
} from "../lib/coordy/issues";
import {
  canGoBack,
  canGoForward,
  emptyHistory,
  historyBack,
  historyForward,
  recordVisit,
} from "../lib/coordy/nav-history";
import { navItemActive, personalNav, workspaceNav } from "../shell/nav";
import { shouldShowFloatingChat } from "../shell/desktop-shell";
import { useLayoutStore } from "../state/layout-store";
import type { TaskView } from "@coordy/protocol";

function task(
  partial: Partial<TaskView> & Pick<TaskView, "id" | "title" | "status">,
): TaskView {
  return {
    workspace_id: "ws",
    ...partial,
  };
}

describe("issue identifiers and filters", () => {
  it("formats Linear-style identifiers from kernel ids", () => {
    expect(taskIdentifier({ id: "task_ab12cd34ef" })).toBe("COOR-AB12CD");
    expect(taskIdentifier({ id: "task_1" })).toBe("COOR-1");
    expect(taskIdentifier({ id: "task_x", identifier: "COOR-12" })).toBe(
      "COOR-12",
    );
  });

  it("maps Linear-style priority bars, leaving urgent to the alert icon", () => {
    expect(priorityBarCount("high")).toBe(3);
    expect(priorityBarCount("medium")).toBe(2);
    expect(priorityBarCount("low")).toBe(1);
    expect(priorityBarCount("urgent")).toBe(0);
    expect(priorityBarCount("none")).toBe(0);
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
      task({
        id: "task_1",
        title: "人",
        status: "open",
        assignee_principal_id: "p1",
      }),
      task({
        id: "task_2",
        title: "机",
        status: "open",
        assignee_agent_id: "a1",
      }),
      task({ id: "task_3", title: "空", status: "open" }),
    ];
    expect(
      filterIssues(tasks, {
        query: "",
        status: "all",
        assignee: "members",
        project: "all",
        priority: "all",
      }).map((item) => item.id),
    ).toEqual(["task_1"]);
    expect(
      filterIssues(tasks, {
        query: "",
        status: "all",
        assignee: "agents",
        project: "all",
        priority: "all",
      }).map((item) => item.id),
    ).toEqual(["task_2"]);
  });

  it("puts cancelled tasks into the done board column", () => {
    const tasks = [task({ id: "task_x", title: "旧", status: "cancelled" })];
    expect(issuesInColumn(tasks, "done")).toHaveLength(1);
    expect(issuesInColumn(tasks, "cancelled")).toHaveLength(1);
  });

  it("explains unresolved issue blockers in Chinese", () => {
    const design = task({
      id: "task_a",
      title: "设计稿",
      status: "open",
      identifier: "COOR-1",
    });
    const implement = task({
      id: "task_b",
      title: "实现",
      status: "blocked",
      identifier: "COOR-2",
      unresolved_blocker_ids: ["task_a"],
      blocked_reason: "waiting on unfinished blockers",
    });
    expect(hasUnresolvedBlockers(implement)).toBe(true);
    expect(blockerWaitMessage(implement, [design, implement])).toBe(
      "需等待前置事项完成：COOR-1 设计稿",
    );
    expect(
      blockerWaitMessage(
        task({
          id: "task_c",
          title: "手标",
          status: "blocked",
          blocked_reason: "marked blocked",
        }),
        [],
      ),
    ).toBe("marked blocked");
  });
});

describe("tabs", () => {
  it("rewrites the active tab instead of stacking sidebar destinations", () => {
    const first = replaceActiveTab([], "/", "/board");
    expect(first.tabs).toHaveLength(1);
    expect(first.tabs[0]?.title).toBe("任务");
    const second = replaceActiveTab(first.tabs, first.activeId, "/projects");
    expect(second.tabs).toHaveLength(1);
    expect(second.tabs[0]?.title).toBe("项目");
    const issue = replaceActiveTab(
      second.tabs,
      second.activeId,
      "/board/task_1",
    );
    expect(issue.tabs).toHaveLength(1);
    expect(titleFromPath("/agents/new")).toBe("创建智能体");
    expect(titleFromPath("/agents/new/blank")).toBe("创建智能体");
    expect(titleFromPath("/agents/new/ai")).toBe("创建智能体");
    expect(titleFromPath("/agents/new/ai/session-1")).toBe("创建智能体");
    expect(titleFromPath("/harnesses")).toBe("Harness");
    expect(titleFromPath("/runtimes")).toBe("Harness");
  });

  it("only adds a tab when opening one explicitly", () => {
    const first = replaceActiveTab([], "/", "/board");
    const added = openNewTab(first.tabs, "/");
    expect(added.tabs).toHaveLength(2);
    expect(added.tabs[1]?.title).toBe("开始");
    expect(added.activeId).not.toBe(first.activeId);
  });

  it("closes a tab and reseeds home when it is the last one", () => {
    const opened = replaceActiveTab([], "/", "/settings");
    const closed = closeTab(opened.tabs, opened.activeId, opened.activeId);
    expect(closed.tabs[0]?.path).toBe("/");
    expect(closed.activeId).toBe("/");
  });
});

describe("sidebar nav", () => {
  it("hides chat until agent creation is complete", () => {
    expect(shouldShowFloatingChat("/agents/new")).toBe(false);
    expect(shouldShowFloatingChat("/agents/new/blank")).toBe(false);
    expect(shouldShowFloatingChat("/agents/new/ai/legacy-session")).toBe(false);
    expect(shouldShowFloatingChat("/agents/agent-1")).toBe(true);
  });

  it("groups personal and workspace destinations like the shadcn sidebar", () => {
    expect(personalNav.map((item) => item.to)).toEqual([
      "/inbox",
      "/chat",
      "/mine",
    ]);
    expect(workspaceNav.map((item) => item.label)).toEqual([
      "任务",
      "图",
      "项目",
      "自动化",
      "智能体",
      "小队",
      "统计",
    ]);
    expect(navItemActive("/agents/new", { to: "/agents" })).toBe(true);
    expect(navItemActive("/agents/new/ai", { to: "/agents" })).toBe(true);
    expect(navItemActive("/board", { to: "/inbox" })).toBe(false);
  });
});

describe("chat layout", () => {
  it("keeps command-palette chat creation out of the page composer queue", () => {
    useLayoutStore.setState({ activeChatId: "chat_existing", chatDock: "closed", pendingFocus: null });
    useLayoutStore.getState().startNewChat();
    expect(useLayoutStore.getState()).toMatchObject({
      activeChatId: null,
      chatDock: "open",
      pendingFocus: null,
    });
    useLayoutStore.getState().setActiveChatId("chat_created_from_dock");
    expect(useLayoutStore.getState().consumePendingFocus()).toBeNull();
    expect(useLayoutStore.getState()).toMatchObject({
      activeChatId: "chat_created_from_dock",
      pendingFocus: null,
    });
  });
});

describe("shortcuts", () => {
  it("matches search, new-task, sidebar, chat, tabs, and zoom", () => {
    expect(
      matchShortcut({ key: "k", metaKey: true, ctrlKey: false, altKey: false }),
    ).toBe("search");
    expect(
      matchShortcut({ key: "k", metaKey: false, ctrlKey: true, altKey: false }),
    ).toBe("search");
    expect(
      matchShortcut({
        key: "c",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      }),
    ).toBe("new-task");
    expect(
      matchShortcut({ key: "j", metaKey: true, ctrlKey: false, altKey: false }),
    ).toBe("toggle-chat");
    expect(
      matchShortcut({ key: "b", metaKey: true, ctrlKey: false, altKey: false }),
    ).toBe("toggle-sidebar");
    expect(
      matchShortcut({ key: "w", metaKey: true, ctrlKey: false, altKey: false }),
    ).toBe("close-tab");
    expect(
      matchShortcut({ key: ",", metaKey: true, ctrlKey: false, altKey: false }),
    ).toBe("open-settings");
    expect(
      matchShortcut({ key: "[", metaKey: true, ctrlKey: false, altKey: false }),
    ).toBe("go-back");
    expect(
      matchShortcut({
        key: "4",
        code: "Digit4",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe("go-board");
    expect(
      matchShortcut({ key: "=", metaKey: true, ctrlKey: false, altKey: false }),
    ).toBe("zoom-in");
    expect(modifierSymbol("darwin")).toBe("⌘");
    expect(modifierSymbol("linux")).toBe("Ctrl");
    expect(formatShortcut({ key: "k", mod: true }, "darwin")).toBe("⌘K");
    expect(formatShortcut({ key: "4", mod: true, shift: true }, "linux")).toBe(
      "Ctrl+Shift+4",
    );
  });

  it("lists general, navigation, and fixed actions", () => {
    expect(
      SHORTCUTS.filter((item) => item.category === "navigation").length,
    ).toBeGreaterThanOrEqual(12);
    expect(SHORTCUTS.map((item) => item.id)).toContain("go-harnesses");
    expect(SHORTCUTS.map((item) => item.id)).toContain("open-settings");
  });

  it("ignores composing and modifier-only C", () => {
    expect(
      matchShortcut({ key: "c", metaKey: true, ctrlKey: false, altKey: false }),
    ).toBeNull();
    expect(
      matchShortcut({
        key: "c",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        isComposing: true,
      }),
    ).toBeNull();
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
