import { Navigate, Outlet, Route, Routes } from "react-router-dom";
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

export function AppRouter() {
  return (
    <Routes>
      <Route element={<DesktopShell />}>
        <Route element={<FlushCanvas />}>
          <Route path="/board" element={<BoardPage />} />
          <Route path="/board/:taskId" element={<TaskDetailPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/mine" element={<MyIssuesPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route
            path="/automations/:automationId"
            element={<AutomationDetailPage />}
          />
          <Route path="/squads" element={<SquadsPage />} />
          <Route path="/squads/:squadId" element={<SquadDetailPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/skills/:skillId" element={<SkillDetailPage />} />
          <Route path="/agents/new" element={<ManualCreateAgentPage />} />
          <Route
            path="/agents/new/blank"
            element={<Navigate to="/agents/new" replace />}
          />
          <Route
            path="/agents/new/ai"
            element={<Navigate to="/agents/new" replace />}
          />
          <Route
            path="/agents/new/ai/:sessionId"
            element={<Navigate to="/agents/new" replace />}
          />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route element={<PaddedCanvas />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="/principals" element={<PrincipalsPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          <Route path="/harnesses" element={<RuntimesPage />} />
          <Route
            path="/runtimes"
            element={<Navigate to="/harnesses" replace />}
          />
          <Route path="/authority" element={<AuthorityPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/contracts" element={<ContractsPage />} />
          <Route path="/dependencies" element={<DependenciesPage />} />
          <Route path="/conflicts" element={<ConflictsPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/inbox" element={<InboxPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
