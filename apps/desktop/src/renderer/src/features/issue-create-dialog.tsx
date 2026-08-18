import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@coordy/ui";
import { ArrowLeftRight, MoreHorizontal, Plus, Tag, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { submit, view } from "../lib/coordy/client";
import { ISSUE_BOARD_COLUMNS, PRIORITY_ITEMS, priorityTone } from "../lib/coordy/issues";
import { agentDisplayName, listableAgents, TASK_STATUS_ITEMS, taskStatusLabel } from "../lib/coordy/labels";
import { modifierSymbol } from "../lib/coordy/shortcuts";
import { startAcpOnTask } from "../lib/coordy/start-task";
import { asAgents, asProjects, asWorkspaces, outcomeId } from "../lib/coordy/views";
import { useLayoutStore } from "../state/layout-store";
import { useSession } from "../state/session-store";
import { StatusGlyph } from "./issue-status";

export function IssueCreateDialog({ os }: { os?: string }) {
  const open = useLayoutStore((s) => s.issueComposerOpen);
  const statusSeed = useLayoutStore((s) => s.issueComposerStatus);
  const close = useLayoutStore((s) => s.closeIssueComposer);
  const workspaceId = useSession((s) => s.workspaceId);
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState(statusSeed);
  const [priority, setPriority] = useState("none");
  const [agentId, setAgentId] = useState("none");
  const [projectId, setProjectId] = useState("none");
  const [label, setLabel] = useState("");
  const [labelOpen, setLabelOpen] = useState(false);
  const [keepCreating, setKeepCreating] = useState(false);
  const [startAgent, setStartAgent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workspaces = useQuery({
    queryKey: ["view", { type: "Workspaces" }],
    queryFn: () => view({ type: "Workspaces" }),
  });
  const agents = useQuery({
    queryKey: ["view", { type: "Agents", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Agents", workspace_id: workspaceId! }),
  });
  const projects = useQuery({
    queryKey: ["view", { type: "Projects", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Projects", workspace_id: workspaceId! }),
  });
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });

  const workspaceName = asWorkspaces(workspaces.data).find((item) => item.id === workspaceId)?.name ?? "coordy";
  const agentList = listableAgents(asAgents(agents.data));
  const projectList = asProjects(projects.data);
  const selectedAgent = agentList.find((item) => item.id === agentId);
  const mod = modifierSymbol(os);

  useEffect(() => {
    if (!open) return;
    useLayoutStore.getState().consumePendingFocus();
    setStatus(statusSeed || "open");
    setTitle("");
    setDescription("");
    setPriority("none");
    setAgentId("none");
    setProjectId("none");
    setLabel("");
    setLabelOpen(false);
    setStartAgent(false);
    setError(null);
    const timer = window.setTimeout(() => document.getElementById("issue-create-title")?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open, statusSeed]);

  const agentItems = useMemo(
    () =>
      Object.fromEntries([
        ["none", "未指派"],
        ...agentList.map((agent) => [agent.id, agentDisplayName(agent, catalog.data)]),
      ]),
    [agentList, catalog.data],
  );
  const projectItems = useMemo(
    () => Object.fromEntries([["none", "无项目"], ...projectList.map((project) => [project.id, project.name])]),
    [projectList],
  );

  const create = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("还没准备好，请稍等一下");
      const trimmed = title.trim();
      if (!trimmed) throw new Error("先写任务标题");
      const created = await submit({
        type: "CreateTask",
        workspace_id: workspaceId,
        title: trimmed,
        description: description.trim() || undefined,
      });
      const taskId = outcomeId(created.ids, "task_id");
      if (!taskId) throw new Error("没有拿到事项编号");
      if (status && status !== "open") {
        await submit({ type: "SetTaskStatus", task_id: taskId, status });
      }
      const nextLabel = label.trim();
      if (priority !== "none" || nextLabel) {
        await submit({
          type: "UpdateTask",
          task_id: taskId,
          priority: priority === "none" ? null : priority,
          labels: nextLabel ? [nextLabel] : null,
        });
      }
      const assignedAgent = agentId === "none" ? null : agentId;
      const assignedProject = projectId === "none" ? null : projectId;
      if (assignedAgent || assignedProject) {
        await submit({
          type: "AssignIssue",
          task_id: taskId,
          agent_id: assignedAgent,
          project_id: assignedProject,
        });
      }
      if (startAgent) {
        if (!assignedAgent) throw new Error("先选一个智能体，再切换到智能体创建");
        await startAcpOnTask(taskId, description.trim() || trimmed, assignedAgent);
      }
      return taskId;
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      if (keepCreating) {
        setTitle("");
        setDescription("");
        setError(null);
        document.getElementById("issue-create-title")?.focus();
        return;
      }
      close();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="关闭新建任务" onClick={close} />
      <form
        className="relative z-10 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-background shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            create.mutate();
          }
        }}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm">
          <p className="text-muted-foreground">
            <span className="text-foreground">{workspaceName}</span>
            <span className="mx-1.5">›</span>
            手动创建
          </p>
          <div className="flex items-center gap-1">
            <Button type="button" size="icon-sm" variant="ghost" aria-label="关闭" onClick={close}>
              <X />
            </Button>
          </div>
        </div>
        <div className="space-y-3 p-4">
          <Input
            id="issue-create-title"
            value={title}
            placeholder="任务标题"
            className="h-10 border-0 px-0 text-lg font-medium shadow-none focus-visible:ring-0"
            onChange={(event) => setTitle(event.target.value)}
          />
          <Textarea
            value={description}
            placeholder="添加描述..."
            className="min-h-24 border-0 px-0 shadow-none focus-visible:ring-0"
            onChange={(event) => setDescription(event.target.value)}
          />
          {startAgent && selectedAgent ? (
            <p className="text-xs text-muted-foreground">
              创建后 {agentDisplayName(selectedAgent, catalog.data)} 会立即开始工作。
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <Select value={status} items={TASK_STATUS_ITEMS} onValueChange={(value) => value && setStatus(value)}>
              <SelectTrigger size="sm" className="w-auto gap-1.5">
                <StatusGlyph status={status} />
                <SelectValue>{taskStatusLabel(status)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ISSUE_BOARD_COLUMNS.map((column) => (
                  <SelectItem key={column.id} value={column.id}>
                    {column.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priority} items={PRIORITY_ITEMS} onValueChange={(value) => value && setPriority(value)}>
              <SelectTrigger size="sm" className="w-auto">
                <span className={priorityTone(priority)}>—</span>
                <SelectValue>{priority === "none" ? "无优先级" : PRIORITY_ITEMS[priority]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORITY_ITEMS).map(([value, text]) => (
                  <SelectItem key={value} value={value}>
                    {text}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={agentId} items={agentItems} onValueChange={(value) => value && setAgentId(value)}>
              <SelectTrigger size="sm" className="w-auto max-w-48">
                <UserRound className="size-3.5" />
                <SelectValue>
                  {selectedAgent ? agentDisplayName(selectedAgent, catalog.data) : "未指派"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">未指派</SelectItem>
                {agentList.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agentDisplayName(agent, catalog.data)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {labelOpen ? (
              <Input
                autoFocus
                value={label}
                placeholder="标签"
                className="h-7 w-28"
                onChange={(event) => setLabel(event.target.value)}
                onBlur={() => {
                  if (!label.trim()) setLabelOpen(false);
                }}
              />
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => setLabelOpen(true)}>
                <Tag data-icon="inline-start" />
                {label.trim() || "添加标签"}
              </Button>
            )}
            <Select value={projectId} items={projectItems} onValueChange={(value) => value && setProjectId(value)}>
              <SelectTrigger size="sm" className="w-auto max-w-52">
                <SelectValue>{projectList.find((item) => item.id === projectId)?.name ?? "项目"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">无项目</SelectItem>
                {projectList.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button
            type="button"
            size="sm"
            variant={startAgent ? "secondary" : "ghost"}
            onClick={() => setStartAgent((value) => !value)}
          >
            <ArrowLeftRight data-icon="inline-start" />
            切换到智能体
          </Button>
          <Button
            type="button"
            size="sm"
            variant={keepCreating ? "secondary" : "ghost"}
            onClick={() => setKeepCreating((value) => !value)}
          >
            继续创建
          </Button>
          <Button type="submit" size="sm" disabled={create.isPending || !title.trim()}>
            创建任务
            <kbd className="ml-1 font-mono text-[10px] opacity-70">{mod}↵</kbd>
          </Button>
        </div>
      </form>
    </div>
  );
}

export function IssueComposerButton({ status }: { status?: string }) {
  return (
    <Button type="button" size="sm" onClick={() => useLayoutStore.getState().openIssueComposer(status)}>
      <Plus data-icon="inline-start" />
      新建
    </Button>
  );
}

export function ColumnMenu({ status }: { status: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" size="icon-sm" variant="ghost" aria-label="列操作" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuItem onClick={() => useLayoutStore.getState().openIssueComposer(status)}>
          在此列新建
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}