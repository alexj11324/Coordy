import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@coordy/ui";
import { FolderKanban, Play, Puzzle, UsersRound, Workflow } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { submit } from "../lib/coordy/client";
import { taskIdentifier } from "../lib/coordy/issues";
import {
  agentDisplayName,
  createActionLabel,
  emptyCreateHint,
  listableAgents,
  taskStatusLabel,
} from "../lib/coordy/labels";
import { outcomeId } from "../lib/coordy/views";
import { useSession } from "../state/session-store";
import { AgentAvatar, NamedAgent } from "./agent-avatar";
import {
  CatalogShell,
  CreateEmpty,
  NamedCreateForm,
  NeedAgentHint,
  useCatalogComposer,
  useCommand,
  useForm,
  useWorkspaceQuery,
} from "./pages";
import {
  asAgents,
  asAutomations,
  asPrincipals,
  asProjects,
  asSkills,
  asSquads,
  asTasks,
} from "../lib/coordy/views";

const PROJECT_STATUS = {
  planned: "规划中",
  active: "进行中",
  paused: "暂停",
  done: "已完成",
} as const;

function AgentChips({
  agents,
  selected,
  onToggle,
}: {
  agents: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (agents.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无智能体。</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {agents.map((agent) => {
        const on = selected.includes(agent.id);
        return (
          <Button
            key={agent.id}
            type="button"
            size="sm"
            variant={on ? "default" : "outline"}
            onClick={() => onToggle(agent.id)}
          >
            {agent.name}
          </Button>
        );
      })}
    </div>
  );
}

export function ProjectsPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Projects", workspace_id }));
  const board = useWorkspaceQuery((workspace_id) => ({ type: "Board", workspace_id }));
  const principals = useWorkspaceQuery((workspace_id) => ({ type: "Principals", workspace_id }));
  const items = asProjects(q.data);
  const tasks = asTasks(board.data);
  const people = asPrincipals(principals.data);
  const name = useForm("");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  const navigate = useNavigate();
  const { creating, setCreating } = useCatalogComposer("new-project");
  const createLabel = createActionLabel("项目");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const childTasks = tasks.filter((task) => task.project_id && selected && task.project_id === selected.id);
  return (
    <CatalogShell
      title="项目"
      description="用项目归集事项。可编辑说明、状态、负责人和日期；事项页可将任务归属到项目。"
      createLabel={createLabel}
      onCreate={() => setCreating(true)}
      creating={creating}
      composer={
        <NamedCreateForm
          placeholder="项目名称"
          value={name.value}
          onChange={name.set}
          onSubmit={() => {
            if (!workspaceId || !name.value.trim()) return;
            command.mutate(
              { type: "CreateProject", workspace_id: workspaceId, name: name.value.trim() },
              {
                onSuccess: (outcome) => {
                  name.set("");
                  setCreating(false);
                  setSelectedId(outcomeId(outcome.ids, "project_id"));
                },
              },
            );
          }}
          onCancel={() => setCreating(false)}
        />
      }
      empty={<CreateEmpty icon={FolderKanban} title={emptyCreateHint("项目")} actionLabel={createLabel} onCreate={() => setCreating(true)} />}
      hasItems={items.length > 0}
    >
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="mb-2 w-full text-left"
              onClick={() => setSelectedId(item.id)}
            >
              <Card size="sm" className={selected?.id === item.id ? "ring-1 ring-border" : ""}>
                <CardHeader>
                  <CardTitle>{item.name}</CardTitle>
                  <CardDescription>{item.status || "无状态"}</CardDescription>
                </CardHeader>
              </Card>
            </button>
          ))}
        </div>
        {selected ? (
          <ProjectEditorInner
            key={selected.id}
            project={selected}
            people={people}
            childTasks={childTasks}
            onOpenTask={(id) => navigate(`/board/${id}`)}
          />
        ) : null}
      </div>
    </CatalogShell>
  );
}

function ProjectEditorInner({
  project,
  people,
  childTasks,
  onOpenTask,
}: {
  project: ReturnType<typeof asProjects>[number];
  people: ReturnType<typeof asPrincipals>;
  childTasks: ReturnType<typeof asTasks>;
  onOpenTask: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState(project.status || "planned");
  const [priority, setPriority] = useState(project.priority || "none");
  const [leadId, setLeadId] = useState(project.lead_id || "none");
  const [startDate, setStartDate] = useState(project.start_date || "");
  const [dueDate, setDueDate] = useState(project.due_date || "");
  const [resource, setResource] = useState(project.resource || "");
  const [notice, setNotice] = useState<string | null>(null);
  const peopleItems = useMemo(
    () => Object.fromEntries([["none", "未指定"], ...people.map((person) => [person.id, person.name])]),
    [people],
  );
  const save = useMutation({
    mutationFn: async () => {
      await submit({
        type: "UpdateProject",
        project_id: project.id,
        name: name.trim() || project.name,
        description,
        status,
        priority,
        lead_id: leadId === "none" ? "" : leadId,
        start_date: startDate,
        due_date: dueDate,
        resource,
      });
    },
    onSuccess: async () => {
      setNotice("已保存。");
      await qc.invalidateQueries();
    },
    onError: (err: unknown) => setNotice(err instanceof Error ? err.message : String(err)),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label>名称</Label>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>说明</Label>
        <Textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>状态</Label>
          <Select value={status} items={PROJECT_STATUS} onValueChange={(value) => value && setStatus(value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROJECT_STATUS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>优先级</Label>
          <Input value={priority} onChange={(event) => setPriority(event.target.value)} placeholder="none / high" />
        </div>
        <div className="space-y-1.5">
          <Label>负责人</Label>
          <Select value={leadId} items={peopleItems} onValueChange={(value) => value && setLeadId(value)}>
            <SelectTrigger>
              <SelectValue placeholder="未指定" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">未指定</SelectItem>
              {people.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>资源 / 目录</Label>
          <Input value={resource} onChange={(event) => setResource(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>开始日期</Label>
          <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>截止日期</Label>
          <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </div>
      </div>
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      <Button type="submit" disabled={save.isPending}>
        保存
      </Button>
      <div className="space-y-2 pt-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">事项</h3>
        {childTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚无归属此项目的事项。创建任务时可选择项目。</p>
        ) : (
          childTasks.map((task) => (
            <button key={task.id} type="button" className="block text-left text-sm" onClick={() => onOpenTask(task.id)}>
              {taskIdentifier(task)} {task.title} · {taskStatusLabel(task.status)}
            </button>
          ))
        )}
      </div>
    </form>
  );
}

export function AutomationsPage() {
  const autos = useWorkspaceQuery((workspace_id) => ({ type: "Automations", workspace_id }));
  const agents = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const items = asAutomations(autos.data);
  const agentList = listableAgents(asAgents(agents.data));
  const name = useForm("");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  const { creating, setCreating } = useCatalogComposer("new-automation");
  const createLabel = createActionLabel("自动化");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  return (
    <CatalogShell
      title="自动化"
      description="填写 runbook、执行智能体与间隔（如 every:30m）。本机 coordyd 按间隔触发；立即运行会走 TriggerAutomation。"
      createLabel={createLabel}
      onCreate={() => setCreating(true)}
      creating={creating}
      composer={
        <NamedCreateForm
          placeholder="自动化名称"
          value={name.value}
          onChange={name.set}
          onSubmit={() => {
            if (!workspaceId || !name.value.trim()) return;
            command.mutate(
              { type: "CreateAutomation", workspace_id: workspaceId, name: name.value.trim(), runbook: "" },
              {
                onSuccess: (outcome) => {
                  name.set("");
                  setCreating(false);
                  setSelectedId(outcomeId(outcome.ids, "automation_id"));
                },
              },
            );
          }}
          onCancel={() => setCreating(false)}
        />
      }
      empty={<CreateEmpty icon={Workflow} title={emptyCreateHint("自动化")} actionLabel={createLabel} onCreate={() => setCreating(true)} />}
      hasItems={items.length > 0}
    >
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div>
          {items.map((item) => (
            <button key={item.id} type="button" className="mb-2 w-full text-left" onClick={() => setSelectedId(item.id)}>
              <Card size="sm" className={selected?.id === item.id ? "ring-1 ring-border" : ""}>
                <CardHeader>
                  <CardTitle>{item.name}</CardTitle>
                  <CardDescription>{item.schedule || "未设置间隔"} · 已运行 {item.run_count ?? 0} 次</CardDescription>
                </CardHeader>
              </Card>
            </button>
          ))}
        </div>
        {selected ? <AutomationEditor key={selected.id} automation={selected} agents={agentList} /> : null}
      </div>
    </CatalogShell>
  );
}

function AutomationEditor({
  automation,
  agents,
}: {
  automation: ReturnType<typeof asAutomations>[number];
  agents: ReturnType<typeof listableAgents>;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(automation.name);
  const [runbook, setRunbook] = useState(automation.runbook ?? "");
  const [schedule, setSchedule] = useState(automation.schedule ?? "");
  const [assignee, setAssignee] = useState(automation.assignee_agent_id || "none");
  const [createIssue, setCreateIssue] = useState(Boolean(automation.create_issue));
  const [notice, setNotice] = useState<string | null>(null);
  const agentItems = useMemo(
    () => Object.fromEntries([["none", "不指派"], ...agents.map((agent) => [agent.id, agentDisplayName(agent)])]),
    [agents],
  );
  const save = useMutation({
    mutationFn: async () => {
      await submit({
        type: "UpdateAutomation",
        automation_id: automation.id,
        name: name.trim() || automation.name,
        runbook,
        schedule,
        assignee_agent_id: assignee === "none" ? "" : assignee,
        create_issue: createIssue,
      });
    },
    onSuccess: async () => {
      setNotice("已保存。");
      await qc.invalidateQueries();
    },
    onError: (err: unknown) => setNotice(err instanceof Error ? err.message : String(err)),
  });
  const run = useMutation({
    mutationFn: async () => {
      await submit({ type: "TriggerAutomation", automation_id: automation.id });
    },
    onSuccess: async () => {
      setNotice("已触发。若勾选创建事项且已指派智能体，将启动一次运行。");
      await qc.invalidateQueries();
    },
    onError: (err: unknown) => setNotice(err instanceof Error ? err.message : String(err)),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label>名称</Label>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Runbook</Label>
        <Textarea rows={6} value={runbook} onChange={(event) => setRunbook(event.target.value)} placeholder="写入执行说明，触发时作为事项正文与提示。" />
      </div>
      <div className="space-y-1.5">
        <Label>间隔</Label>
        <Input value={schedule} onChange={(event) => setSchedule(event.target.value)} placeholder="every:30m / every:1h / every:1d" />
        <p className="text-xs text-muted-foreground">本机守护进程按该间隔调用 TriggerAutomation，不提供公网 Webhook。</p>
      </div>
      <div className="space-y-1.5">
        <Label>执行智能体</Label>
        <Select value={assignee} items={agentItems} onValueChange={(value) => value && setAssignee(value)}>
          <SelectTrigger>
            <SelectValue placeholder="不指派" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">不指派</SelectItem>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                <NamedAgent agent={agent} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>触发时创建事项</span>
        <Switch checked={createIssue} onCheckedChange={setCreateIssue} />
      </label>
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>
          保存
        </Button>
        <Button type="button" variant="secondary" onClick={() => run.mutate()} disabled={run.isPending}>
          <Play data-icon="inline-start" />
          立即运行
        </Button>
      </div>
    </form>
  );
}

export function SkillsPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Skills", workspace_id }));
  const items = asSkills(q.data);
  const name = useForm("");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  const { creating, setCreating } = useCatalogComposer("new-skill");
  const createLabel = createActionLabel("Skill");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  return (
    <CatalogShell
      title="Skills"
      description="Skill 含名称与正文。绑定到智能体后，下一次 StartRun 会把正文注入指令。"
      createLabel={createLabel}
      onCreate={() => setCreating(true)}
      creating={creating}
      composer={
        <NamedCreateForm
          placeholder="Skill 名称"
          value={name.value}
          onChange={name.set}
          onSubmit={() => {
            if (!workspaceId || !name.value.trim()) return;
            command.mutate(
              { type: "CreateSkill", workspace_id: workspaceId, name: name.value.trim(), body: "" },
              {
                onSuccess: (outcome) => {
                  name.set("");
                  setCreating(false);
                  setSelectedId(outcomeId(outcome.ids, "skill_id"));
                },
              },
            );
          }}
          onCancel={() => setCreating(false)}
        />
      }
      empty={<CreateEmpty icon={Puzzle} title={emptyCreateHint("Skill")} actionLabel={createLabel} onCreate={() => setCreating(true)} />}
      hasItems={items.length > 0}
    >
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div>
          {items.map((item) => (
            <button key={item.id} type="button" className="mb-2 w-full text-left" onClick={() => setSelectedId(item.id)}>
              <Card size="sm" className={selected?.id === item.id ? "ring-1 ring-border" : ""}>
                <CardHeader>
                  <CardTitle>{item.name}</CardTitle>
                </CardHeader>
              </Card>
            </button>
          ))}
        </div>
        {selected ? <SkillEditor key={selected.id} skill={selected} /> : null}
      </div>
    </CatalogShell>
  );
}

function SkillEditor({ skill }: { skill: ReturnType<typeof asSkills>[number] }) {
  const qc = useQueryClient();
  const [name, setName] = useState(skill.name);
  const [body, setBody] = useState(skill.body ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      await submit({ type: "UpdateSkill", skill_id: skill.id, name: name.trim() || skill.name, body });
    },
    onSuccess: async () => {
      setNotice("已保存。已绑定该 Skill 的智能体将在下一次运行时读到新正文。");
      await qc.invalidateQueries();
    },
    onError: (err: unknown) => setNotice(err instanceof Error ? err.message : String(err)),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label>名称</Label>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>正文</Label>
        <Textarea rows={12} value={body} onChange={(event) => setBody(event.target.value)} placeholder="写入技能说明，将注入智能体指令。" />
      </div>
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      <Button type="submit" disabled={save.isPending}>
        保存
      </Button>
    </form>
  );
}

export function SquadsPage() {
  const squads = useWorkspaceQuery((workspace_id) => ({ type: "Squads", workspace_id }));
  const agents = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const items = asSquads(squads.data);
  const agentList = listableAgents(asAgents(agents.data));
  const name = useForm("");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  const { creating, setCreating } = useCatalogComposer("new-squad");
  const createLabel = createActionLabel("小队");
  const defaultLeader = agentList[0]?.id ?? "";
  const [leaderId, setLeaderId] = useState("");
  const selectedLeader = leaderId || defaultLeader;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const agentItems = useMemo(
    () => Object.fromEntries(agentList.map((agent) => [agent.id, agentDisplayName(agent)])),
    [agentList],
  );
  return (
    <CatalogShell
      title="小队"
      description="指定领队与成员。将事项指派给小队且状态不是待规划时，会对领队启动一次运行。"
      createLabel={createLabel}
      onCreate={() => setCreating(true)}
      creating={creating}
      composer={
        agentList.length === 0 ? (
          <NeedAgentHint onCancel={() => setCreating(false)} />
        ) : (
          <NamedCreateForm
            placeholder="小队名称"
            value={name.value}
            onChange={name.set}
            extra={
              <Select value={selectedLeader} items={agentItems} onValueChange={(value) => value && setLeaderId(value)}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {agentList.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      <NamedAgent agent={agent} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
            onSubmit={() => {
              if (!workspaceId || !name.value.trim() || !selectedLeader) return;
              command.mutate(
                {
                  type: "CreateSquad",
                  workspace_id: workspaceId,
                  name: name.value.trim(),
                  leader_agent_id: selectedLeader,
                },
                {
                  onSuccess: (outcome) => {
                    name.set("");
                    setCreating(false);
                    setSelectedId(outcomeId(outcome.ids, "squad_id"));
                  },
                },
              );
            }}
            onCancel={() => setCreating(false)}
            disabled={!selectedLeader}
          />
        )
      }
      empty={<CreateEmpty icon={UsersRound} title={emptyCreateHint("小队")} actionLabel={createLabel} onCreate={() => setCreating(true)} />}
      hasItems={items.length > 0}
    >
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div>
          {items.map((squad) => {
            const leader = agentList.find((agent) => agent.id === squad.leader_agent_id);
            return (
              <button key={squad.id} type="button" className="mb-2 w-full text-left" onClick={() => setSelectedId(squad.id)}>
                <Card size="sm" className={selected?.id === squad.id ? "ring-1 ring-border" : ""}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {leader ? <AgentAvatar agent={leader} className="size-6" /> : null}
                      {squad.name}
                    </CardTitle>
                    <CardDescription>
                      领队 {leader ? agentDisplayName(leader) : squad.leader_agent_id}
                      {squad.member_agent_ids?.length ? ` · ${squad.member_agent_ids.length} 名成员` : ""}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </button>
            );
          })}
        </div>
        {selected ? <SquadEditor key={selected.id} squad={selected} agents={agentList} /> : null}
      </div>
    </CatalogShell>
  );
}

function SquadEditor({
  squad,
  agents,
}: {
  squad: ReturnType<typeof asSquads>[number];
  agents: ReturnType<typeof listableAgents>;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(squad.name);
  const [leaderId, setLeaderId] = useState(squad.leader_agent_id);
  const [memberIds, setMemberIds] = useState<string[]>(squad.member_agent_ids ?? []);
  const [notice, setNotice] = useState<string | null>(null);
  const agentItems = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent.id, agentDisplayName(agent)])),
    [agents],
  );
  const save = useMutation({
    mutationFn: async () => {
      await submit({
        type: "UpdateSquad",
        squad_id: squad.id,
        name: name.trim() || squad.name,
        leader_agent_id: leaderId,
      });
      await submit({ type: "SetSquadMembers", squad_id: squad.id, agent_ids: memberIds });
    },
    onSuccess: async () => {
      setNotice("已保存。指派事项给该小队后，将向领队启动运行。");
      await qc.invalidateQueries();
    },
    onError: (err: unknown) => setNotice(err instanceof Error ? err.message : String(err)),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label>名称</Label>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>领队</Label>
        <Select value={leaderId} items={agentItems} onValueChange={(value) => value && setLeaderId(value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                <NamedAgent agent={agent} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>成员</Label>
        <AgentChips
          agents={agents}
          selected={memberIds}
          onToggle={(id) =>
            setMemberIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
          }
        />
      </div>
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      <Button type="submit" disabled={save.isPending}>
        保存
      </Button>
    </form>
  );
}
