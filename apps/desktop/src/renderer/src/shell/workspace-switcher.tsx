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
import { Check, ChevronDown, LogOut, Plus } from "lucide-react";
import { queryClient } from "../app/query-client";
import { submitAsDaemon, viewAsDaemon } from "../lib/coordy/client";
import { agentDisplayName, listableAgents } from "../lib/coordy/labels";
import {
  asAgents,
  asPrincipals,
  asWorkspaces,
  outcomeId,
} from "../lib/coordy/views";
import { useSession } from "../state/session-store";
import type { WorkspaceView } from "@coordy/protocol";
import { AgentAvatar } from "../features/agent-avatar";
import { avatarTone, initials, personLabel } from "./nav-user";

function workspaceInitial(workspace?: WorkspaceView | null): string {
  const name = workspace?.name?.trim() || "coordy";
  return (Array.from(name)[0] ?? "C").toUpperCase();
}

export async function activateWorkspace(workspaceId: string) {
  useSession.getState().setWorkspace(workspaceId);
  const principals = await viewAsDaemon({
    type: "Principals",
    workspace_id: workspaceId,
  });
  let principalId = asPrincipals(principals)[0]?.id;
  if (!principalId) {
    const created = await submitAsDaemon({
      type: "CreatePrincipal",
      workspace_id: workspaceId,
      name: "我",
    });
    principalId = outcomeId(created.ids, "principal_id");
  }
  if (principalId) useSession.getState().setPrincipal(principalId);
  await queryClient.invalidateQueries();
}

export function WorkspaceSwitcher() {
  const { isMobile } = useSidebar();
  const workspaceId = useSession((s) => s.workspaceId);
  const actor = useSession((s) => s.actor);
  const workspaces = useQuery({
    queryKey: ["workspaces-shell"],
    queryFn: () => viewAsDaemon({ type: "Workspaces" }),
  });
  const principals = useQuery({
    queryKey: ["principals-shell", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () =>
      viewAsDaemon({ type: "Principals", workspace_id: workspaceId! }),
  });
  const agents = useQuery({
    queryKey: ["agents-shell", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => viewAsDaemon({ type: "Agents", workspace_id: workspaceId! }),
  });
  const items = asWorkspaces(workspaces.data);
  const active = items.find((item) => item.id === workspaceId) ?? items[0];
  const people = asPrincipals(principals.data);
  const agentList = listableAgents(asAgents(agents.data));
  const currentPerson =
    actor.type === "principal"
      ? people.find((item) => item.id === actor.id)
      : null;
  const currentAgent =
    actor.type === "agent"
      ? agentList.find((item) => item.id === actor.id)
      : null;
  const accountName = currentAgent
    ? agentDisplayName(currentAgent)
    : currentPerson
      ? personLabel(currentPerson.name)
      : personLabel(people[0]?.name ?? "我");
  const accountSubtitle = currentAgent ? "智能体" : "本机成员";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton className="h-9 data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground" />
            }
          >
            <div className="flex size-6 items-center justify-center rounded-full bg-foreground text-[11px] font-medium text-background">
              {workspaceInitial(active)}
            </div>
            <span className="truncate font-medium">
              {active?.name ?? "coordy"}
            </span>
            <ChevronDown className="ml-auto text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-64 text-sm"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <div className="flex items-center gap-3 px-2 py-2">
              {currentAgent ? (
                <AgentAvatar agent={currentAgent} className="size-9" />
              ) : (
                <Avatar className="size-9">
                  <AvatarFallback className={avatarTone(accountName)}>
                    {initials(accountName)}
                  </AvatarFallback>
                </Avatar>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-5">
                  {accountName}
                </p>
                <p className="truncate text-sm leading-5 text-muted-foreground">
                  {accountSubtitle}
                </p>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-sm font-medium text-muted-foreground">
                工作区
              </DropdownMenuLabel>
              {items.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id}
                  className="gap-2 py-2"
                  onClick={() => {
                    void activateWorkspace(workspace.id);
                  }}
                >
                  <div className="flex size-6 items-center justify-center rounded-full bg-foreground text-[11px] font-medium text-background">
                    {workspaceInitial(workspace)}
                  </div>
                  <span className="flex-1 truncate text-sm">
                    {workspace.name}
                  </span>
                  {workspace.id === active?.id ? (
                    <Check className="size-4" />
                  ) : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                className="gap-2 py-2"
                onClick={() => {
                  void (async () => {
                    const created = await submitAsDaemon({
                      type: "CreateWorkspace",
                      name: `工作区 ${items.length + 1}`,
                    });
                    const id = outcomeId(created.ids, "workspace_id");
                    if (id) await activateWorkspace(id);
                  })();
                }}
              >
                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <Plus className="size-4" />
                </div>
                <span className="text-sm">创建工作区</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                variant="destructive"
                className="gap-2 py-2"
                onClick={() => {
                  void window.coordy.quit();
                }}
              >
                <LogOut />
                退出应用
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
