import { Outlet, useLocation } from "react-router-dom";
import { SidebarInset, SidebarProvider } from "@coordy/ui";
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect } from "react";
import { useLayoutStore } from "../state/layout-store";
import { useTabStore } from "../state/tab-store";
import { AppSidebar } from "./app-sidebar";
import { CommandPalette } from "./command-palette";
import { GlobalShortcuts } from "./global-shortcuts";
import { TabBar } from "./tab-bar";

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
  }, [path]);

  return (
    <SidebarProvider
      className="h-svh overflow-hidden"
      open={!collapsed}
      onOpenChange={(open) => setCollapsed(!open)}
    >
      <GlobalShortcuts />
      <AppSidebar />
      <SidebarInset className="min-h-0 overflow-hidden">
        <TabBar />
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </SidebarInset>
      <CommandPalette os={appInfo.data?.os} />
    </SidebarProvider>
  );
}
