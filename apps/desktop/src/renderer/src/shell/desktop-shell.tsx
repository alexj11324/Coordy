import { NavLink, Outlet } from "react-router-dom";
import { Badge } from "@coordy/ui";
import { useQuery } from "@tanstack/react-query";
import type { ChangeEvent } from "react";
import { viewAsDaemon } from "../lib/coordy/client";
import { asAgents, asPrincipals } from "../lib/coordy/views";
import { useSession } from "../state/session-store";

const links = [
  ["/board", "Board"],
  ["/principals", "Principals"],
  ["/agents", "Agents"],
  ["/authority", "Authority"],
  ["/memory", "Memory"],
  ["/contracts", "Contracts"],
  ["/dependencies", "Dependencies"],
  ["/conflicts", "Conflicts"],
  ["/runs", "Runs"],
  ["/inbox", "Inbox"],
  ["/settings", "Settings"],
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
  return (
    <div className="flex h-screen">
      <aside className="w-56 border-r border-zinc-200 bg-white p-4">
        <div className="mb-4 flex items-center justify-between">
          <strong>Coordy</strong>
          <Badge>{status}</Badge>
        </div>
        <label className="mb-4 block text-xs text-zinc-500">
          Acting as
          <select
            className="mt-1 w-full rounded border border-zinc-300 p-1 text-sm text-zinc-900"
            value={
              actor.type === "agent"
                ? `agent:${actor.id}`
                : actor.type === "principal"
                  ? `principal:${actor.id}`
                  : "daemon"
            }
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              const value = event.target.value;
              if (value.startsWith("principal:")) {
                useSession.getState().setPrincipal(value.slice("principal:".length));
              } else if (value.startsWith("agent:")) {
                const id = value.slice("agent:".length);
                const agent = agentList.find((item) => item.id === id);
                if (agent) useSession.getState().setAgent(agent.id, agent.principal_id);
              }
            }}
          >
            {people.map((person) => (
              <option key={person.id} value={`principal:${person.id}`}>
                Principal {person.name}
              </option>
            ))}
            {agentList.map((agent) => (
              <option key={agent.id} value={`agent:${agent.id}`}>
                Agent {agent.name}
              </option>
            ))}
          </select>
        </label>
        <nav className="flex flex-col gap-1 text-sm">
          {links.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `rounded px-2 py-1 ${isActive ? "bg-zinc-900 text-white" : "text-zinc-700"}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
