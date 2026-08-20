import { Button, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@coordy/ui";
import type { ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { DesktopShell } from "../shell/desktop-shell";
import { HomePage } from "../features/home";
import { BoardPage } from "../features/board";
import { TaskDetailPage } from "../features/task-detail";
import { GraphPage } from "../features/graph";
import { AgentsPage } from "../features/agents";
import { ManualCreateAgentPage } from "../features/create-agent";
import { AgentDetailPage } from "../features/agent-detail";
import {
  AutomationsPage,
  ProjectsPage,
  SkillsPage,
  SquadsPage,
} from "../features/catalog-pages";
import {
  AutomationDetailPage,
  ProjectDetailPage,
  SkillDetailPage,
  SquadDetailPage,
} from "../features/catalog-detail";
import { RuntimesPage } from "../features/runtimes";
import { SettingsPage } from "../features/settings";
import { OnlineTeamPage } from "../features/online-team";
import {
  AuthorityPage,
  ConflictsPage,
  ContractsPage,
  DependenciesPage,
  ChatPage,
  InboxPage,
  MemoryPage,
  MyIssuesPage,
  PrincipalsPage,
  RunsPage,
  StatsPage,
} from "../features/pages";

type CanvasRoute = {
  id: string;
  path: string;
  sample: string;
  element: ReactNode;
};

export const LEGACY_ROUTE_REDIRECTS = [
  { id: "home-legacy", path: "/home", destination: "/" },
  { id: "runtime-legacy", path: "/runtimes", destination: "/harnesses" },
  { id: "agent-blank-legacy", path: "/agents/new/blank", destination: "/agents/new" },
  { id: "agent-ai-legacy", path: "/agents/new/ai", destination: "/agents/new" },
  {
    id: "agent-ai-session-legacy",
    path: "/agents/new/ai/:sessionId",
    sample: "/agents/new/ai/old-session",
    destination: "/agents/new",
  },
] as const;

const FLUSH_ROUTES: CanvasRoute[] = [
  { id: "board", path: "/board", sample: "/board", element: <BoardPage /> },
  { id: "task-detail", path: "/board/:taskId", sample: "/board/missing", element: <TaskDetailPage /> },
  { id: "graph", path: "/graph", sample: "/graph", element: <GraphPage /> },
  { id: "chat", path: "/chat", sample: "/chat", element: <ChatPage /> },
  { id: "mine", path: "/mine", sample: "/mine", element: <MyIssuesPage /> },
  { id: "projects", path: "/projects", sample: "/projects", element: <ProjectsPage /> },
  { id: "project-detail", path: "/projects/:projectId", sample: "/projects/missing", element: <ProjectDetailPage /> },
  { id: "automations", path: "/automations", sample: "/automations", element: <AutomationsPage /> },
  { id: "automation-detail", path: "/automations/:automationId", sample: "/automations/missing", element: <AutomationDetailPage /> },
  { id: "squads", path: "/squads", sample: "/squads", element: <SquadsPage /> },
  { id: "squad-detail", path: "/squads/:squadId", sample: "/squads/missing", element: <SquadDetailPage /> },
  { id: "stats", path: "/stats", sample: "/stats", element: <StatsPage /> },
  { id: "skills", path: "/skills", sample: "/skills", element: <SkillsPage /> },
  { id: "skill-detail", path: "/skills/:skillId", sample: "/skills/missing", element: <SkillDetailPage /> },
  { id: "agent-create", path: "/agents/new", sample: "/agents/new", element: <ManualCreateAgentPage /> },
  { id: "settings", path: "/settings", sample: "/settings", element: <SettingsPage /> },
  { id: "online-team", path: "/team", sample: "/team", element: <OnlineTeamPage /> },
];

const PADDED_ROUTES: CanvasRoute[] = [
  { id: "home", path: "/", sample: "/", element: <HomePage /> },
  { id: "principals", path: "/principals", sample: "/principals", element: <PrincipalsPage /> },
  { id: "agents", path: "/agents", sample: "/agents", element: <AgentsPage /> },
  { id: "agent-detail", path: "/agents/:agentId", sample: "/agents/missing", element: <AgentDetailPage /> },
  { id: "harnesses", path: "/harnesses", sample: "/harnesses", element: <RuntimesPage /> },
  { id: "authority", path: "/authority", sample: "/authority", element: <AuthorityPage /> },
  { id: "memory", path: "/memory", sample: "/memory", element: <MemoryPage /> },
  { id: "contracts", path: "/contracts", sample: "/contracts", element: <ContractsPage /> },
  { id: "dependencies", path: "/dependencies", sample: "/dependencies", element: <DependenciesPage /> },
  { id: "conflicts", path: "/conflicts", sample: "/conflicts", element: <ConflictsPage /> },
  { id: "runs", path: "/runs", sample: "/runs", element: <RunsPage /> },
  { id: "inbox", path: "/inbox", sample: "/inbox", element: <InboxPage /> },
];

export const APP_ROUTE_CASES = [...FLUSH_ROUTES, ...PADDED_ROUTES].map(
  ({ id, path, sample }) => ({ id, path, sample }),
);

function FlushCanvas() {
  return (
    <div className="h-full min-h-0 overflow-hidden">
      <Outlet />
    </div>
  );
}

function PaddedCanvas() {
  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <Outlet />
    </div>
  );
}

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Empty className="min-h-[50vh]">
      <EmptyHeader>
        <EmptyTitle>页面不存在</EmptyTitle>
        <EmptyDescription>这个地址可能来自旧标签页，或对应功能已经移动。</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        <Button onClick={() => navigate("/")}>返回开始</Button>
        <Button variant="secondary" onClick={() => navigate("/board")}>打开任务</Button>
      </EmptyContent>
    </Empty>
  );
}

export function AppRouter() {
  return (
    <Routes>
      <Route element={<DesktopShell />}>
        <Route element={<FlushCanvas />}>
          {FLUSH_ROUTES.map((route) => (
            <Route key={route.id} path={route.path} element={route.element} />
          ))}
          {LEGACY_ROUTE_REDIRECTS.filter((route) => route.id.startsWith("agent-")).map(
            (route) => (
              <Route
                key={route.id}
                path={route.path}
                element={<Navigate to={route.destination} replace />}
              />
            ),
          )}
        </Route>
        <Route element={<PaddedCanvas />}>
          {PADDED_ROUTES.map((route) => (
            <Route key={route.id} path={route.path} element={route.element} />
          ))}
          {LEGACY_ROUTE_REDIRECTS.filter((route) => !route.id.startsWith("agent-")).map(
            (route) => (
              <Route
                key={route.id}
                path={route.path}
                element={<Navigate to={route.destination} replace />}
              />
            ),
          )}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
