import { create } from "zustand";
import type { Actor } from "@coordy/protocol";

type SessionState = {
  workspaceId: string | null;
  principalId: string | null;
  agentId: string | null;
  actor: Actor;
  setWorkspace: (id: string) => void;
  setPrincipal: (id: string) => void;
  setAgent: (id: string, principalId: string) => void;
};

export const useSession = create<SessionState>((set) => ({
  workspaceId: null,
  principalId: null,
  agentId: null,
  actor: { type: "daemon" },
  setWorkspace: (workspaceId) =>
    set((state) =>
      state.workspaceId === workspaceId
        ? state
        : {
            workspaceId,
            principalId: null,
            agentId: null,
            actor: { type: "daemon" },
          },
    ),
  setPrincipal: (principalId) =>
    set({
      principalId,
      agentId: null,
      actor: { type: "principal", id: principalId },
    }),
  setAgent: (agentId, principalId) =>
    set({
      agentId,
      principalId,
      actor: { type: "agent", id: agentId, principal_id: principalId },
    }),
}));
