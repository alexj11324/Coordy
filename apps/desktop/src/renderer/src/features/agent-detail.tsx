import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@coordy/ui";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import { formatAgentAvatar } from "../lib/coordy/agent-avatar";
import { agentDisplayName, canonicalHarnessId, listableAgents, pickerRuntimes } from "../lib/coordy/labels";
import { CODEX_FAST_SPEED, normalizeCodexFast, sanitizeThinking } from "../lib/coordy/agent-draft";
import { asAgents, asPrincipals, asSkills, outcomeId } from "../lib/coordy/views";
import { useSession } from "../state/session-store";
import { RuntimeCapabilityFields } from "./create-agent/agent-create-form";
import { RuntimePicker } from "./runtime-picker";
import { AgentAvatar, AgentAvatarField } from "./agent-avatar";
import { useTabTitle } from "../shell/use-tab-title";

const ACCESS_ITEMS = {
  owner: "仅自己",
  workspace: "整个工作区",
  members: "指定成员",
} as const;

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
  const skills = useQuery({
    queryKey: ["view", { type: "Skills", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Skills", workspace_id: workspaceId! }),
  });
  const principals = useQuery({
    queryKey: ["view", { type: "Principals", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Principals", workspace_id: workspaceId! }),
  });
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });
  const agent = listableAgents(asAgents(agents.data)).find((item) => item.id === agentId);
  const skillList = asSkills(skills.data);
  const people = asPrincipals(principals.data);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [harness, setHarness] = useState("");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");
  const [speed, setSpeed] = useState("");
  const [avatar, setAvatar] = useState("");
  const [access, setAccess] = useState<string>("owner");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [concurrency, setConcurrency] = useState("6");
  const [cliArgs, setCliArgs] = useState("");
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
    setThinking(agent.thinking ?? "");
    setSpeed(normalizeCodexFast(agent.speed ?? ""));
    setAvatar(agent.avatar ?? "");
    setAccess(agent.access || "owner");
    setMemberIds(agent.access_member_ids ?? []);
    setSkillIds(agent.skill_ids ?? []);
    setConcurrency(String(agent.concurrency_limit && agent.concurrency_limit > 0 ? agent.concurrency_limit : 6));
    setCliArgs(agent.cli_args ?? "");
  }, [agent]);

  const save = useMutation({
    mutationFn: async () => {
      if (!agent) throw new Error("未找到该智能体");
      const limit = Number.parseInt(concurrency, 10);
      await submit({
        type: "UpdateAgent",
        agent_id: agent.id,
        name: name.trim(),
        description,
        instructions,
        harness: harness || agent.harness,
        model,
        thinking,
        speed,
        avatar: avatar.trim() || formatAgentAvatar(agent.id),
        access,
        access_member_ids: access === "members" ? memberIds : [],
        concurrency_limit: Number.isFinite(limit) && limit > 0 ? limit : 6,
        cli_args: cliArgs,
      });
      await submit({ type: "SetAgentSkills", agent_id: agent.id, skill_ids: skillIds });
    },
    onSuccess: async () => {
      setNotice("已保存。后续派发将使用新配置；当前运行不受影响。绑定的 Skill 会在下一次 StartRun 注入。");
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
            description="名称、描述与 harness 构成身份与执行环境。指令与已绑定 Skill 在每次启动运行时注入。"
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
              setThinking("");
              setSpeed("");
            }}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <RuntimeCapabilityFields
            harness={harness || agent.harness}
            model={model}
            thinking={thinking}
            speed={speed}
            disabled={!(harness || agent.harness)}
            onModelChange={(next) => {
              setModel(next);
              setThinking((current) => sanitizeThinking(harness || agent.harness, next, current));
            }}
            onThinkingChange={setThinking}
            onFastChange={(on) => setSpeed(on ? CODEX_FAST_SPEED : "")}
          />
        </div>
        <div className="space-y-1.5">
          <Label>访问权限</Label>
          <Select value={access} items={ACCESS_ITEMS} onValueChange={(value) => value && setAccess(value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ACCESS_ITEMS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {access === "members" ? (
          <div className="space-y-1.5">
            <Label>可运行的成员</Label>
            <ChipToggle
              items={people.map((person) => ({ id: person.id, name: person.name }))}
              selected={memberIds}
              onToggle={(id) =>
                setMemberIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
              }
              empty="暂无成员。"
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label>Skills</Label>
          <ChipToggle
            items={skillList.map((skill) => ({ id: skill.id, name: skill.name }))}
            selected={skillIds}
            onToggle={(id) =>
              setSkillIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
            }
            empty="暂无 Skill。先在 Skills 页创建正文，再绑定到此智能体。"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-agent-concurrency">并发上限</Label>
            <Input
              id="edit-agent-concurrency"
              type="number"
              min={1}
              value={concurrency}
              onChange={(event) => setConcurrency(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">该智能体处于 running 的数量达到上限时，StartRun 会拒绝。</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-agent-cli">CLI 参数</Label>
            <Input
              id="edit-agent-cli"
              value={cliArgs}
              onChange={(event) => setCliArgs(event.target.value)}
              placeholder="按空白切开，追加到原生启动参数"
            />
            <p className="text-xs text-muted-foreground">ACP 会话会忽略此项。</p>
          </div>
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
            variant="secondary"
            onClick={() => {
              void submit({ type: "DuplicateAgent", agent_id: agent.id }).then((outcome) => {
                const id = outcomeId(outcome.ids, "agent_id");
                if (id) navigate(`/agents/${id}`);
              });
            }}
          >
            复制
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

function ChipToggle({
  items,
  selected,
  onToggle,
  empty,
}: {
  items: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const on = selected.includes(item.id);
        return (
          <Button key={item.id} type="button" size="sm" variant={on ? "default" : "outline"} onClick={() => onToggle(item.id)}>
            {item.name}
          </Button>
        );
      })}
    </div>
  );
}
