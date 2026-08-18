import { NavLink, Outlet } from "react-router-dom";
import {
  Badge,
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
} from "@coordy/ui";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  FileText,
  GitBranch,
  Inbox,
  LayoutDashboard,
  Play,
  Settings,
  Shield,
  Sparkles,
  StickyNote,
  Users,
} from "lucide-react";
import { viewAsDaemon } from "../lib/coordy/client";
import { asAgents, asPrincipals } from "../lib/coordy/views";
import { useSession } from "../state/session-store";

const links = [
  ["/board", "Board", LayoutDashboard],
  ["/principals", "Principals", Users],
  ["/agents", "Agents", Bot],
  ["/authority", "Authority", Shield],
  ["/memory", "Memory", StickyNote],
  ["/contracts", "Contracts", FileText],
  ["/dependencies", "Dependencies", GitBranch],
  ["/conflicts", "Conflicts", AlertTriangle],
  ["/runs", "Runs", Play],
  ["/inbox", "Inbox", Inbox],
  ["/settings", "Settings", Settings],
] as const;

export function DesktopShell() {
  const workspaceId = useSession((s) => s.workspaceId);
  const actor = useSession((s) => s.actor);
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
  const status =
    health.data && health.data.type === "Health" ? health.data.status : "connecting";
  const people = asPrincipals(principals.data);
  const agentList = asAgents(agents.data);
  const actorValue =
    actor.type === "agent"
      ? `agent:${actor.id}`
      : actor.type === "principal"
        ? `principal:${actor.id}`
        : "daemon";
  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold tracking-tight">Coordy</div>
            <div className="text-xs text-muted-foreground">Local kernel</div>
          </div>
          <Badge variant={status === "ok" ? "outline" : "secondary"} className="capitalize">
            <span
              className={
                status === "ok" ? "size-1.5 rounded-full bg-emerald-500" : "size-1.5 rounded-full bg-amber-500"
              }
            />
            {status}
          </Badge>
        </div>
        <div className="px-3 pb-3">
          <Label className="mb-1.5 px-1 text-xs font-normal text-muted-foreground">Acting as</Label>
          <Select
            value={actorValue}
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
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Principals</SelectLabel>
                {people.map((person) => (
                  <SelectItem key={person.id} value={`principal:${person.id}`}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectGroup>
              {agentList.length > 0 ? (
                <SelectGroup>
                  <SelectLabel>Agents</SelectLabel>
                  {agentList.map((agent) => (
                    <SelectItem key={agent.id} value={`agent:${agent.id}`}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
            </SelectContent>
          </Select>
        </div>
        <Separator />
        <ScrollArea className="flex-1 px-2 py-3">
          <nav className="flex flex-col gap-0.5">
            {links.map(([to, label, Icon]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  [
                    "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                  ].join(" ")
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </ScrollArea>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
