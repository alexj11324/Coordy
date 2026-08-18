import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  PageHeader,
  Switch,
  Textarea,
} from "@coordy/ui";
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { submit, view } from "../lib/coordy/client";
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
  const command = useCommand();
  const tasks = asTasks(q.data);
  const workspaceId = useSession((s) => s.workspaceId);
  const agentList = asAgents(agents.data);
  return (
    <section>
      <PageHeader title="Board" />
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
          placeholder="New task"
          value={title.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => title.set(event.target.value)}
        />
        <Button type="submit">Create</Button>
      </form>
      <div className="grid gap-3">
        {tasks.map((task) => (
          <Card key={task.id}>
            <div className="flex items-center justify-between">
              <strong>{task.title}</strong>
              <Badge>{task.status}</Badge>
            </div>
            {task.assignee_agent_id ? (
              <p className="mt-1 text-xs text-zinc-500">agent {task.assignee_agent_id}</p>
            ) : null}
            {task.worktree_path ? (
              <p className="mt-1 text-xs text-zinc-500">{task.worktree_path}</p>
            ) : null}
            {task.blocked_reason ? (
              <p className="mt-2 text-sm text-red-600">{task.blocked_reason}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  const agent = agentList[0];
                  if (agent) command.mutate({ type: "AssignTask", task_id: task.id, agent_id: agent.id });
                }}
              >
                Assign agent
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
                Write commitment
              </Button>
              <Button variant="secondary" onClick={() => command.mutate({ type: "CreateWorktree", task_id: task.id })}>
                Create worktree
              </Button>
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                placeholder="Patch to apply"
                value={patch.value}
                onChange={(event: ChangeEvent<HTMLInputElement>) => patch.set(event.target.value)}
              />
              <Button
                variant="destructive"
                onClick={() => command.mutate({ type: "ApplyPatch", task_id: task.id, patch: patch.value })}
              >
                Apply
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <h2 className="mb-2 mt-6 text-lg font-medium">Commitments</h2>
      <Input
        className="mb-3"
        value={claim.value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => claim.set(event.target.value)}
      />
      {asCommitments(commitments.data).map((item) => (
        <Card key={item.id} className="mb-2">
          <Badge>{item.authority}</Badge> {item.claim}{" "}
          <span className="text-xs text-zinc-500">{item.status}</span>
        </Card>
      ))}
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
      <PageHeader title="Principals" />
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
        <Button type="submit">Add</Button>
      </form>
      {items.map((person) => (
        <Card key={person.id} className="mb-2">
          {person.name} <Badge>{person.id}</Badge>
        </Card>
      ))}
    </section>
  );
}

export function AgentsPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const principals = useWorkspaceQuery((workspace_id) => ({ type: "Principals", workspace_id }));
  const items = asAgents(q.data);
  const people = asPrincipals(principals.data);
  const name = useForm("");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  const session = useSession();
  return (
    <section>
      <PageHeader title="Agents" />
      <form
        className="mb-4 flex gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          const principal = people[0];
          if (workspaceId && name.value && principal) {
            command.mutate({
              type: "CreateAgent",
              workspace_id: workspaceId,
              principal_id: principal.id,
              name: name.value,
              harness: "jsonl",
            });
            name.set("");
          }
        }}
      >
        <Input
          placeholder="Agent name"
          value={name.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => name.set(event.target.value)}
        />
        <Button type="submit">Add</Button>
      </form>
      {items.map((agent) => (
        <Card key={agent.id} className="mb-2">
          {agent.name} <Badge>{agent.harness}</Badge>
          <Button
            className="ml-2"
            variant="ghost"
            onClick={() => session.setAgent(agent.id, agent.principal_id)}
          >
            Act as
          </Button>
        </Card>
      ))}
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
      <PageHeader title="Authority" />
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
      {grants.map((grant) => (
        <Card key={grant.id} className="mb-2">
          {grant.grantor_id} → {grant.grantee_id} <Badge>{grant.action}</Badge> {grant.resource}
          {grant.delegated ? <Badge className="ml-2">delegated</Badge> : null}
          {grant.revoked ? <Badge className="ml-2">revoked</Badge> : (
            <Button className="ml-2" variant="ghost" onClick={() => command.mutate({ type: "RevokeGrant", grant_id: grant.id })}>
              Revoke
            </Button>
          )}
        </Card>
      ))}
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
      <PageHeader title="Memory" />
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
          placeholder="Memory body"
          value={body.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => body.set(event.target.value)}
        />
        <select
          className="rounded border border-zinc-300 px-2 text-sm"
          value={visibility.value}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => visibility.set(event.target.value)}
        >
          <option value="principal">principal</option>
          <option value="agent_private">agent_private</option>
        </select>
        <Button type="submit">Append</Button>
      </form>
      {items.map((memory) => (
        <Card key={memory.id} className="mb-2">
          <Badge>{memory.visibility}</Badge> <Badge>{memory.status}</Badge> {memory.body}
          <div className="mt-2 flex gap-2">
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
              <Button onClick={() => command.mutate({ type: "AcceptShare", memory_id: memory.id })}>
                Accept
              </Button>
            ) : null}
          </div>
        </Card>
      ))}
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
      <PageHeader title="Contracts" />
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
        <Button type="submit">Propose with first two principals</Button>
      </form>
      {items.map((contract) => (
        <Card key={contract.id} className="mb-2">
          <div className="flex items-center justify-between">
            <strong>{contract.title}</strong>
            <Badge>{contract.status}</Badge>
          </div>
          <p className="text-sm">{contract.body}</p>
          {contract.status === "proposed" ? (
            <Button className="mt-2" onClick={() => command.mutate({ type: "ApproveContract", contract_id: contract.id })}>
              Approve
            </Button>
          ) : null}
        </Card>
      ))}
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
      <PageHeader title="Dependencies" />
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
      {items.map((dep) => (
        <Card key={dep.id} className="mb-2">
          {dep.entity} {dep.from_id} → {dep.to_id} {dep.valid ? "valid" : "invalid"}
        </Card>
      ))}
    </section>
  );
}

export function ConflictsPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Conflicts", workspace_id }));
  const items = asConflicts(q.data);
  return (
    <section>
      <PageHeader title="Conflicts" />
      {items.map((conflict) => (
        <Card key={conflict.id} className="mb-2">
          {conflict.summary} <Badge>{conflict.status}</Badge>
        </Card>
      ))}
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
      <PageHeader title="Runs">
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
      {items.map((run) => (
        <Card key={run.id} className="mb-2">
          <button className="flex w-full justify-between text-left" onClick={() => setRunId(run.id)}>
            <span>{run.id}</span>
            <Badge>{run.status}</Badge>
          </button>
          <div className="text-sm text-zinc-500">compactions: {run.compaction_count}</div>
        </Card>
      ))}
      {runId ? (
        <Card className="mt-4">
          <h2 className="mb-2 font-medium">Events</h2>
          {events.map((event) => (
            <p key={event.seq} className="text-sm">
              <Badge>{event.kind}</Badge> {event.payload}
            </p>
          ))}
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
      <PageHeader title="Inbox" />
      {items.map((item) => (
        <Card key={item.id} className="mb-2">
          <Badge>{item.kind}</Badge> <strong>{item.title}</strong>
          <p className="text-sm">{item.body}</p>
          <Button className="mt-2" variant="ghost" onClick={() => command.mutate({ type: "DismissInbox", item_id: item.id })}>
            Dismiss
          </Button>
        </Card>
      ))}
    </section>
  );
}

export function SettingsPage() {
  const workspaceId = useSession((s) => s.workspaceId);
  const q = useQuery({
    queryKey: ["settings", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Settings", workspace_id: workspaceId! }),
  });
  const command = useCommand();
  const [appInfo, setAppInfo] = useState<string>("");
  const enabled = q.data?.type === "Settings" ? q.data.llm_advisor_enabled : false;
  return (
    <section>
      <PageHeader title="Settings" />
      <Card>
        <Label>Repository</Label>
        <p className="mb-3 text-sm text-zinc-600">
          {q.data?.type === "Settings" ? q.data.repo_path ?? "none" : "…"}
        </p>
        <Switch
          checked={enabled}
          label="Optional LLM advisor (deterministic gates stay on)"
          onCheckedChange={(next) => {
            if (workspaceId) {
              command.mutate({
                type: "SetSettings",
                workspace_id: workspaceId,
                llm_advisor_enabled: next,
              });
            }
          }}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={async () => {
              const path = await window.coordy.chooseRepository();
              if (path && workspaceId) {
                await submit({ type: "BindRepository", workspace_id: workspaceId, path });
              }
            }}
          >
            Bind repository
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const info = await window.coordy.getAppInfo();
              setAppInfo(`${info.version} / ${info.os}`);
            }}
          >
            App info
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const result = await window.coordy.installCli();
              setAppInfo(result.message);
            }}
          >
            Install CLI
          </Button>
        </div>
        {appInfo ? <p className="mt-2 text-xs text-zinc-500">{appInfo}</p> : null}
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
      <h1 className="mb-4 text-2xl font-semibold">{title}</h1>
      {children}
    </section>
  );
}
