import { useNavigate } from "react-router-dom";
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@coordy/ui";
import { useQuery } from "@tanstack/react-query";
import { User } from "lucide-react";
import { AgentAvatar, NamedAgent } from "../features/agent-avatar";
import { viewAsDaemon } from "../lib/coordy/client";
import { agentDisplayName, listableAgents } from "../lib/coordy/labels";
import { asAgents, asPrincipals } from "../lib/coordy/views";
import { useSession } from "../state/session-store";
import { moreNav } from "./nav";

export function personLabel(name: string): string {
  return name === "Local user" ? "我" : name;
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "我";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  return Array.from(trimmed).slice(0, 2).join("");
}

export function avatarTone(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hues = [
    "bg-sky-500 text-white",
    "bg-violet-500 text-white",
    "bg-amber-500 text-white",
    "bg-emerald-500 text-white",
    "bg-rose-500 text-white",
    "bg-orange-500 text-white",
  ];
  return hues[hash % hues.length] ?? hues[0]!;
}

export function SidebarHelp() {
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  const workspaceId = useSession((s) => s.workspaceId);
  const actor = useSession((s) => s.actor);
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
  const people = asPrincipals(principals.data);
  const agentList = listableAgents(asAgents(agents.data));
  const currentPerson = actor.type === "principal" ? people.find((item) => item.id === actor.id) : null;
  const currentAgent = actor.type === "agent" ? agentList.find((item) => item.id === actor.id) : null;
  const name = currentAgent
    ? agentDisplayName(currentAgent)
    : currentPerson
      ? personLabel(currentPerson.name)
      : "我";
  const subtitle = currentAgent ? "智能体" : "成员";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton tooltip="身份" className="size-8 p-2" />}>
            <User />
            <span className="sr-only">身份</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? "top" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  {currentAgent ? (
                    <AgentAvatar agent={currentAgent} className="size-8" />
                  ) : (
                    <Avatar>
                      <AvatarFallback className={avatarTone(name)}>{initials(name)}</AvatarFallback>
                    </Avatar>
                  )}
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{name}</span>
                    <span className="truncate text-xs">{subtitle}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>成员</DropdownMenuLabel>
              {people.map((person) => (
                <DropdownMenuItem
                  key={person.id}
                  onClick={() => useSession.getState().setPrincipal(person.id)}
                >
                  <User />
                  {personLabel(person.name)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            {agentList.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>智能体</DropdownMenuLabel>
                  {agentList.map((agent) => (
                    <DropdownMenuItem
                      key={agent.id}
                      onClick={() => useSession.getState().setAgent(agent.id, agent.principal_id)}
                    >
                      <NamedAgent agent={agent} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>高级</DropdownMenuLabel>
              {moreNav.map((item) => (
                <DropdownMenuItem
                  key={item.to}
                  onClick={() => {
                    navigate(item.to);
                  }}
                >
                  <item.icon />
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
