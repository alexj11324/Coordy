import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { DesktopShell } from "../shell/desktop-shell";
import { HomePage } from "../features/home";
import { BoardPage } from "../features/board";
import { TaskDetailPage } from "../features/task-detail";
import { AgentsPage } from "../features/agents";
import { CreateAgentPage } from "../features/create-agent";
import { AgentDetailPage } from "../features/agent-detail";
import { RuntimesPage } from "../features/runtimes";
import { SettingsPage } from "../features/settings";
import {
  AuthorityPage,
  ConflictsPage,
  ContractsPage,
  DependenciesPage,
  AutomationsPage,
  ChatPage,
  InboxPage,
  MemoryPage,
  MyIssuesPage,
  PrincipalsPage,
  ProjectsPage,
  RunsPage,
  SkillsPage,
  SquadsPage,
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
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/mine" element={<MyIssuesPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="/squads" element={<SquadsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
        </Route>
        <Route element={<PaddedCanvas />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="/principals" element={<PrincipalsPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/new" element={<CreateAgentPage />} />
          <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          <Route path="/runtimes" element={<RuntimesPage />} />
          <Route path="/authority" element={<AuthorityPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/contracts" element={<ContractsPage />} />
          <Route path="/dependencies" element={<DependenciesPage />} />
          <Route path="/conflicts" element={<ConflictsPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
