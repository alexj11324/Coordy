import { BarChart3, FileSearch, FolderKanban, ListTodo, Puzzle, UsersRound, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AUTOMATION_STARTERS,
  automationModeLabel,
  formatRelativeTime,
  projectIssueStats,
  scheduleLabel,
  type AutomationStarterId,
} from "../lib/coordy/catalog";
import { PRIORITY_ITEMS } from "../lib/coordy/issues";
import { agentDisplayName, createActionLabel, emptyCreateHint, listableAgents } from "../lib/coordy/labels";
import {
  asAgents,
  asAutomations,
  asPrincipals,
  asProjects,
  asSkills,
  asSquads,
  asTasks,
} from "../lib/coordy/views";
import { AgentAvatar } from "./agent-avatar";
import {
  AutomationCreateDialog,
  ProjectCreateDialog,
  SkillCreateDialog,
  SquadCreateDialog,
} from "./catalog-create";
import {
  CatalogEmpty,
  CatalogListHeader,
  CatalogListRow,
  CatalogPageHeader,
  ProgressRing,
  ProjectStatusBadge,
} from "./catalog-layout";
import { useCatalogComposer, useWorkspaceQuery } from "./pages";

const STARTER_ICONS: Record<AutomationStarterId, LucideIcon> = {
  "daily-digest": BarChart3,
  "backlog-triage": ListTodo,
  "doc-gaps": FileSearch,
};

export function ProjectsPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Projects", workspace_id }));
  const board = useWorkspaceQuery((workspace_id) => ({ type: "Board", workspace_id }));
  const principals = useWorkspaceQuery((workspace_id) => ({ type: "Principals", workspace_id }));
  const items = asProjects(q.data);
  const tasks = asTasks(board.data);
  const people = asPrincipals(principals.data);
  const navigate = useNavigate();
  const { creating, setCreating } = useCatalogComposer("new-project");
  const createLabel = createActionLabel("项目");

  return (
    <section className="flex h-full min-h-0 flex-col">
      <CatalogPageHeader
        icon={FolderKanban}
        title="项目"
        count={items.length}
        actionLabel={createLabel}
        onCreate={() => setCreating(true)}
      />
      {items.length === 0 ? (
        <CatalogEmpty
          icon={FolderKanban}
          title={emptyCreateHint("项目")}
          description="用项目归集事项。创建后可在事项里选择归属。"
          actionLabel="创建第一个项目"
          onCreate={() => setCreating(true)}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((project) => {
              const stats = projectIssueStats(tasks, project.id);
              const lead = people.find((person) => person.id === project.lead_id);
              return (
                <button
                  key={project.id}
                  type="button"
                  className="group flex flex-col rounded-lg border bg-card text-left transition-colors hover:border-primary/40"
                  onClick={() => navigate(`/projects/${project.id}`)}
                >
                  <div className="flex items-center gap-2 p-3 pb-2">
                    <span className="text-lg leading-none">{project.icon?.trim() || "📁"}</span>
                    <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</h2>
                    <ProjectStatusBadge status={project.status} />
                  </div>
                  <div className="mt-auto flex items-center justify-between border-t px-3 py-2">
                    <span className="max-w-[8rem] truncate text-xs text-muted-foreground">
                      {lead?.name ?? "未指定负责人"}
                    </span>
                    <div className="flex items-center gap-2">
                      {project.priority && project.priority !== "none" ? (
                        <span className="text-xs text-muted-foreground">
                          {PRIORITY_ITEMS[project.priority] ?? project.priority}
                        </span>
                      ) : null}
                      <ProgressRing done={stats.done} total={stats.total} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <ProjectCreateDialog open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}

export function AutomationsPage() {
  const autos = useWorkspaceQuery((workspace_id) => ({ type: "Automations", workspace_id }));
  const agents = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const items = asAutomations(autos.data);
  const agentList = listableAgents(asAgents(agents.data));
  const navigate = useNavigate();
  const { creating, setCreating } = useCatalogComposer("new-automation");
  const createLabel = createActionLabel("自动化");
  const [starterId, setStarterId] = useState<AutomationStarterId | null>(null);

  const openCreate = (id: AutomationStarterId | null = null) => {
    setStarterId(id);
    setCreating(true);
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <CatalogPageHeader
        icon={Workflow}
        title="自动化"
        count={items.length}
        actionLabel={createLabel}
        onCreate={() => openCreate(null)}
      />
      {items.length === 0 ? (
        <CatalogEmpty
          icon={Workflow}
          title={emptyCreateHint("自动化")}
          description="按本机间隔触发 runbook。可创建事项并指派智能体执行。"
          actionLabel="从空白开始"
          onCreate={() => openCreate(null)}
        >
          <div className="mt-6 grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
            {AUTOMATION_STARTERS.map((starter) => {
              const Icon = STARTER_ICONS[starter.id];
              return (
                <button
                  key={starter.id}
                  type="button"
                  className="flex items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/40"
                  onClick={() => openCreate(starter.id)}
                >
                  <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{starter.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{starter.summary}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </CatalogEmpty>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <CatalogListHeader>
            <span>名称</span>
            <span>执行智能体</span>
            <span>间隔</span>
            <span>上次运行</span>
          </CatalogListHeader>
          {items.map((item) => {
            const agent = agentList.find((row) => row.id === item.assignee_agent_id);
            return (
              <CatalogListRow key={item.id} onClick={() => navigate(`/automations/${item.id}`)}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{item.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {automationModeLabel(item.create_issue)}
                    {item.run_count ? ` · 已运行 ${item.run_count} 次` : ""}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {agent ? <AgentAvatar agent={agent} className="size-5" /> : null}
                  <span className="truncate">{agent ? agentDisplayName(agent) : "未指派"}</span>
                </span>
                <span className="hidden text-xs text-muted-foreground md:block">{scheduleLabel(item.schedule)}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatRelativeTime(item.last_triggered_at)}
                </span>
              </CatalogListRow>
            );
          })}
        </div>
      )}
      <AutomationCreateDialog
        open={creating}
        starter={AUTOMATION_STARTERS.find((item) => item.id === starterId) ?? null}
        onClose={() => {
          setCreating(false);
          setStarterId(null);
        }}
      />
    </section>
  );
}

export function SkillsPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Skills", workspace_id }));
  const items = asSkills(q.data);
  const navigate = useNavigate();
  const { creating, setCreating } = useCatalogComposer("new-skill");
  const createLabel = createActionLabel("Skill");
  return (
    <section className="flex h-full min-h-0 flex-col">
      <CatalogPageHeader
        icon={Puzzle}
        title="Skills"
        count={items.length}
        actionLabel={createLabel}
        onCreate={() => setCreating(true)}
      />
      {items.length === 0 ? (
        <CatalogEmpty
          icon={Puzzle}
          title={emptyCreateHint("Skill")}
          description="Skill 含名称与正文。绑定到智能体后，下一次运行会注入指令。"
          actionLabel={createLabel}
          onCreate={() => setCreating(true)}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <CatalogListHeader columns="md:grid-cols-[minmax(0,1fr)_minmax(12rem,1.2fr)]">
            <span>名称</span>
            <span>正文</span>
          </CatalogListHeader>
          {items.map((item) => (
            <CatalogListRow
              key={item.id}
              columns="grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(12rem,1.2fr)]"
              onClick={() => navigate(`/skills/${item.id}`)}
            >
              <span className="truncate text-sm font-medium">{item.name}</span>
              <span className="hidden truncate text-xs text-muted-foreground md:block">
                {item.body?.trim() || "尚未填写正文"}
              </span>
            </CatalogListRow>
          ))}
        </div>
      )}
      <SkillCreateDialog open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}

export function SquadsPage() {
  const squads = useWorkspaceQuery((workspace_id) => ({ type: "Squads", workspace_id }));
  const agents = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const items = asSquads(squads.data);
  const agentList = listableAgents(asAgents(agents.data));
  const navigate = useNavigate();
  const { creating, setCreating } = useCatalogComposer("new-squad");
  const createLabel = createActionLabel("小队");
  return (
    <section className="flex h-full min-h-0 flex-col">
      <CatalogPageHeader
        icon={UsersRound}
        title="小队"
        count={items.length}
        actionLabel={createLabel}
        onCreate={() => setCreating(true)}
      />
      {items.length === 0 ? (
        <CatalogEmpty
          icon={UsersRound}
          title={emptyCreateHint("小队")}
          description="指定领队与成员。将事项指派给小队且状态不是待规划时，会对领队启动一次运行。"
          actionLabel={createLabel}
          onCreate={() => setCreating(true)}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <CatalogListHeader>
            <span>名称</span>
            <span>领队</span>
            <span>成员</span>
            <span />
          </CatalogListHeader>
          {items.map((squad) => {
            const leader = agentList.find((agent) => agent.id === squad.leader_agent_id);
            const members = (squad.member_agent_ids ?? [])
              .map((id) => agentList.find((agent) => agent.id === id))
              .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent));
            return (
              <CatalogListRow key={squad.id} onClick={() => navigate(`/squads/${squad.id}`)}>
                <span className="flex min-w-0 items-center gap-2">
                  {leader ? <AgentAvatar agent={leader} className="size-8" /> : null}
                  <span className="truncate text-sm font-medium">{squad.name}</span>
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {leader ? agentDisplayName(leader) : squad.leader_agent_id}
                </span>
                <span className="hidden items-center gap-1 md:flex">
                  {members.slice(0, 4).map((agent) => (
                    <AgentAvatar key={agent.id} agent={agent} className="size-5" />
                  ))}
                  <span className="text-xs text-muted-foreground">{members.length} 名成员</span>
                </span>
                <span />
              </CatalogListRow>
            );
          })}
        </div>
      )}
      <SquadCreateDialog open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}
