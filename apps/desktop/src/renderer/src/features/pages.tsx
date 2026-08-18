import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@coordy/ui";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bot,
  FileText,
  GitBranch,
  Inbox,
  LayoutDashboard,
  Play,
  Plus,
  Shield,
  StickyNote,
  Users,
} from "lucide-react";
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { submit, view } from "../lib/coordy/client";
import { startAcpOnTask } from "../lib/coordy/start-task";
import { useSession } from "../state/session-store";
import type { Command, Query } from "@coordy/protocol";
import {
  asAgents,
  asCommitments,
  asConflicts,
  asContracts,
  asDependencies,
  asGrants,
  asInbox,
  asMemory,
  asPrincipals,
  asRunDetail,
  asRuns,
  asTasks,
} from "../lib/coordy/views";

export function useWorkspaceQuery(make: (workspace_id: string) => Query) {
  const workspaceId = useSession((s) => s.workspaceId);
  return useQuery({
    queryKey: ["view", make(workspaceId ?? ""), workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view(make(workspaceId!)),
  });
}

function useCommand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (command: Command) => submit(command),
    onSuccess: () => qc.invalidateQueries(),
  });
}

function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center gap-2">{children}</div>;
}

function EmptyList({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Empty className="bg-muted/30">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function BoardPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Board", workspace_id }));
  const commitments = useWorkspaceQuery((workspace_id) => ({
    type: "Commitments",
    workspace_id,
  }));
  const agents = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const title = useForm("");
  const claim = useForm("never-deploy-without-approval");
  const patch = useForm("");
  const prompt = useForm("继续做这件事，用中文汇报进度。");
  const command = useCommand();
  const qc = useQueryClient();
  const tasks = asTasks(q.data);
  const workspaceId = useSession((s) => s.workspaceId);
  const agentList = asAgents(agents.data);
  return (
    <section>
      <PageHeader title="任务" description="把一句话交给 ACP 助手。承诺和补丁还在下面，但不挡开始。" />
      <form
        className="mb-4 flex gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (workspaceId && title.value) {
            command.mutate({ type: "CreateTask", workspace_id: workspaceId, title: title.value });
            title.set("");
          }
        }}
      >
        <Input
          placeholder="新任务"
          value={title.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => title.set(event.target.value)}
        />
        <Button type="submit">
          <Plus data-icon="inline-start" />
          创建
        </Button>
      </form>
      <div className="mb-4 space-y-1.5">
        <Label htmlFor="board-prompt">对助手说</Label>
        <Textarea
          id="board-prompt"
          value={prompt.value}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => prompt.set(event.target.value)}
        />
      </div>
      {tasks.length === 0 ? (
        <EmptyList
          icon={LayoutDashboard}
          title="还没有任务"
          description="创建一个任务，或回到「开始」页直接说一句话。"
        />
      ) : (
        <div className="grid gap-3">
          {tasks.map((task) => (
            <Card key={task.id}>
              <CardHeader>
                <CardTitle>{task.title}</CardTitle>
                <CardDescription>
                  {task.assignee_agent_id ? `已指派 ${task.assignee_agent_id}` : "未指派"}
                  {task.worktree_path ? ` · ${task.worktree_path}` : ""}
                </CardDescription>
                <CardAction>
                  <Badge>{task.status}</Badge>
                </CardAction>
              </CardHeader>
              {task.blocked_reason ? (
                <CardContent>
                  <p className="text-sm text-destructive">{task.blocked_reason}</p>
                </CardContent>
              ) : null}
              <CardFooter className="flex-col items-stretch gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      const agent = agentList[0];
                      void (async () => {
                        if (agent && !task.assignee_agent_id) {
                          await submit({ type: "AssignTask", task_id: task.id, agent_id: agent.id });
                        }
                        await startAcpOnTask(task.id, prompt.value || task.title);
                        await qc.invalidateQueries();
                      })();
                    }}
                  >
                    <Play data-icon="inline-start" />
                    开始
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const agent = agentList[0];
                      if (agent) command.mutate({ type: "AssignTask", task_id: task.id, agent_id: agent.id });
                    }}
                  >
                    指派助手
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (!workspaceId) return;
                      command.mutate({
                        type: "UpsertCommitment",
                        workspace_id: workspaceId,
                        task_id: task.id,
                        commitment_type: "CONSTRAINT",
                        claim: claim.value,
                        polarity: "MUST_NOT",
                        authority: "USER",
                        scope: task.id,
                      });
                    }}
                  >
                    写下承诺
                  </Button>
                  <Button variant="secondary" onClick={() => command.mutate({ type: "CreateWorktree", task_id: task.id })}>
                    创建 worktree
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="要应用的补丁"
                    value={patch.value}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => patch.set(event.target.value)}
                  />
                  <Button
                    variant="destructive"
                    onClick={() => command.mutate({ type: "ApplyPatch", task_id: task.id, patch: patch.value })}
                  >
                    应用
                  </Button>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
      <h2 className="mb-2 mt-8 text-lg font-medium">Commitments</h2>
      <div className="mb-3 flex items-center gap-2">
        <Label htmlFor="commitment-claim" className="shrink-0 text-muted-foreground">
          Claim
        </Label>
        <Input
          id="commitment-claim"
          value={claim.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => claim.set(event.target.value)}
        />
      </div>
      {asCommitments(commitments.data).length === 0 ? (
        <p className="text-sm text-muted-foreground">No commitments yet. They appear after you write one on a task.</p>
      ) : (
        asCommitments(commitments.data).map((item) => (
          <Card key={item.id} size="sm" className="mb-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge>{item.authority}</Badge>
                {item.claim}
              </CardTitle>
              <CardAction>
                <Badge variant="outline">{item.status}</Badge>
              </CardAction>
            </CardHeader>
          </Card>
        ))
      )}
    </section>
  );
}

export function PrincipalsPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Principals", workspace_id }));
  const items = asPrincipals(q.data);
  const name = useForm("");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  return (
    <section>
      <PageHeader title="Principals" description="People who own agents, memory, and contract votes." />
      <form
        className="mb-4 flex gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (workspaceId && name.value) {
            command.mutate({ type: "CreatePrincipal", workspace_id: workspaceId, name: name.value });
            name.set("");
          }
        }}
      >
        <Input
          placeholder="Name"
          value={name.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => name.set(event.target.value)}
        />
        <Button type="submit">
          <Plus data-icon="inline-start" />
          Add
        </Button>
      </form>
      {items.length === 0 ? (
        <EmptyList icon={Users} title="No principals" description="Add the people this workspace coordinates." />
      ) : (
        items.map((person) => (
          <Card key={person.id} size="sm" className="mb-2">
            <CardHeader>
              <CardTitle>{person.name}</CardTitle>
              <CardAction>
                <Badge variant="outline">{person.id}</Badge>
              </CardAction>
            </CardHeader>
          </Card>
        ))
      )}
    </section>
  );
}

export function AgentsPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const principals = useWorkspaceQuery((workspace_id) => ({ type: "Principals", workspace_id }));
  const items = asAgents(q.data);
  const people = asPrincipals(principals.data);
  const name = useForm("");
  const harness = useForm("acp");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  const session = useSession();
  return (
    <section>
      <PageHeader title="助手" description="默认走 ACP。没有 Codex/Claude 时，到「开始」页用内置演示助手。" />
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          const principal = people[0];
          if (workspaceId && name.value && principal) {
            command.mutate({
              type: "CreateAgent",
              workspace_id: workspaceId,
              principal_id: principal.id,
              name: name.value,
              harness: harness.value,
            });
            name.set("");
          }
        }}
      >
        <Input
          placeholder="助手名字"
          value={name.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => name.set(event.target.value)}
        />
        <Select
          value={harness.value}
          items={{ acp: "ACP", codex: "Codex CLI", claude_code: "Claude Code", opencode: "OpenCode", jsonl: "JSONL 回放" }}
          onValueChange={(value) => value && harness.set(value)}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="acp">ACP</SelectItem>
            <SelectItem value="codex">Codex CLI</SelectItem>
            <SelectItem value="claude_code">Claude Code</SelectItem>
            <SelectItem value="opencode">OpenCode</SelectItem>
            <SelectItem value="jsonl">JSONL 回放</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit">
          <Plus data-icon="inline-start" />
          添加
        </Button>
      </form>
      {items.length === 0 ? (
        <EmptyList icon={Bot} title="还没有助手" description="添加一个 ACP 助手，然后回到「开始」说一句话。" />
      ) : (
        items.map((agent) => (
          <Card key={agent.id} size="sm" className="mb-2">
            <CardHeader>
              <CardTitle>{agent.name}</CardTitle>
              <CardDescription>接入 {agent.harness}</CardDescription>
              <CardAction>
                <Button variant="ghost" size="sm" onClick={() => session.setAgent(agent.id, agent.principal_id)}>
                  以它的身份
                </Button>
              </CardAction>
            </CardHeader>
          </Card>
        ))
      )}
    </section>
  );
}

export function AuthorityPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Authority", workspace_id }));
  const agents = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const grants = asGrants(q.data);
  const agentList = asAgents(agents.data);
  const resource = useForm("");
  const action = useForm("command");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  return (
    <section>
      <PageHeader title="Authority" description="Grants never upgrade. Delegation is an attenuation." />
      <form
        className="mb-4 grid gap-2 md:grid-cols-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          const grantee = agentList[0];
          if (workspaceId && grantee && resource.value) {
            command.mutate({
              type: "Grant",
              workspace_id: workspaceId,
              grantee_id: grantee.id,
              resource: resource.value,
              action: action.value,
            });
          }
        }}
      >
        <Input
          placeholder="resource e.g. agent:…"
          value={resource.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => resource.set(event.target.value)}
        />
        <Input
          placeholder="action"
          value={action.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => action.set(event.target.value)}
        />
        <Button type="submit">Grant to first agent</Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const from = agentList[0];
            const to = agentList[1];
            if (workspaceId && from && to) {
              command.mutate({
                type: "Delegate",
                workspace_id: workspaceId,
                from_actor_id: from.id,
                to_actor_id: to.id,
                resource: resource.value || `agent:${from.id}`,
                action: action.value || "*",
              });
            }
          }}
        >
          Delegate A1→A2
        </Button>
      </form>
      {grants.length === 0 ? (
        <EmptyList icon={Shield} title="No grants" description="Grant an action on a resource to the first agent, or delegate A1→A2." />
      ) : (
        grants.map((grant) => (
          <Card key={grant.id} size="sm" className="mb-2">
            <CardHeader>
              <CardTitle className="font-mono text-sm">
                {grant.grantor_id} → {grant.grantee_id}
              </CardTitle>
              <CardDescription>
                {grant.action} on {grant.resource}
              </CardDescription>
              <CardAction className="flex items-center gap-2">
                {grant.delegated ? <Badge>delegated</Badge> : null}
                {grant.revoked ? (
                  <Badge variant="destructive">revoked</Badge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => command.mutate({ type: "RevokeGrant", grant_id: grant.id })}>
                    Revoke
                  </Button>
                )}
              </CardAction>
            </CardHeader>
          </Card>
        ))
      )}
    </section>
  );
}

export function MemoryPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Memory", workspace_id }));
  const principals = useWorkspaceQuery((workspace_id) => ({ type: "Principals", workspace_id }));
  const items = asMemory(q.data);
  const people = asPrincipals(principals.data);
  const body = useForm("");
  const visibility = useForm("principal");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  return (
    <section>
      <PageHeader title="Memory" description="Private notes stay on this machine. Sync never includes them." />
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (workspaceId && body.value) {
            command.mutate({
              type: "AppendMemory",
              workspace_id: workspaceId,
              visibility: visibility.value,
              body: body.value,
            });
            body.set("");
          }
        }}
      >
        <Input
          className="min-w-56 flex-1"
          placeholder="Memory body"
          value={body.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => body.set(event.target.value)}
        />
        <Select
          value={visibility.value}
          items={{ principal: "principal", agent_private: "agent_private" }}
          onValueChange={(value) => value && visibility.set(value)}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="principal">principal</SelectItem>
            <SelectItem value="agent_private">agent_private</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit">Append</Button>
      </form>
      {items.length === 0 ? (
        <EmptyList icon={StickyNote} title="No memories" description="Append a principal or agent-private note. Private memory never uploads." />
      ) : (
        items.map((memory) => (
          <Card key={memory.id} className="mb-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge>{memory.visibility}</Badge>
                <Badge variant="outline">{memory.status}</Badge>
              </CardTitle>
              <CardDescription>{memory.body}</CardDescription>
            </CardHeader>
            <CardFooter className="gap-2">
              <Button variant="secondary" onClick={() => command.mutate({ type: "PublishMemory", memory_id: memory.id })}>
                Publish
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const other = people.find((person) => person.id !== memory.owner_actor_id);
                  if (other) {
                    command.mutate({
                      type: "ShareMemory",
                      memory_id: memory.id,
                      to_principal_id: other.id,
                    });
                  }
                }}
              >
                Share
              </Button>
              {memory.status === "proposed_share" ? (
                <Button onClick={() => command.mutate({ type: "AcceptShare", memory_id: memory.id })}>Accept</Button>
              ) : null}
            </CardFooter>
          </Card>
        ))
      )}
    </section>
  );
}

export function ContractsPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Contracts", workspace_id }));
  const principals = useWorkspaceQuery((workspace_id) => ({ type: "Principals", workspace_id }));
  const items = asContracts(q.data);
  const people = asPrincipals(principals.data);
  const title = useForm("");
  const body = useForm("");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  return (
    <section>
      <PageHeader title="Contracts" description="Proposals need the first two principals before they bind." />
      <form
        className="mb-4 grid gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (workspaceId && title.value && people.length >= 2) {
            command.mutate({
              type: "ProposeContract",
              workspace_id: workspaceId,
              title: title.value,
              body: body.value,
              participant_ids: people.slice(0, 2).map((person) => person.id),
            });
            title.set("");
            body.set("");
          }
        }}
      >
        <Input
          placeholder="Contract title"
          value={title.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => title.set(event.target.value)}
        />
        <Textarea
          placeholder="Body"
          value={body.value}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => body.set(event.target.value)}
        />
        <Button type="submit" className="w-fit">
          Propose with first two principals
        </Button>
      </form>
      {items.length === 0 ? (
        <EmptyList icon={FileText} title="No contracts" description="Add a second principal, then propose a contract they can approve." />
      ) : (
        items.map((contract) => (
          <Card key={contract.id} className="mb-2">
            <CardHeader>
              <CardTitle>{contract.title}</CardTitle>
              <CardDescription>{contract.body}</CardDescription>
              <CardAction>
                <Badge>{contract.status}</Badge>
              </CardAction>
            </CardHeader>
            {contract.status === "proposed" ? (
              <CardFooter>
                <Button onClick={() => command.mutate({ type: "ApproveContract", contract_id: contract.id })}>
                  Approve
                </Button>
              </CardFooter>
            ) : null}
          </Card>
        ))
      )}
    </section>
  );
}

export function DependenciesPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Dependencies", workspace_id }));
  const items = asDependencies(q.data);
  const fromId = useForm("");
  const toId = useForm("");
  const entity = useForm("repo");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  return (
    <section>
      <PageHeader title="Dependencies" description="Declared edges the kernel can validate." />
      <form
        className="mb-4 grid gap-2 md:grid-cols-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (workspaceId && fromId.value && toId.value) {
            command.mutate({
              type: "DeclareDependency",
              workspace_id: workspaceId,
              from_id: fromId.value,
              to_id: toId.value,
              entity: entity.value,
            });
          }
        }}
      >
        <Input placeholder="from id" value={fromId.value} onChange={(event: ChangeEvent<HTMLInputElement>) => fromId.set(event.target.value)} />
        <Input placeholder="to id" value={toId.value} onChange={(event: ChangeEvent<HTMLInputElement>) => toId.set(event.target.value)} />
        <Input placeholder="entity" value={entity.value} onChange={(event: ChangeEvent<HTMLInputElement>) => entity.set(event.target.value)} />
        <Button type="submit">Declare</Button>
      </form>
      {items.length === 0 ? (
        <EmptyList icon={GitBranch} title="No dependencies" description="Declare an edge from one id to another, for example a repo lock." />
      ) : (
        items.map((dep) => (
          <Card key={dep.id} size="sm" className="mb-2">
            <CardHeader>
              <CardTitle className="font-mono text-sm">
                {dep.from_id} → {dep.to_id}
              </CardTitle>
              <CardDescription>{dep.entity}</CardDescription>
              <CardAction>
                <Badge variant={dep.valid ? "outline" : "destructive"}>{dep.valid ? "valid" : "invalid"}</Badge>
              </CardAction>
            </CardHeader>
          </Card>
        ))
      )}
    </section>
  );
}

export function ConflictsPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Conflicts", workspace_id }));
  const items = asConflicts(q.data);
  return (
    <section>
      <PageHeader title="Conflicts" description="Working plans that contradict a commitment land here." />
      {items.length === 0 ? (
        <EmptyList icon={AlertTriangle} title="No conflicts" description="Replay a compaction fixture on Runs to see a plan collide with a commitment." />
      ) : (
        items.map((conflict) => (
          <Card key={conflict.id} size="sm" className="mb-2">
            <CardHeader>
              <CardTitle>{conflict.summary}</CardTitle>
              <CardAction>
                <Badge>{conflict.status}</Badge>
              </CardAction>
            </CardHeader>
          </Card>
        ))
      )}
    </section>
  );
}

export function RunsPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Runs", workspace_id }));
  const board = useWorkspaceQuery((workspace_id) => ({ type: "Board", workspace_id }));
  const items = asRuns(q.data);
  const tasks = asTasks(board.data);
  const [runId, setRunId] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["run", runId],
    enabled: Boolean(runId),
    queryFn: () => view({ type: "Run", run_id: runId! }),
  });
  const command = useCommand();
  const events = asRunDetail(detail.data)?.events ?? [];
  return (
    <section>
      <PageHeader title="运行" description="ACP 会话事件会进这里。下面的夹具只给研究回放用。">
        <Button
          onClick={() => {
            const task = tasks[0];
            if (!task) return;
            command.mutate({
              type: "StartRun",
              task_id: task.id,
              source: {
                type: "Fixture",
                events: [
                  {
                    type: "Message",
                    role: "user",
                    content: "GOAL: preserve-release-gate\nCONSTRAINT: never-deploy-without-approval",
                  },
                  { type: "Compaction", summary: "working on stuff" },
                  { type: "Message", role: "assistant", content: "PLAN: ship directly to production" },
                ],
              },
            });
          }}
        >
          Replay compaction fixture
        </Button>
      </PageHeader>
      {items.length === 0 ? (
        <EmptyList icon={Play} title="No runs" description="Create a task first, then replay the compaction fixture." />
      ) : (
        items.map((run) => (
          <Card key={run.id} size="sm" className="mb-2">
            <CardHeader>
              <button className="text-left" onClick={() => setRunId(run.id)}>
                <CardTitle className="font-mono text-sm">{run.id}</CardTitle>
                <CardDescription>compactions: {run.compaction_count}</CardDescription>
              </button>
              <CardAction>
                <Badge>{run.status}</Badge>
              </CardAction>
            </CardHeader>
          </Card>
        ))
      )}
      {runId ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {events.map((event) => (
              <p key={event.seq} className="text-sm">
                <Badge className="mr-2">{event.kind}</Badge>
                {event.payload}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}

export function InboxPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Inbox", workspace_id }));
  const items = asInbox(q.data);
  const command = useCommand();
  return (
    <section>
      <PageHeader title="Inbox" description="Pause and replan items the kernel will not auto-apply." />
      {items.length === 0 ? (
        <EmptyList icon={Inbox} title="Inbox is empty" description="Drift, blocked applies, and share proposals show up here." />
      ) : (
        items.map((item) => (
          <Card key={item.id} className="mb-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge>{item.kind}</Badge>
                {item.title}
              </CardTitle>
              <CardDescription>{item.body}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button variant="ghost" onClick={() => command.mutate({ type: "DismissInbox", item_id: item.id })}>
                Dismiss
              </Button>
            </CardFooter>
          </Card>
        ))
      )}
    </section>
  );
}

export function SettingsPage() {
  const workspaceId = useSession((s) => s.workspaceId);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["settings", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Settings", workspace_id: workspaceId! }),
  });
  const secrets = useQuery({
    queryKey: ["secrets"],
    queryFn: () => window.coordy.secretsStatus(),
  });
  const command = useCommand();
  const [appInfo, setAppInfo] = useState<string>("");
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [acpCommand, setAcpCommand] = useState("");
  const enabled = q.data?.type === "Settings" ? q.data.llm_advisor_enabled : false;
  const status = secrets.data;
  return (
    <section className="space-y-4">
      <PageHeader title="设置" description="密钥只留在这台电脑。没有助手二进制时，用内置 `coordy acp-stub`。" />
      <Card>
        <CardHeader>
          <CardTitle>BYOK 与 ACP</CardTitle>
          <CardDescription>密钥写 0600 文件，不进数据库。启动子进程时注入 OPENAI_API_KEY / ANTHROPIC_API_KEY。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            {status?.key_configured ? <Badge>密钥已保存</Badge> : <Badge variant="secondary">还没密钥</Badge>}
            {status?.acp_command ? (
              <Badge variant="outline">{status.acp_command}</Badge>
            ) : (
              <Badge variant="secondary">未指定 ACP 命令</Badge>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>服务商</Label>
              <Select
                value={provider}
                items={{ openai: "OpenAI 兼容", anthropic: "Anthropic", custom: "自定义" }}
                onValueChange={(value) => value && setProvider(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI 兼容</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="custom">自定义</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settings-key">API 密钥</Label>
              <Input
                id="settings-key"
                type="password"
                autoComplete="off"
                placeholder={status?.key_configured ? "已保存，留空则保持" : "sk-…"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="settings-base">Base URL</Label>
              <Input
                id="settings-base"
                placeholder={status?.base_url ?? "https://api.openai.com/v1"}
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="settings-acp">ACP 启动命令</Label>
              <Input
                id="settings-acp"
                placeholder={status?.acp_command ?? status?.suggested_acp_command ?? "codex acp"}
                value={acpCommand}
                onChange={(event) => setAcpCommand(event.target.value)}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button
            onClick={async () => {
              await window.coordy.setSecret({
                provider,
                api_key: apiKey.trim() ? apiKey.trim() : null,
                base_url: baseUrl.trim() ? baseUrl.trim() : null,
                acp_command: acpCommand.trim() ? acpCommand.trim() : null,
              });
              setApiKey("");
              await qc.invalidateQueries({ queryKey: ["secrets"] });
            }}
          >
            保存
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const info = await window.coordy.getAppInfo();
              const stub = status?.suggested_acp_command ?? (info.cliPath ? `${info.cliPath} acp-stub` : "coordy acp-stub");
              setAcpCommand(stub);
              await window.coordy.setSecret({ provider, acp_command: stub });
              await qc.invalidateQueries({ queryKey: ["secrets"] });
            }}
          >
            使用内置演示助手
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await window.coordy.clearSecret();
              await qc.invalidateQueries({ queryKey: ["secrets"] });
            }}
          >
            清除密钥
          </Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>工作区</CardTitle>
          <CardDescription>绑定仓库后，开始任务会把这个目录交给助手。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>仓库</Label>
            <p className="mt-1 text-sm text-muted-foreground">
              {q.data?.type === "Settings" ? q.data.repo_path ?? "未绑定" : "…"}
            </p>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2">
            <div>
              <Label htmlFor="llm-advisor">可选 LLM 顾问</Label>
              <p className="text-sm text-muted-foreground">顾问不能提交状态；确定性门禁始终开着。</p>
            </div>
            <Switch
              id="llm-advisor"
              checked={enabled}
              onCheckedChange={(next) => {
                if (workspaceId) {
                  command.mutate({
                    type: "SetSettings",
                    workspace_id: workspaceId,
                    llm_advisor_enabled: Boolean(next),
                  });
                }
              }}
            />
          </div>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button
            onClick={async () => {
              const path = await window.coordy.chooseRepository();
              if (path && workspaceId) {
                await submit({ type: "BindRepository", workspace_id: workspaceId, path });
                await qc.invalidateQueries();
              }
            }}
          >
            绑定仓库
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const info = await window.coordy.getAppInfo();
              setAppInfo(`${info.version} / ${info.os}`);
            }}
          >
            应用信息
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const result = await window.coordy.installCli();
              setAppInfo(result.message);
            }}
          >
            安装 CLI
          </Button>
          {appInfo ? <span className="text-xs text-muted-foreground">{appInfo}</span> : null}
        </CardFooter>
      </Card>
    </section>
  );
}

function useForm(initial: string) {
  const [value, set] = useState(initial);
  return { value, set };
}

export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </section>
  );
}
