import { NavLink, Outlet, useNavigate } from "react-router-dom";
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
} from "@coordy/ui";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bot,
  FileText,
  GitBranch,
  Home,
  Inbox,
  LayoutDashboard,
  Monitor,
  Play,
  Plus,
  Settings,
  Shield,
  Sparkles,
  StickyNote,
  Users,
} from "lucide-react";
import { viewAsDaemon } from "../lib/coordy/client";
import { agentDisplayName, healthLabel, listableAgents } from "../lib/coordy/labels";
import { asAgents, asPrincipals } from "../lib/coordy/views";
import { useSession } from "../state/session-store";

const personal = [
  ["/inbox", "收件箱", Inbox],
  ["/", "开始", Home],
  ["/board", "任务", LayoutDashboard],
] as const;

const workspace = [["/agents", "智能体", Bot]] as const;

const config = [
  ["/runtimes", "运行时", Monitor],
  ["/settings", "设置", Settings],
] as const;

const more = [
  ["/runs", "动态", Play],
  ["/principals", "成员", Users],
  ["/authority", "权限", Shield],
  ["/memory", "备忘", StickyNote],
  ["/contracts", "约定", FileText],
  ["/dependencies", "关联", GitBranch],
  ["/conflicts", "冲突", AlertTriangle],
] as const;

function personLabel(name: string): string {
  return name === "Local user" ? "我" : name;
}

function NavItems({
  items,
}: {
  items: ReadonlyArray<readonly [string, string, LucideIcon]>;
}) {
  return (
    <>
      {items.map(([to, label, Icon]) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
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
    </>
  );
}

export function DesktopShell() {
  const workspaceId = useSession((s) => s.workspaceId);
  const actor = useSession((s) => s.actor);
  const navigate = useNavigate();
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
    })),
  ];
  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold tracking-tight">coordy</div>
            <div className="text-xs text-muted-foreground">在这台电脑上和智能体一起干活</div>
          </div>
          <Badge variant={status === "ok" ? "outline" : "secondary"}>
            <span
              className={
                status === "ok" ? "size-1.5 rounded-full bg-emerald-500" : "size-1.5 rounded-full bg-amber-500"
              }
            />
            {healthLabel(status)}
          </Badge>
        </div>
        <div className="px-3 pb-3">
          <Button className="w-full justify-start" onClick={() => navigate("/board")}>
            <Plus data-icon="inline-start" />
            新建任务
          </Button>
        </div>
        <div className="px-3 pb-3">
          <Label className="mb-1.5 px-1 text-xs font-normal text-muted-foreground">当前身份</Label>
          <Select
            value={actorValue}
            items={actorItems}
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
                      {agentDisplayName(agent)}
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
            <NavItems items={personal} />
            <p className="mt-3 px-2.5 pb-1 text-[11px] font-medium text-muted-foreground">工作区</p>
            <NavItems items={workspace} />
            <p className="mt-3 px-2.5 pb-1 text-[11px] font-medium text-muted-foreground">配置</p>
            <NavItems items={config} />
            <p className="mt-3 px-2.5 pb-1 text-[11px] font-medium text-muted-foreground">其他</p>
            <NavItems items={more} />
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
