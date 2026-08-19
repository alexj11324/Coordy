import type { AuthenticatedCommand, AuthorizedQuery, Command, Query, View } from "@coordy/protocol";
import { useSession } from "../../state/session-store";

export async function submit(command: Command) {
  const actor = useSession.getState().actor;
  const envelope: AuthenticatedCommand = { actor, command };
  return window.coordy.submit(envelope);
}

export async function view(query: Query): Promise<View> {
  const actor = useSession.getState().actor;
  const envelope: AuthorizedQuery = { actor, query };
  return window.coordy.view(envelope);
}

export async function viewAsDaemon(query: Query): Promise<View> {
  return window.coordy.view({ actor: { type: "daemon" }, query });
}

export async function submitAsDaemon(command: Command) {
  return window.coordy.submit({ actor: { type: "daemon" }, command });
}
