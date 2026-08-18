import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@coordy/ui";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Ellipsis, Plus, Search } from "lucide-react";
import { modifierSymbol } from "../lib/coordy/shortcuts";
import { useLayoutStore } from "../state/layout-store";
import { useTabStore } from "../state/tab-store";
import { NavUser } from "./nav-user";
import {
  configNav,
  moreNav,
  navItemActive,
  personalNav,
  workspaceNav,
  type NavItem,
} from "./nav";
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

function AdvancedNav() {
  const pathname = useLocation().pathname;
  const open = moreNav.some((item) => navItemActive(pathname, item));
  return (
    <SidebarGroup>
      <SidebarMenu>
        <Collapsible defaultOpen={open} className="group/collapsible" render={<SidebarMenuItem />}>
          <CollapsibleTrigger render={<SidebarMenuButton tooltip="高级" />}>
            <Ellipsis />
            <span>高级</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {moreNav.map((item) => (
                <SidebarMenuSubItem key={item.to}>
                  <SidebarMenuSubButton
                    isActive={navItemActive(pathname, item)}
                    render={<NavLink to={item.to} />}
                  >
                    <span>{item.label}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenu>
    </SidebarGroup>
  );
}

function SearchTrigger({ os }: { os?: string }) {
  const setOpen = useLayoutStore((s) => s.setPaletteOpen);
  const mod = modifierSymbol(os);
  return (
    <SidebarMenuButton
      className="text-sidebar-foreground/70"
      tooltip="搜索"
      onClick={() => setOpen(true)}
    >
      <Search />
      <span>搜索…</span>
      <span className="ml-auto font-mono text-[10px] tracking-widest text-muted-foreground">{`${mod}+K`}</span>
    </SidebarMenuButton>
  );
}

export function AppSidebar() {
  const navigate = useNavigate();
  const appInfo = useQuery({
    queryKey: ["app-info"],
    queryFn: () => window.coordy.getAppInfo(),
  });

  const openNewTask = () => {
    useLayoutStore.getState().requestNewTaskFocus();
    useTabStore.getState().ensure("/board");
    navigate("/board");
  };

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <WorkspaceSwitcher />
        <SidebarMenu>
          <SidebarMenuItem>
            <SearchTrigger os={appInfo.data?.os} />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="新建任务" onClick={openNewTask}>
              <Plus />
              <span>新建任务</span>
              <SidebarMenuBadge>C</SidebarMenuBadge>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavSection items={personalNav} />
        <NavSection label="工作区" items={workspaceNav} />
        <NavSection label="配置" items={configNav} />
        <AdvancedNav />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
