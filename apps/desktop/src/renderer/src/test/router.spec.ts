// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost" }

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  matchPath,
  MemoryRouter,
  useLocation,
} from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../shell/desktop-shell", async () => {
  const { Outlet } = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { DesktopShell: Outlet };
});
vi.mock("../features/home", () => ({ HomePage: () => "route:home" }));
vi.mock("../features/board", () => ({ BoardPage: () => "route:board" }));
vi.mock("../features/task-detail", () => ({ TaskDetailPage: () => "route:task-detail" }));
vi.mock("../features/graph", () => ({ GraphPage: () => "route:graph" }));
vi.mock("../features/agents", () => ({ AgentsPage: () => "route:agents" }));
vi.mock("../features/create-agent", () => ({ ManualCreateAgentPage: () => "route:agent-create" }));
vi.mock("../features/agent-detail", () => ({ AgentDetailPage: () => "route:agent-detail" }));
vi.mock("../features/catalog-pages", () => ({
  AutomationsPage: () => "route:automations",
  ProjectsPage: () => "route:projects",
  SkillsPage: () => "route:skills",
  SquadsPage: () => "route:squads",
}));
vi.mock("../features/catalog-detail", () => ({
  AutomationDetailPage: () => "route:automation-detail",
  ProjectDetailPage: () => "route:project-detail",
  SkillDetailPage: () => "route:skill-detail",
  SquadDetailPage: () => "route:squad-detail",
}));
vi.mock("../features/runtimes", () => ({ RuntimesPage: () => "route:harnesses" }));
vi.mock("../features/settings", () => ({ SettingsPage: () => "route:settings" }));
vi.mock("../features/online-team", () => ({ OnlineTeamPage: () => "route:online-team" }));
vi.mock("../features/pages", () => ({
  AuthorityPage: () => "route:authority",
  ChatPage: () => "route:chat",
  ConflictsPage: () => "route:conflicts",
  ContractsPage: () => "route:contracts",
  DependenciesPage: () => "route:dependencies",
  InboxPage: () => "route:inbox",
  MemoryPage: () => "route:memory",
  MyIssuesPage: () => "route:mine",
  PrincipalsPage: () => "route:principals",
  RunsPage: () => "route:runs",
  StatsPage: () => "route:stats",
}));
import {
  AppRouter,
  APP_ROUTE_CASES,
  LEGACY_ROUTE_REDIRECTS,
} from "../app/router";

function LocationProbe() {
  return createElement("output", null, useLocation().pathname);
}

describe("route recovery", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("offers recovery actions for stale or unknown routes", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
        clear: () => undefined,
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/stale/bookmark"] },
          createElement(AppRouter),
        ),
      );
    });

    expect(document.body.textContent).toContain("页面不存在");
    expect(document.body.textContent).toContain("返回开始");
    expect(document.body.textContent).toContain("打开任务");

    await act(async () => root.unmount());
  });

  it("matches every declared collection, detail and missing-detail sample", () => {
    expect(APP_ROUTE_CASES.length).toBeGreaterThan(20);
    for (const route of APP_ROUTE_CASES) {
      expect(matchPath({ path: route.path, end: true }, route.sample), route.id).not.toBeNull();
    }
    expect(
      APP_ROUTE_CASES.filter((route) => route.sample.includes("missing")).map((route) => route.id),
    ).toEqual([
      "task-detail",
      "project-detail",
      "automation-detail",
      "squad-detail",
      "skill-detail",
      "agent-detail",
    ]);
  });

  it.each(APP_ROUTE_CASES)("routes $sample through AppRouter to $id", async (route) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: [route.sample] },
          createElement(AppRouter),
        ),
      );
    });

    expect(document.body.textContent).toContain(`route:${route.id}`);
    await act(async () => root.unmount());
  });

  it.each(LEGACY_ROUTE_REDIRECTS)(
    "redirects legacy route $id to $destination",
    async (route) => {
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      const initial = "sample" in route ? route.sample : route.path;

      await act(async () => {
        root.render(
          createElement(
            MemoryRouter,
            { initialEntries: [initial] },
            createElement(AppRouter),
            createElement(LocationProbe),
          ),
        );
      });

      expect(document.querySelector("output")?.textContent).toBe(route.destination);
      await act(async () => root.unmount());
    },
  );
});
