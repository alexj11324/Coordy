import { NavLink, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@coordy/ui";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { modifierSymbol } from "../lib/coordy/shortcuts";
import { useLayoutStore } from "../state/layout-store";
import { SidebarHelp } from "./nav-user";
import { configNav, navItemActive, personalNav, workspaceNav, type NavItem } from "./nav";
import { WorkspaceSwitcher } from "./workspace-switcher";

function NavSection({ label, items }: { label?: string; items: NavItem[] }) {
  const pathname = useLocation().pathname;
  return (
    <SidebarGroup>
      {label ? <SidebarGroupLabel>{label}</SidebarGroupLabel> : null}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                isActive={navItemActive(pathname, item)}
                tooltip={item.label}
                render={<NavLink to={item.to} end={item.end} />}
              >
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function SearchTrigger({ os }: { os?: string }) {
  const setOpen = useLayoutStore((s) => s.setPaletteOpen);
  const mod = modifierSymbol(os);
  return (
    <button
      type="button"
      className="flex h-8 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background px-2.5 text-sm text-muted-foreground shadow-none outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:px-0"
      aria-label="搜索"
      title={`搜索 ${mod}+K`}
      onClick={() => setOpen(true)}
    >
      <Search className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left group-data-[collapsible=icon]:hidden">搜索...</span>
      <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
        {`${mod}+K`}
      </kbd>
    </button>
  );
}

export function AppSidebar({ os }: { os?: string }) {
  const appInfo = useQuery({
    queryKey: ["app-info"],
    queryFn: () => window.coordy.getAppInfo(),
  });
  const platform = os ?? appInfo.data?.os;

  const openNewTask = () => {
    useLayoutStore.getState().requestNewTaskFocus();
  };

  return (
    <Sidebar variant="inset" collapsible="icon" className="pt-11">
      <SidebarHeader className="gap-2 p-2">
        <WorkspaceSwitcher />
        <SearchTrigger os={platform} />
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
          title="新建任务 C"
          onClick={openNewTask}
        >
          <Plus className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left group-data-[collapsible=icon]:hidden">新建任务</span>
          <kbd className="font-mono text-[10px] text-primary-foreground/80 group-data-[collapsible=icon]:hidden">
            C
          </kbd>
        </button>
      </SidebarHeader>
      <SidebarContent>
        <NavSection items={personalNav} />
        <NavSection label="工作区" items={workspaceNav} />
        <NavSection label="配置" items={configNav} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarHelp />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
