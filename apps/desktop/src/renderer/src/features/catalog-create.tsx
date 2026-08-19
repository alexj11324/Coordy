import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@coordy/ui";
import { Clock, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import {
  PROJECT_ICON_PRESETS,
  PROJECT_STATUS_ITEMS,
  projectStatusDotClass,
  projectStatusLabel,
  scheduleLabel,
  scheduleSelectItems,
  type AutomationStarter,
} from "../lib/coordy/catalog";
import { PRIORITY_ITEMS, priorityTone } from "../lib/coordy/issues";
import { agentDisplayName, createActionLabel, listableAgents } from "../lib/coordy/labels";
import { asAgents, asPrincipals, outcomeId } from "../lib/coordy/views";
import { useSession } from "../state/session-store";
import { AgentAvatar, NamedAgent } from "./agent-avatar";
import { CatalogComposer, catalogPillTrigger } from "./catalog-layout";
import { NeedAgentHint } from "./pages";

export function ProjectCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const workspaceId = useSession((s) => s.workspaceId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const principals = useQuery({
    queryKey: ["view", { type: "Principals", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId) && open,
    queryFn: () => view({ type: "Principals", workspace_id: workspaceId! }),
  });
  const people = asPrincipals(principals.data);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("📁");
  const [status, setStatus] = useState("planned");
  const [priority, setPriority] = useState("none");
  const [leadId, setLeadId] = useState("none");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setIcon("📁");
    setStatus("planned");
    setPriority("none");
    setLeadId("none");
    setStartDate("");
    setDueDate("");
    setError(null);
    const timer = window.setTimeout(() => document.getElementById("project-create-title")?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  const peopleItems = useMemo(
    () => Object.fromEntries([["none", "未指定"], ...people.map((person) => [person.id, person.name])]),
    [people],
  );

  const create = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("工作区尚未就绪。");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("请填写项目名称");
      const created = await submit({
        type: "CreateProject",
        workspace_id: workspaceId,
        name: trimmed,
        icon,
        description: description.trim(),
      });
      const projectId = outcomeId(created.ids, "project_id");
      if (!projectId) throw new Error("未能取得项目编号");
      const needsUpdate =
        status !== "planned" ||
        priority !== "none" ||
        leadId !== "none" ||
        Boolean(startDate) ||
        Boolean(dueDate);
      if (needsUpdate) {
        await submit({
          type: "UpdateProject",
          project_id: projectId,
          status,
          priority,
          lead_id: leadId === "none" ? "" : leadId,
          start_date: startDate,
          due_date: dueDate,
        });
      }
      return projectId;
    },
    onSuccess: async (projectId) => {
      await qc.invalidateQueries();
      onClose();
      navigate(`/projects/${projectId}`);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  const selectedLead = people.find((person) => person.id === leadId);

  return (
    <CatalogComposer
      open={open}
      title="新建项目"
      submitLabel={createActionLabel("项目")}
      submitDisabled={create.isPending || !name.trim()}
      onClose={onClose}
      onSubmit={() => create.mutate()}
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
        id="project-create-title"
        value={name}
        placeholder="项目名称"
        className="h-10 border-0 px-0 text-lg font-medium shadow-none focus-visible:ring-0"
        onChange={(event) => setName(event.target.value)}
      />
      <Textarea
        value={description}
        placeholder="添加说明..."
        className="min-h-24 border-0 px-0 shadow-none focus-visible:ring-0"
        onChange={(event) => setDescription(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Select value={status} items={PROJECT_STATUS_ITEMS} onValueChange={(value) => value && setStatus(value)}>
          <SelectTrigger size="sm" className={catalogPillTrigger}>
            <span className={`size-1.5 rounded-full ${projectStatusDotClass(status)}`} />
            <SelectValue>{projectStatusLabel(status)}</SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-36">
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
          <SelectContent className="min-w-32">
            {Object.entries(PRIORITY_ITEMS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={leadId} items={peopleItems} onValueChange={(value) => value && setLeadId(value)}>
          <SelectTrigger size="sm" className={catalogPillTrigger}>
            <UserRound className="size-3.5" />
            <SelectValue>{selectedLead?.name ?? "负责人"}</SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-44">
            <SelectItem value="none">未指定</SelectItem>
            {people.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                {person.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={dueDate}
          aria-label="截止日期"
          className="h-7 w-36"
          onChange={(event) => setDueDate(event.target.value)}
        />
        <Input
          type="date"
          value={startDate}
          aria-label="开始日期"
          className="h-7 w-36"
          onChange={(event) => setStartDate(event.target.value)}
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </CatalogComposer>
  );
}

export function AutomationCreateDialog({
  open,
  starter,
  onClose,
}: {
  open: boolean;
  starter: AutomationStarter | null;
  onClose: () => void;
}) {
  const workspaceId = useSession((s) => s.workspaceId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const agents = useQuery({
    queryKey: ["view", { type: "Agents", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId) && open,
    queryFn: () => view({ type: "Agents", workspace_id: workspaceId! }),
  });
  const agentList = listableAgents(asAgents(agents.data));
  const [name, setName] = useState("");
  const [runbook, setRunbook] = useState("");
  const [schedule, setSchedule] = useState("none");
  const [assignee, setAssignee] = useState("none");
  const [createIssue, setCreateIssue] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(starter?.title ?? "");
    setRunbook(starter?.runbook ?? "");
    setSchedule(starter?.schedule || "none");
    setAssignee("none");
    setCreateIssue(starter?.createIssue ?? true);
    setError(null);
    const timer = window.setTimeout(() => document.getElementById("automation-create-title")?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open, starter]);

  const agentItems = useMemo(
    () => Object.fromEntries([["none", "不指派"], ...agentList.map((agent) => [agent.id, agentDisplayName(agent)])]),
    [agentList],
  );
  const selectedAgent = agentList.find((agent) => agent.id === assignee);

  const create = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("工作区尚未就绪。");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("请填写自动化名称");
      const created = await submit({
        type: "CreateAutomation",
        workspace_id: workspaceId,
        name: trimmed,
        runbook: runbook.trim(),
        schedule: schedule === "none" ? "" : schedule,
        assignee_agent_id: assignee === "none" ? null : assignee,
        create_issue: createIssue,
      });
      const id = outcomeId(created.ids, "automation_id");
      if (!id) throw new Error("未能取得自动化编号");
      return id;
    },
    onSuccess: async (id) => {
      await qc.invalidateQueries();
      onClose();
      navigate(`/automations/${id}`);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  return (
    <CatalogComposer
      open={open}
      title="新建自动化"
      submitLabel={createActionLabel("自动化")}
      submitDisabled={create.isPending || !name.trim()}
      onClose={onClose}
      onSubmit={() => create.mutate()}
    >
      <Input
        id="automation-create-title"
        value={name}
        placeholder="自动化名称"
        className="h-10 border-0 px-0 text-lg font-medium shadow-none focus-visible:ring-0"
        onChange={(event) => setName(event.target.value)}
      />
      <Textarea
        value={runbook}
        placeholder="写入执行说明。勾选创建事项后，触发时会作为事项正文。"
        className="min-h-32 border-0 px-0 shadow-none focus-visible:ring-0"
        onChange={(event) => setRunbook(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Select value={schedule} items={scheduleSelectItems(schedule)} onValueChange={(value) => value && setSchedule(value)}>
          <SelectTrigger size="sm" className={catalogPillTrigger}>
            <Clock className="size-3.5" />
            <SelectValue>{scheduleLabel(schedule === "none" ? "" : schedule)}</SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-40">
            {Object.entries(scheduleSelectItems(schedule)).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={assignee} items={agentItems} onValueChange={(value) => value && setAssignee(value)}>
          <SelectTrigger size="sm" className={catalogPillTrigger}>
            {selectedAgent ? <AgentAvatar agent={selectedAgent} className="size-3.5" /> : <UserRound className="size-3.5" />}
            <SelectValue>{selectedAgent ? agentDisplayName(selectedAgent) : "执行智能体"}</SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-48">
            <SelectItem value="none">不指派</SelectItem>
            {agentList.map((agent) => (
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
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </CatalogComposer>
  );
}

export function SkillCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const workspaceId = useSession((s) => s.workspaceId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setBody("");
    setError(null);
    const timer = window.setTimeout(() => document.getElementById("skill-create-title")?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("工作区尚未就绪。");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("请填写 Skill 名称");
      const created = await submit({
        type: "CreateSkill",
        workspace_id: workspaceId,
        name: trimmed,
        body: body.trim(),
      });
      const id = outcomeId(created.ids, "skill_id");
      if (!id) throw new Error("未能取得 Skill 编号");
      return id;
    },
    onSuccess: async (id) => {
      await qc.invalidateQueries();
      onClose();
      navigate(`/skills/${id}`);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  return (
    <CatalogComposer
      open={open}
      title="新建 Skill"
      submitLabel={createActionLabel("Skill")}
      submitDisabled={create.isPending || !name.trim()}
      onClose={onClose}
      onSubmit={() => create.mutate()}
    >
      <Input
        id="skill-create-title"
        value={name}
        placeholder="Skill 名称"
        className="h-10 border-0 px-0 text-lg font-medium shadow-none focus-visible:ring-0"
        onChange={(event) => setName(event.target.value)}
      />
      <Textarea
        value={body}
        placeholder="写入技能说明。绑定到智能体后，下一次运行会注入指令。"
        className="min-h-40 border-0 px-0 shadow-none focus-visible:ring-0"
        onChange={(event) => setBody(event.target.value)}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </CatalogComposer>
  );
}

export function SquadCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const workspaceId = useSession((s) => s.workspaceId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const agents = useQuery({
    queryKey: ["view", { type: "Agents", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId) && open,
    queryFn: () => view({ type: "Agents", workspace_id: workspaceId! }),
  });
  const agentList = listableAgents(asAgents(agents.data));
  const [name, setName] = useState("");
  const [leaderId, setLeaderId] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const defaultLeader = agentList[0]?.id ?? "";
  const selectedLeader = leaderId || defaultLeader;

  useEffect(() => {
    if (!open) return;
    setName("");
    setLeaderId("");
    setMemberIds([]);
    setError(null);
    const timer = window.setTimeout(() => document.getElementById("squad-create-title")?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  const agentItems = useMemo(
    () => Object.fromEntries(agentList.map((agent) => [agent.id, agentDisplayName(agent)])),
    [agentList],
  );
  const leader = agentList.find((agent) => agent.id === selectedLeader);

  const create = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("工作区尚未就绪。");
      if (!selectedLeader) throw new Error("须先创建智能体后才能继续。");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("请填写小队名称");
      const created = await submit({
        type: "CreateSquad",
        workspace_id: workspaceId,
        name: trimmed,
        leader_agent_id: selectedLeader,
      });
      const id = outcomeId(created.ids, "squad_id");
      if (!id) throw new Error("未能取得小队编号");
      if (memberIds.length > 0) {
        await submit({ type: "SetSquadMembers", squad_id: id, agent_ids: memberIds });
      }
      return id;
    },
    onSuccess: async (id) => {
      await qc.invalidateQueries();
      onClose();
      navigate(`/squads/${id}`);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  return (
    <CatalogComposer
      open={open}
      title="新建小队"
      submitLabel={createActionLabel("小队")}
      submitDisabled={create.isPending || !name.trim() || !selectedLeader}
      onClose={onClose}
      onSubmit={() => create.mutate()}
    >
      {agentList.length === 0 ? (
        <NeedAgentHint onCancel={onClose} />
      ) : (
        <>
          <Input
            id="squad-create-title"
            value={name}
            placeholder="小队名称"
            className="h-10 border-0 px-0 text-lg font-medium shadow-none focus-visible:ring-0"
            onChange={(event) => setName(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Select value={selectedLeader} items={agentItems} onValueChange={(value) => value && setLeaderId(value)}>
              <SelectTrigger size="sm" className={catalogPillTrigger}>
                {leader ? <AgentAvatar agent={leader} className="size-3.5" /> : null}
                <SelectValue>{leader ? agentDisplayName(leader) : "领队"}</SelectValue>
              </SelectTrigger>
              <SelectContent className="min-w-48">
                {agentList.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    <NamedAgent agent={agent} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">成员</p>
            <div className="flex flex-wrap gap-1.5">
              {agentList.map((agent) => {
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
        </>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </CatalogComposer>
  );
}
