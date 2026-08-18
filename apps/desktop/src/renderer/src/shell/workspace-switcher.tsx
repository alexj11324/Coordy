import {
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
import { Check, ChevronsUpDown, GalleryVerticalEnd, Plus } from "lucide-react";
import { queryClient } from "../app/query-client";
import { submitAsDaemon, viewAsDaemon } from "../lib/coordy/client";
import { asPrincipals, asWorkspaces, outcomeId } from "../lib/coordy/views";
import { useSession } from "../state/session-store";
import type { WorkspaceView } from "@coordy/protocol";

function workspaceMark(workspace: WorkspaceView) {
  const icon = workspace.icon?.trim();
  if (icon && Array.from(icon).length <= 2) return icon;
  return null;
}

export async function activateWorkspace(workspaceId: string) {
  useSession.getState().setWorkspace(workspaceId);
  const principals = await viewAsDaemon({ type: "Principals", workspace_id: workspaceId });
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
  const workspaces = useQuery({
    queryKey: ["workspaces-shell"],
    queryFn: () => viewAsDaemon({ type: "Workspaces" }),
  });
  const items = asWorkspaces(workspaces.data);
  const active = items.find((item) => item.id === workspaceId) ?? items[0];

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              />
            }
          >
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sm text-sidebar-primary-foreground">
              {active && workspaceMark(active) ? workspaceMark(active) : <GalleryVerticalEnd className="size-4" />}
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{active?.name ?? "coordy"}</span>
              <span className="truncate text-xs">{active?.slug || active?.description || "本机工作区"}</span>
            </div>
            <ChevronsUpDown className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">工作区</DropdownMenuLabel>
              {items.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id}
                  className="gap-2 p-2"
                  onClick={() => {
                    void activateWorkspace(workspace.id);
                  }}
                >
                  <div className="flex size-6 items-center justify-center rounded-md border text-xs">
                    {workspaceMark(workspace) ?? <GalleryVerticalEnd className="size-3.5" />}
                  </div>
                  <span className="flex-1 truncate">{workspace.name}</span>
                  {workspace.id === active?.id ? <Check className="size-4" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="gap-2 p-2"
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
                <div className="font-medium text-muted-foreground">创建工作区</div>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
