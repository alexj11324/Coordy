import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  classifyCreateAgentError,
  emptyAgentDraft,
  type AgentDraft,
} from "../../lib/coordy/agent-draft";
import {
  browserStore,
  clearManualDraft,
  readManualDraft,
  writeManualDraft,
} from "../../lib/coordy/builder-sessions";
import {
  harnessIdsMatch,
  initialRuntimeId,
  pickerRuntimes,
  runtimeChipLabel,
  runtimeIsLaunchable,
} from "../../lib/coordy/labels";
import { createNamedAgent } from "../../lib/coordy/start-task";
import { useSession } from "../../state/session-store";
import {
  AgentConfigurationPanel,
  CreateAgentFooter,
} from "./agent-create-form";
import { AgentCreateChip, AgentCreateShell } from "./create-shell";

export function ManualCreateAgentPage() {
  const workspaceId = useSession((s) => s.workspaceId);
  const principalId = useSession((s) => s.principalId);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });
  const appInfo = useQuery({
    queryKey: ["app-info"],
    queryFn: () => window.coordy.getAppInfo(),
  });
  const os = appInfo.data?.os;
  const [draft, setDraft] = useState<AgentDraft>(emptyAgentDraft);
  const [hydrated, setHydrated] = useState(false);
  const [creating, setCreating] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const runtimes = useMemo(
    () => pickerRuntimes(catalog.data, draft.harness),
    [catalog.data, draft.harness],
  );
  const selected = runtimes.find((item) =>
    harnessIdsMatch(item.id, draft.harness),
  );

  useEffect(() => {
    if (!workspaceId || hydrated || catalog.isLoading) return;
    const store = browserStore();
    const saved = store ? readManualDraft(workspaceId, store) : null;
    const harness = initialRuntimeId(
      catalog.data,
      searchParams.get("harness"),
      saved?.harness,
    );
    const next = { ...(saved ?? emptyAgentDraft()), harness };
    if (!next.avatar) next.avatar = emptyAgentDraft().avatar;
    setDraft(next);
    setHydrated(true);
  }, [workspaceId, catalog.data, catalog.isLoading, hydrated, searchParams]);

  useEffect(() => {
    if (!hydrated || draft.harness || runtimes.length === 0) return;
    setDraft((current) => ({ ...current, harness: runtimes[0]?.id ?? "" }));
  }, [hydrated, draft.harness, runtimes]);

  useEffect(() => {
    if (!hydrated || !workspaceId) return;
    const store = browserStore();
    if (store) writeManualDraft(workspaceId, draft, store);
  }, [draft, hydrated, workspaceId]);

  const canCreate =
    draft.name.trim().length > 0 && runtimeIsLaunchable(selected) && !creating;

  const create = async () => {
    if (!workspaceId || !principalId) {
      setFormError("工作区尚未就绪。");
      return;
    }
    if (!runtimeIsLaunchable(selected)) {
      setFormError("所选 harness 当前不可启动，暂时不能创建智能体。");
      return;
    }
    setCreating(true);
    setNameError(null);
    setFormError(null);
    try {
      const agentId = await createNamedAgent({
        workspaceId,
        principalId,
        name: draft.name,
        harness: draft.harness,
        description: draft.description,
        instructions: draft.instructions,
        model: draft.model,
        thinking: draft.thinking,
        speed: draft.speed,
        avatar: draft.avatar,
        access: draft.access,
        toolAccess: draft.toolAccess,
      });
      const store = browserStore();
      if (store) clearManualDraft(workspaceId, store);
      useSession.getState().setAgent(agentId, principalId);
      navigate(`/agents/${agentId}`);
    } catch (err: unknown) {
      const classified = classifyCreateAgentError(err);
      setNameError(classified.nameError);
      setFormError(classified.formError);
      setCreating(false);
    }
  };

  return (
    <AgentCreateShell
      title="创建智能体"
      onBack={() => navigate("/agents")}
      chips={
        <>
          {selected ? (
            <AgentCreateChip>{runtimeChipLabel(selected, os)}</AgentCreateChip>
          ) : null}
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8">
          <AgentConfigurationPanel
            draft={draft}
            onChange={(next) => {
              setNameError(null);
              setDraft(next);
            }}
            runtimes={runtimes}
            runtimesLoading={catalog.isLoading}
            nameError={nameError}
            os={os}
          />
        </div>
        <CreateAgentFooter
          canCreate={canCreate}
          creating={creating}
          error={formError}
          onCreate={() => void create()}
        />
      </div>
    </AgentCreateShell>
  );
}
