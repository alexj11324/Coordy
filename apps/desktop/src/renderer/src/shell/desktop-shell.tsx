import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Label,
  ScrollArea,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Separator,
  cn,
} from "@coordy/ui";
import { useQuery } from "@tanstack/react-query";
import { PanelLeft, PanelLeftClose, Plus, Sparkles } from "lucide-react";
import { useLayoutEffect } from "react";
import { viewAsDaemon } from "../lib/coordy/client";
import { agentDisplayName, healthLabel, listableAgents } from "../lib/coordy/labels";
import { asAgents, asPrincipals } from "../lib/coordy/views";
import { NamedWithLogo } from "../features/provider-logo";
import { useSession } from "../state/session-store";
import { useLayoutStore } from "../state/layout-store";
import { useTabStore } from "../state/tab-store";
import { CommandPalette, SearchTrigger } from "./command-palette";
import { GlobalShortcuts } from "./global-shortcuts";
import {
  configNav,
  moreNav,
  personalNav,
  SIDEBAR_COLLAPSED_CLASS,
  SIDEBAR_EXPANDED_CLASS,
  type NavItem,
  workspaceNav,
} from "./nav";
import { TabBar } from "./tab-bar";
import { useCompact } from "./use-compact";

function personLabel(name: string): string {
  return name === "Local user" ? "我" : name;
}

function NavItems({ items, collapsed }: { items: NavItem[]; collapsed: boolean }) {
  return (
    <>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          title={item.label}
          className={({ isActive }) =>
            cn(
              "flex items-center rounded-lg text-sm transition-colors",
              collapsed ? "justify-center px-0 py-1.5" : "gap-2 px-2.5 py-1.5",
              isActive
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
            )
          }
        >
          <item.icon className="size-4 shrink-0" />
          {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
        </NavLink>
      ))}
    </>
  );
}

export function DesktopShell() {
  const workspaceId = useSession((s) => s.workspaceId);
  const actor = useSession((s) => s.actor);
  const navigate = useNavigate();
  const location = useLocation();
  const compact = useCompact();
  const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const overlay = compact && !collapsed;
  const railCollapsed = collapsed || overlay;
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => viewAsDaemon({ type: "Health" }),
    refetchInterval: 5000,
  });
  const principals = useQuery({
    queryKey: ["principals-shell", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => viewAsDaemon({ type: "Principals", workspace_id: workspaceId! }),
  });
  const agents = useQuery({
    queryKey: ["agents-shell", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => viewAsDaemon({ type: "Agents", workspace_id: workspaceId! }),
  });
  const appInfo = useQuery({
    queryKey: ["app-info"],
    queryFn: () => window.coordy.getAppInfo(),
  });
  const status =
    health.data && health.data.type === "Health" ? health.data.status : "connecting";
  const people = asPrincipals(principals.data);
  const agentList = listableAgents(asAgents(agents.data));
  const actorValue =
    actor.type === "agent"
      ? `agent:${actor.id}`
      : actor.type === "principal"
        ? `principal:${actor.id}`
        : "daemon";
  const actorItems = [
    ...people.map((person) => ({ value: `principal:${person.id}`, label: personLabel(person.name) })),
    ...agentList.map((agent) => ({
      value: `agent:${agent.id}`,
      label: agentDisplayName(agent),
      harness: agent.harness,
    })),
  ];
  const path = `${location.pathname}${location.search}`;

  useLayoutEffect(() => {
    useTabStore.getState().ensure(path);
  }, [path]);

  const openNewTask = () => {
    useLayoutStore.getState().requestNewTaskFocus();
    useTabStore.getState().ensure("/board");
    navigate("/board");
  };

  const sidebar = (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        railCollapsed && !overlay ? SIDEBAR_COLLAPSED_CLASS : SIDEBAR_EXPANDED_CLASS,
        overlay ? "fixed inset-y-0 left-0 z-40 shadow-lg" : "",
      )}
    >
      <div
        className={cn("flex items-center gap-2 py-3", railCollapsed && !overlay ? "justify-center px-1" : "px-3")}
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-4" />
        </div>
        {railCollapsed && !overlay ? (
          <span className="sr-only">coordy</span>
        ) : (
          <div className="min-w-0 flex-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <div className="text-sm font-semibold tracking-tight">coordy</div>
            <div className="text-xs text-muted-foreground">在这台电脑上和智能体一起干活</div>
          </div>
        )}
        {railCollapsed && !overlay ? null : (
          <Badge variant={status === "ok" ? "outline" : "secondary"} className="shrink-0">
            <span
              className={
                status === "ok" ? "size-1.5 rounded-full bg-emerald-500" : "size-1.5 rounded-full bg-amber-500"
              }
            />
            {healthLabel(status)}
          </Badge>
        )}
      </div>
      <div
        className={cn("space-y-2 pb-3", railCollapsed && !overlay ? "px-1" : "px-3")}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <SearchTrigger collapsed={railCollapsed && !overlay} os={appInfo.data?.os} />
        <Button
          className={railCollapsed && !overlay ? "mx-auto" : "w-full justify-start"}
          size={railCollapsed && !overlay ? "icon-sm" : "default"}
          onClick={openNewTask}
          title="新建任务 C"
        >
          <Plus data-icon="inline-start" />
          {railCollapsed && !overlay ? <span className="sr-only">新建任务</span> : "新建任务"}
        </Button>
      </div>
      {railCollapsed && !overlay ? null : (
        <div className="px-3 pb-3" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <Label className="mb-1.5 px-1 text-xs font-normal text-muted-foreground">当前身份</Label>
          <Select
            value={actorValue}
            items={Object.fromEntries(actorItems.map((item) => [item.value, item.label]))}
            onValueChange={(value) => {
              if (!value) return;
              if (value.startsWith("principal:")) {
                useSession.getState().setPrincipal(value.slice("principal:".length));
              } else if (value.startsWith("agent:")) {
                const id = value.slice("agent:".length);
                const agent = agentList.find((item) => item.id === id);
                if (agent) useSession.getState().setAgent(agent.id, agent.principal_id);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue>
                {(value: string | null) => {
                  const match = actorItems.find((item) => item.value === value);
                  return match?.label ?? value ?? "选一个身份";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>成员</SelectLabel>
                {people.map((person) => (
                  <SelectItem key={person.id} value={`principal:${person.id}`}>
                    {personLabel(person.name)}
                  </SelectItem>
                ))}
              </SelectGroup>
              {agentList.length > 0 ? (
                <SelectGroup>
                  <SelectLabel>智能体</SelectLabel>
                  {agentList.map((agent) => (
                    <SelectItem key={agent.id} value={`agent:${agent.id}`}>
                      <NamedWithLogo provider={agent.harness}>
                        {agentDisplayName(agent)}
                      </NamedWithLogo>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
            </SelectContent>
          </Select>
        </div>
      )}
      <Separator />
      <ScrollArea className={cn("flex-1 py-3", railCollapsed && !overlay ? "px-1" : "px-2")}>
        <nav className="flex flex-col gap-0.5">
          <NavItems items={personalNav} collapsed={railCollapsed && !overlay} />
          {railCollapsed && !overlay ? null : (
            <p className="mt-3 px-2.5 pb-1 text-[11px] font-medium text-muted-foreground">工作区</p>
          )}
          <NavItems items={workspaceNav} collapsed={railCollapsed && !overlay} />
          {railCollapsed && !overlay ? null : (
            <p className="mt-3 px-2.5 pb-1 text-[11px] font-medium text-muted-foreground">配置</p>
          )}
          <NavItems items={configNav} collapsed={railCollapsed && !overlay} />
          {railCollapsed && !overlay ? null : (
            <p className="mt-3 px-2.5 pb-1 text-[11px] font-medium text-muted-foreground">其他</p>
          )}
          <NavItems items={moreNav} collapsed={railCollapsed && !overlay} />
        </nav>
      </ScrollArea>
      <div className={cn("border-t border-sidebar-border p-2", railCollapsed && !overlay ? "flex justify-center" : "")}>
        <Button
          type="button"
          variant="ghost"
          size={railCollapsed && !overlay ? "icon-sm" : "sm"}
          className={railCollapsed && !overlay ? "" : "w-full justify-start"}
          onClick={toggleSidebar}
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          title={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          {collapsed ? <PanelLeft /> : <PanelLeftClose data-icon="inline-start" />}
          {railCollapsed && !overlay ? null : collapsed ? "展开侧栏" : "收起侧栏"}
        </Button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-sidebar text-foreground">
      <GlobalShortcuts />
      {overlay ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/30"
          aria-label="关闭侧栏"
          onClick={() => useLayoutStore.getState().setSidebarCollapsed(true)}
        />
      ) : null}
      {sidebar}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-2 pl-0">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
          <TabBar showSidebarTrigger={railCollapsed && !overlay} />
          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
      <CommandPalette os={appInfo.data?.os} />
    </div>
  );
}
