import { Outlet, useLocation } from "react-router-dom";
import { SidebarInset, SidebarProvider, TooltipProvider } from "@coordy/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef } from "react";
import { submit, view } from "../lib/coordy/client";
import { asHealth } from "../lib/coordy/views";
import { FloatingChat } from "../features/floating-chat";
import { IssueCreateDialog } from "../features/issue-create-dialog";
import { useLayoutStore } from "../state/layout-store";
import { useNavHistoryStore } from "../state/nav-history-store";
import { useSession } from "../state/session-store";
import { useTabStore } from "../state/tab-store";
import { AppSidebar } from "./app-sidebar";
import { AppTitlebar } from "./app-titlebar";
import { CommandPalette } from "./command-palette";
import { GlobalShortcuts } from "./global-shortcuts";

export function DesktopShell() {
  const location = useLocation();
  const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const setCollapsed = useLayoutStore((s) => s.setSidebarCollapsed);
  const workspaceId = useSession((s) => s.workspaceId);
  const registeredKey = useRef<string | null>(null);
  const appInfo = useQuery({
    queryKey: ["app-info"],
    queryFn: () => window.coordy.getAppInfo(),
  });
  const health = useQuery({
    queryKey: ["view", { type: "Health" }],
    queryFn: () => view({ type: "Health" }),
    refetchInterval: 5000,
    retry: false,
  });
  const path = `${location.pathname}${location.search}`;

  useLayoutEffect(() => {
    useTabStore.getState().sync(path);
    useNavHistoryStore.getState().record(path);
  }, [path]);

  useEffect(() => {
    const live = asHealth(health.data);
    const host = appInfo.data?.hostname?.trim();
    if (!workspaceId || !host || live?.status !== "ok") return;
    const key = `${workspaceId}:${host}`;
    if (registeredKey.current === key) return;
    registeredKey.current = key;
    void submit({
      type: "RegisterComputer",
      workspace_id: workspaceId,
      name: host,
      kind: "local",
    }).catch(() => {
      registeredKey.current = null;
    });
  }, [workspaceId, appInfo.data?.hostname, health.data]);

  return (
    <TooltipProvider>
    <SidebarProvider
      className="relative h-svh overflow-hidden"
      open={!collapsed}
      onOpenChange={(open) => setCollapsed(!open)}
    >
      <GlobalShortcuts />
      <AppTitlebar />
      <AppSidebar os={appInfo.data?.os} />
      <SidebarInset className="relative min-h-0 overflow-hidden pt-11">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
        <FloatingChat />
      </SidebarInset>
      <IssueCreateDialog os={appInfo.data?.os} />
      <CommandPalette os={appInfo.data?.os} />
    </SidebarProvider>
    </TooltipProvider>
  );
}
