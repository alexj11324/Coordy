import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
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
import { ArrowLeft, FolderKanban, Play, Puzzle, UsersRound, Workflow } from "lucide-react";
import { DatePickerField } from "./date-picker-field";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { submit } from "../lib/coordy/client";
import {
  PROJECT_ICON_PRESETS,
  PROJECT_STATUS_ITEMS,
  projectIssueStats,
  projectStatusDotClass,
  projectStatusLabel,
  scheduleLabel,
  scheduleSelectItems,
} from "../lib/coordy/catalog";
import { PRIORITY_ITEMS, priorityTone, taskIdentifier } from "../lib/coordy/issues";
import { agentDisplayName, listableAgents, taskStatusLabel } from "../lib/coordy/labels";
import {
  asAgents,
  asAutomations,
  asPrincipals,
  asProjects,
  asSkills,
  asSquads,
  asTasks,
} from "../lib/coordy/views";
import { useTabTitle } from "../shell/use-tab-title";
import { AgentAvatar, NamedAgent } from "./agent-avatar";
import { CatalogNotFound, catalogPillTrigger, ProgressRing, ProjectStatusBadge } from "./catalog-layout";
import { useWorkspaceQuery } from "./pages";

function DetailChrome({
  backTo,
  backLabel,
  icon,
  title,
  badge,
  actions,
  children,
}: {
  backTo: string;
  backLabel: string;
  icon: string | null;
  title: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {backLabel}
        </Link>
        {icon ? <span className="text-lg leading-none">{icon}</span> : null}
        <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
        {badge}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">{children}</div>
    </section>
  );
}

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Projects", workspace_id }));
  const board = useWorkspaceQuery((workspace_id) => ({ type: "Board", workspace_id }));
  const principals = useWorkspaceQuery((workspace_id) => ({ type: "Principals", workspace_id }));
  const project = asProjects(q.data).find((item) => item.id === projectId);
  const people = asPrincipals(principals.data);
  const childTasks = asTasks(board.data).filter((task) => task.project_id === projectId);
  useTabTitle(project?.name);

  if (q.isFetched && !project) {
    return (
      <CatalogNotFound
        icon={FolderKanban}
        backTo="/projects"
        backLabel="项目"
        title="未找到该项目"
        description="该项目可能已被删除。"
      />
    );
  }
  if (!project) return null;

  return (
    <ProjectEditor
      key={project.id}
      project={project}
      people={people}
      childTasks={childTasks}
      onOpenTask={(id) => navigate(`/board/${id}`)}
    />
  );
}

function ProjectEditor({
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
  const [icon, setIcon] = useState(project.icon?.trim() || "📁");
  const [status, setStatus] = useState(project.status || "planned");
  const [priority, setPriority] = useState(project.priority || "none");
  const [leadId, setLeadId] = useState(project.lead_id || "none");
  const [startDate, setStartDate] = useState(project.start_date || "");
  const [dueDate, setDueDate] = useState(project.due_date || "");
  const [resource, setResource] = useState(project.resource || "");
  const [notice, setNotice] = useState<string | null>(null);
  const stats = projectIssueStats(childTasks, project.id);
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
        icon,
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
    <DetailChrome
      backTo="/projects"
      backLabel="项目"
      icon={icon}
      title={name || project.name}
      badge={<ProjectStatusBadge status={status} />}
      actions={
        <Button type="submit" size="sm" form="project-edit" disabled={save.isPending}>
          保存
        </Button>
      }
    >
      <form
        id="project-edit"
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="flex flex-wrap gap-1.5">
          {PROJECT_ICON_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`flex size-8 items-center justify-center rounded-md text-lg hover:bg-muted ${
                icon === preset ? "ring-1 ring-border" : ""
              }`}
              onClick={() => setIcon(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
        <Input
          value={name}
          className="h-10 border-0 px-0 text-lg font-medium shadow-none focus-visible:ring-0"
          onChange={(event) => setName(event.target.value)}
        />
        <Textarea
          rows={4}
          value={description}
          placeholder="添加说明..."
          className="border-0 px-0 shadow-none focus-visible:ring-0"
          onChange={(event) => setDescription(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <Select value={status} items={PROJECT_STATUS_ITEMS} onValueChange={(value) => value && setStatus(value)}>
            <SelectTrigger size="sm" className={catalogPillTrigger}>
              <span className={`size-1.5 rounded-full ${projectStatusDotClass(status)}`} />
              <SelectValue>{projectStatusLabel(status)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROJECT_STATUS_ITEMS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priority} items={PRIORITY_ITEMS} onValueChange={(value) => value && setPriority(value)}>
            <SelectTrigger size="sm" className={catalogPillTrigger}>
              <span className={priorityTone(priority)}>—</span>
              <SelectValue>{priority === "none" ? "无优先级" : PRIORITY_ITEMS[priority]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PRIORITY_ITEMS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={leadId} items={peopleItems} onValueChange={(value) => value && setLeadId(value)}>
            <SelectTrigger size="sm" className={catalogPillTrigger}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">未指定负责人</SelectItem>
              {people.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DatePickerField
            value={startDate}
            placeholder="开始日期"
            aria-label="开始日期"
            className="h-7 w-36 rounded-md border border-border px-2 text-xs"
            onChange={setStartDate}
          />
          <DatePickerField
            value={dueDate}
            placeholder="截止日期"
            aria-label="截止日期"
            className="h-7 w-36 rounded-md border border-border px-2 text-xs"
            onChange={setDueDate}
          />
        </div>
        <div className="space-y-1.5">
          <Label>资源 / 目录</Label>
          <Input value={resource} onChange={(event) => setResource(event.target.value)} />
        </div>
        {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">事项</h3>
            <ProgressRing done={stats.done} total={stats.total} />
          </div>
          {childTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚无归属此项目的事项。创建任务时可选择项目。</p>
          ) : (
            childTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/40"
                onClick={() => onOpenTask(task.id)}
              >
                <span>
                  {taskIdentifier(task)} {task.title}
                </span>
                <span className="text-xs text-muted-foreground">{taskStatusLabel(task.status)}</span>
              </button>
            ))
          )}
        </div>
      </form>
    </DetailChrome>
  );
}

export function AutomationDetailPage() {
  const { automationId } = useParams();
  const autos = useWorkspaceQuery((workspace_id) => ({ type: "Automations", workspace_id }));
  const agents = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const automation = asAutomations(autos.data).find((item) => item.id === automationId);
  const agentList = listableAgents(asAgents(agents.data));
  useTabTitle(automation?.name);

  if (autos.isFetched && !automation) {
    return (
      <CatalogNotFound
        icon={Workflow}
        backTo="/automations"
        backLabel="自动化"
        title="未找到该自动化"
        description="该自动化可能已被删除。"
      />
    );
  }
  if (!automation) return null;
  return <AutomationEditor key={automation.id} automation={automation} agents={agentList} />;
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
  const [schedule, setSchedule] = useState(automation.schedule?.trim() ? automation.schedule : "none");
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
        schedule: schedule === "none" ? "" : schedule,
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
    <DetailChrome
      backTo="/automations"
      backLabel="自动化"
      icon={null}
      title={name || automation.name}
      badge={
        <span className="text-xs text-muted-foreground">
          {scheduleLabel(schedule === "none" ? "" : schedule)}
        </span>
      }
      actions={
        <>
          <Button type="button" size="sm" variant="secondary" onClick={() => run.mutate()} disabled={run.isPending}>
            <Play data-icon="inline-start" />
            立即运行
          </Button>
          <Button type="submit" size="sm" form="automation-edit" disabled={save.isPending}>
            保存
          </Button>
        </>
      }
    >
      <form
        id="automation-edit"
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Input
          value={name}
          className="h-10 border-0 px-0 text-lg font-medium shadow-none focus-visible:ring-0"
          onChange={(event) => setName(event.target.value)}
        />
        <Textarea
          rows={8}
          value={runbook}
          placeholder="写入执行说明，触发时作为事项正文与提示。"
          className="border-0 px-0 shadow-none focus-visible:ring-0"
          onChange={(event) => setRunbook(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <Select value={schedule} items={scheduleSelectItems(schedule)} onValueChange={(value) => value && setSchedule(value)}>
            <SelectTrigger size="sm" className={catalogPillTrigger}>
              <SelectValue>{scheduleLabel(schedule === "none" ? "" : schedule)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(scheduleSelectItems(schedule)).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={assignee} items={agentItems} onValueChange={(value) => value && setAssignee(value)}>
            <SelectTrigger size="sm" className={catalogPillTrigger}>
              <SelectValue />
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
          <label className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs">
            <Switch size="sm" checked={createIssue} onCheckedChange={setCreateIssue} />
            创建事项
          </label>
        </div>
        {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      </form>
    </DetailChrome>
  );
}

export function SkillDetailPage() {
  const { skillId } = useParams();
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Skills", workspace_id }));
  const skill = asSkills(q.data).find((item) => item.id === skillId);
  useTabTitle(skill?.name);
  if (q.isFetched && !skill) {
    return (
      <CatalogNotFound
        icon={Puzzle}
        backTo="/skills"
        backLabel="Skills"
        title="未找到该 Skill"
        description="该 Skill 可能已被删除。"
      />
    );
  }
  if (!skill) return null;
  return <SkillEditor key={skill.id} skill={skill} />;
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
    <DetailChrome
      backTo="/skills"
      backLabel="Skills"
      icon={null}
      title={name || skill.name}
      actions={
        <Button type="submit" size="sm" form="skill-edit" disabled={save.isPending}>
          保存
        </Button>
      }
    >
      <form
        id="skill-edit"
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Input
          value={name}
          className="h-10 border-0 px-0 text-lg font-medium shadow-none focus-visible:ring-0"
          onChange={(event) => setName(event.target.value)}
        />
        <Textarea
          rows={16}
          value={body}
          placeholder="写入技能说明，将注入智能体指令。"
          className="border-0 px-0 font-mono text-sm shadow-none focus-visible:ring-0"
          onChange={(event) => setBody(event.target.value)}
        />
        {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      </form>
    </DetailChrome>
  );
}

export function SquadDetailPage() {
  const { squadId } = useParams();
  const squads = useWorkspaceQuery((workspace_id) => ({ type: "Squads", workspace_id }));
  const agents = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const squad = asSquads(squads.data).find((item) => item.id === squadId);
  const agentList = listableAgents(asAgents(agents.data));
  useTabTitle(squad?.name);
  if (squads.isFetched && !squad) {
    return (
      <CatalogNotFound
        icon={UsersRound}
        backTo="/squads"
        backLabel="小队"
        title="未找到该小队"
        description="该小队可能已被删除。"
      />
    );
  }
  if (!squad) return null;
  return <SquadEditor key={squad.id} squad={squad} agents={agentList} />;
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
  const leader = agents.find((agent) => agent.id === leaderId);

  return (
    <DetailChrome
      backTo="/squads"
      backLabel="小队"
      icon={null}
      title={name || squad.name}
      badge={leader ? <AgentAvatar agent={leader} className="size-6" /> : null}
      actions={
        <Button type="submit" size="sm" form="squad-edit" disabled={save.isPending}>
          保存
        </Button>
      }
    >
      <form
        id="squad-edit"
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Input
          value={name}
          className="h-10 border-0 px-0 text-lg font-medium shadow-none focus-visible:ring-0"
          onChange={(event) => setName(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <Select value={leaderId} items={agentItems} onValueChange={(value) => value && setLeaderId(value)}>
            <SelectTrigger size="sm" className={catalogPillTrigger}>
              {leader ? <AgentAvatar agent={leader} className="size-3.5" /> : null}
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
          <div className="flex flex-wrap gap-1.5">
            {agents.map((agent) => {
              const on = memberIds.includes(agent.id);
              return (
                <Button
                  key={agent.id}
                  type="button"
                  size="sm"
                  variant={on ? "default" : "outline"}
                  onClick={() =>
                    setMemberIds((current) =>
                      current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id],
                    )
                  }
                >
                  <AgentAvatar agent={agent} className="size-3.5" />
                  {agentDisplayName(agent)}
                </Button>
              );
            })}
          </div>
        </div>
        {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      </form>
    </DetailChrome>
  );
}
