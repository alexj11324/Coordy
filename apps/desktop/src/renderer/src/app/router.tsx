import { Navigate, Route, Routes } from "react-router-dom";
import { DesktopShell } from "../shell/desktop-shell";
import { HomePage } from "../features/home";
import {
  AgentsPage,
  AuthorityPage,
  BoardPage,
  ConflictsPage,
  ContractsPage,
  DependenciesPage,
  InboxPage,
  MemoryPage,
  PrincipalsPage,
  RunsPage,
  SettingsPage,
} from "../features/pages";

export function AppRouter() {
  return (
    <Routes>
      <Route element={<DesktopShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="/board" element={<BoardPage />} />
        <Route path="/principals" element={<PrincipalsPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/authority" element={<AuthorityPage />} />
        <Route path="/memory" element={<MemoryPage />} />
        <Route path="/contracts" element={<ContractsPage />} />
        <Route path="/dependencies" element={<DependenciesPage />} />
        <Route path="/conflicts" element={<ConflictsPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
