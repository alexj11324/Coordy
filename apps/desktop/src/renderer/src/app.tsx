import { QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { useEffect, useState } from "react";
import { queryClient } from "./app/query-client";
import { AppRouter } from "./app/router";
import { submitAsDaemon, viewAsDaemon } from "./lib/coordy/client";
import { useSession } from "./state/session-store";
import { applyTheme, useThemeStore } from "./state/theme-store";

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    applyTheme(useThemeStore.getState().preference);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(useThemeStore.getState().preference);
    media.addEventListener("change", onChange);
    bootstrap()
      .then(() => setReady(true))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => media.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    if (!ready) return;
    return window.coordy.subscribe(() => {
      void queryClient.invalidateQueries();
    });
  }, [ready]);
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6 text-destructive">
        {error}
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6 text-sm text-muted-foreground">
        正在打开…
      </div>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AppRouter />
      </HashRouter>
    </QueryClientProvider>
  );
}

async function bootstrap() {
  await viewAsDaemon({ type: "Health" });
  let workspaces = await viewAsDaemon({ type: "Workspaces" });
  let workspaceId =
    workspaces.type === "Workspaces" && workspaces.items[0] ? workspaces.items[0].id : null;
  if (!workspaceId) {
    const created = await submitAsDaemon({ type: "CreateWorkspace", name: "coordy" });
    workspaceId = String(created.ids.workspace_id);
    workspaces = await viewAsDaemon({ type: "Workspaces" });
  }
  useSession.getState().setWorkspace(workspaceId);
  const principals = await viewAsDaemon({ type: "Principals", workspace_id: workspaceId });
  let principalId =
    principals.type === "Principals" && principals.items[0] ? principals.items[0].id : null;
  if (!principalId) {
    const created = await submitAsDaemon({
      type: "CreatePrincipal",
      workspace_id: workspaceId,
      name: "我",
    });
    principalId = String(created.ids.principal_id);
  }
  useSession.getState().setPrincipal(principalId);
}
