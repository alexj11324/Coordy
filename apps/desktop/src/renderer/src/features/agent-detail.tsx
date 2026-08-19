import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Input,
  Label,
  PageHeader,
  Textarea,
} from "@coordy/ui";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import { formatAgentAvatar } from "../lib/coordy/agent-avatar";
import { agentDisplayName, canonicalHarnessId, listableAgents, pickerRuntimes } from "../lib/coordy/labels";
import { asAgents } from "../lib/coordy/views";
import { useSession } from "../state/session-store";
import { ModelDropdown } from "./create-agent/agent-create-form";
import { RuntimePicker } from "./runtime-picker";
import { AgentAvatar, AgentAvatarField } from "./agent-avatar";
import { useTabTitle } from "../shell/use-tab-title";

export function AgentDetailPage() {
  const { agentId } = useParams();
  const workspaceId = useSession((s) => s.workspaceId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const agents = useQuery({
    queryKey: ["view", { type: "Agents", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Agents", workspace_id: workspaceId! }),
  });
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });
  const agent = listableAgents(asAgents(agents.data)).find((item) => item.id === agentId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [harness, setHarness] = useState("");
  const [model, setModel] = useState("");
  const [avatar, setAvatar] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const runtimes = useMemo(
    () => pickerRuntimes(catalog.data, harness || agent?.harness),
    [catalog.data, harness, agent?.harness],
  );
  const displayName = agent ? agentDisplayName(agent, catalog.data) : undefined;
  useTabTitle(displayName);

  useEffect(() => {
    if (!agent) return;
    setName(agent.name);
    setDescription(agent.description ?? "");
    setInstructions(agent.instructions ?? "");
    setHarness(canonicalHarnessId(agent.harness));
    setModel(agent.model ?? "");
    setAvatar(agent.avatar ?? "");
  }, [agent]);

  const save = useMutation({
    mutationFn: async () => {
      if (!agent) throw new Error("未找到该智能体");
      await submit({
        type: "UpdateAgent",
        agent_id: agent.id,
        name: name.trim(),
        description,
        instructions,
        harness: harness || agent.harness,
        model,
        avatar: avatar.trim() || formatAgentAvatar(agent.id),
      });
    },
    onSuccess: async () => {
      setNotice("已保存。后续派发将使用新配置；当前运行不受影响。");
      await qc.invalidateQueries();
    },
    onError: (err: unknown) => setNotice(err instanceof Error ? err.message : String(err)),
  });

  if (!agentId) return null;
  if (agents.isFetched && !agent) {
    return (
      <section>
        <Link to="/agents" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          智能体
        </Link>
        <PageHeader title="未找到该智能体" description="该智能体可能已归档，或尚未创建。" />
      </section>
    );
  }
  if (!agent) return null;

  return (
    <section className="space-y-4">
      <div>
        <Link to="/agents" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          智能体
        </Link>
        <div className="flex items-start gap-3">
          <AgentAvatar agent={{ ...agent, avatar }} className="mt-1 size-10" />
          <PageHeader
            title={displayName ?? agentDisplayName(agent, catalog.data)}
            description="名称、描述与 harness 构成身份与执行环境。指令在每次启动运行时注入。"
          />
        </div>
      </div>
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      <form
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="agent-edit-avatar">头像</Label>
          <AgentAvatarField id="agent-edit-avatar" value={avatar} fallbackSeed={agent.id} onChange={setAvatar} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-agent-name">名称</Label>
          <Input id="edit-agent-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-agent-description">描述</Label>
          <Input
            id="edit-agent-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="仅显示在列表中，不进入执行提示"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-agent-instructions">指令</Label>
          <Textarea
            id="edit-agent-instructions"
            rows={8}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Harness</Label>
          <RuntimePicker
            items={runtimes}
            value={harness || agent.harness}
            onChange={(id) => {
              setHarness(id);
              setModel("");
            }}
          />
        </div>
        <div className="space-y-1.5">
          <ModelDropdown
            harness={harness || agent.harness}
            value={model}
            disabled={!(harness || agent.harness)}
            onChange={setModel}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending || !name.trim()}>
            保存
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => useSession.getState().setAgent(agent.id, agent.principal_id)}
          >
            切换
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              void submit({ type: "ArchiveAgent", agent_id: agent.id }).then(() => navigate("/agents"));
            }}
          >
            归档
          </Button>
        </div>
      </form>
    </section>
  );
}
