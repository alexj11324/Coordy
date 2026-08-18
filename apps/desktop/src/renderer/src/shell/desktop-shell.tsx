import { Outlet, useLocation } from "react-router-dom";
import { SidebarInset, SidebarProvider } from "@coordy/ui";
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect } from "react";
import { FloatingChat } from "../features/floating-chat";
import { IssueCreateDialog } from "../features/issue-create-dialog";
import { useLayoutStore } from "../state/layout-store";
import { useNavHistoryStore } from "../state/nav-history-store";
import { useTabStore } from "../state/tab-store";
import { AppSidebar } from "./app-sidebar";
import { AppTitlebar } from "./app-titlebar";
import { CommandPalette } from "./command-palette";
import { GlobalShortcuts } from "./global-shortcuts";

export function DesktopShell() {
  const location = useLocation();
  const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const setCollapsed = useLayoutStore((s) => s.setSidebarCollapsed);
  const appInfo = useQuery({
    queryKey: ["app-info"],
    queryFn: () => window.coordy.getAppInfo(),
  });
  const path = `${location.pathname}${location.search}`;

  useLayoutEffect(() => {
    useTabStore.getState().ensure(path);
    useNavHistoryStore.getState().record(path);
  }, [path]);

  return (
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
  );
}
