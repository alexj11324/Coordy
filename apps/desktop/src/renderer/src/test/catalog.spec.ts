import { describe, expect, it } from "vitest";
import {
  AUTOMATION_STARTERS,
  automationModeLabel,
  formatRelativeTime,
  projectIssueStats,
  projectStatusLabel,
  scheduleLabel,
  scheduleSelectItems,
  SKILL_STARTERS,
  skillStarterById,
  starterById,
} from "../lib/coordy/catalog";
import { navItemActive } from "../shell/nav";
import { titleFromPath } from "../lib/coordy/tab-path";

describe("catalog labels", () => {
  it("maps project status and falls back to the raw value", () => {
    expect(projectStatusLabel("active")).toBe("进行中");
    expect(projectStatusLabel("")).toBe("规划中");
    expect(projectStatusLabel("shipped")).toBe("shipped");
  });

  it("labels Coordy interval schedules without inventing webhook triggers", () => {
    expect(scheduleLabel("")).toBe("手动触发");
    expect(scheduleLabel("every:30m")).toBe("每 30 分钟");
    expect(scheduleLabel("every:1h")).toBe("每小时");
    expect(scheduleLabel("every:1d")).toBe("每天");
    expect(scheduleLabel("every:5m")).toBe("每 5 分钟");
    expect(scheduleLabel("cron:0 9 * * *")).toBe("cron:0 9 * * *");
    expect(scheduleSelectItems("every:5m")["every:5m"]).toBe("每 5 分钟");
    expect(scheduleSelectItems("none").none).toBe("手动触发");
  });

  it("distinguishes create-issue mode from fire-only", () => {
    expect(automationModeLabel(true)).toBe("创建事项");
    expect(automationModeLabel(false)).toBe("仅触发");
  });
});

describe("projectIssueStats", () => {
  it("matches kernel integer progress from done / total", () => {
    const tasks = [
      { project_id: "p1", status: "open" },
      { project_id: "p1", status: "done" },
      { project_id: "p1", status: "done" },
      { project_id: "p2", status: "done" },
    ];
    expect(projectIssueStats(tasks, "p1")).toEqual({ total: 3, done: 2, progress: 66 });
    expect(projectIssueStats(tasks, "missing")).toEqual({ total: 0, done: 0, progress: 0 });
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-08-19T12:00:00.000Z");

  it("explains missing or invalid timestamps", () => {
    expect(formatRelativeTime(undefined, now)).toBe("从未运行");
    expect(formatRelativeTime("not-a-date", now)).toBe("not-a-date");
  });

  it("uses relative buckets then a locale date", () => {
    expect(formatRelativeTime("2026-08-19T11:59:20.000Z", now)).toBe("刚刚");
    expect(formatRelativeTime("2026-08-19T11:10:00.000Z", now)).toBe("50 分钟前");
    expect(formatRelativeTime("2026-08-19T08:00:00.000Z", now)).toBe("4 小时前");
    expect(formatRelativeTime("2026-08-17T12:00:00.000Z", now)).toBe("2 天前");
    expect(formatRelativeTime("2026-07-01T12:00:00.000Z", now)).toBe(
      new Date("2026-07-01T12:00:00.000Z").toLocaleDateString("zh-CN"),
    );
  });
});

describe("automation starters", () => {
  it("covers local interval runbooks Coordy can actually fire", () => {
    expect(AUTOMATION_STARTERS.map((item) => item.id)).toEqual([
      "daily-digest",
      "backlog-triage",
      "doc-gaps",
    ]);
    for (const starter of AUTOMATION_STARTERS) {
      expect(starter.title.trim()).not.toHaveLength(0);
      expect(starter.summary.trim()).not.toHaveLength(0);
      expect(starter.runbook.includes("本事项评论")).toBe(true);
      expect(starter.schedule.startsWith("every:")).toBe(true);
      expect(starter.createIssue).toBe(true);
    }
    expect(starterById("daily-digest")?.title).toBe("每日进度汇总");
    expect(starterById(null)).toBeNull();
  });
});

describe("skill starters", () => {
  it("ships a Coordy-authored graph coordination skill, not a third-party workflow editor", () => {
    expect(SKILL_STARTERS.map((item) => item.id)).toEqual(["coordy-graph"]);
    const starter = skillStarterById("coordy-graph");
    expect(starter?.title).toBe("协调图");
    expect(starter?.body).toContain("GOAL:");
    expect(starter?.body).toContain("CONSTRAINT:");
    expect(starter?.body).toContain("DECISION:");
    expect(starter?.body).toContain("DEPENDS: <id 或 COOR-n> [entity]");
    expect(starter?.body).toContain("PLAN:");
    expect(starter?.body).toContain("ACCEPTANCE:");
    expect(starter?.body).toContain("REAFFIRM: <dependency_id>");
    expect(starter?.body).toContain("HOLD: <dependency_id>");
    expect(starter?.body).toContain("绿灯且已指派");
    expect(starter?.body.includes("React Flow")).toBe(false);
    expect(starter?.body.includes("LangGraph")).toBe(false);
    expect(skillStarterById(null)).toBeNull();
  });
});

describe("catalog routes", () => {
  it("keeps collection tabs titled and sidebar items active on detail paths", () => {
    expect(titleFromPath("/graph")).toBe("图");
    expect(titleFromPath("/projects/proj_1")).toBe("项目");
    expect(titleFromPath("/automations/auto_1")).toBe("自动化");
    expect(titleFromPath("/skills/skill_1")).toBe("Skills");
    expect(titleFromPath("/squads/squad_1")).toBe("小队");
    expect(navItemActive("/graph", { to: "/graph" })).toBe(true);
    expect(navItemActive("/projects/proj_1", { to: "/projects" })).toBe(true);
    expect(navItemActive("/automations/auto_1", { to: "/automations" })).toBe(true);
  });
});
