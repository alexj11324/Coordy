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
  Play,
  Plus,
  RefreshCw,
  Shield,
  StickyNote,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import { startAcpOnTask, syncDiscoveredAgents } from "../lib/coordy/start-task";
import { useSession } from "../state/session-store";
import type { Command, Query } from "@coordy/protocol";
import {
  asAgents,
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

function useForm(initial: string) {
  const [value, set] = useState(initial);
  return { value, set };
}

export function PrincipalsPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Principals", workspace_id }));
  const items = asPrincipals(q.data);
  const name = useForm("");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  return (
    <section>
      <PageHeader title="成员" description="成员拥有助手、记忆和契约投票权。" />
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
          placeholder="姓名"
          value={name.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => name.set(event.target.value)}
        />
        <Button type="submit">
          <Plus data-icon="inline-start" />
          添加
        </Button>
      </form>
      {items.length === 0 ? (
        <EmptyList icon={Users} title="还没有成员" description="先添加要参与协作的人。" />
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
  const items = asAgents(q.data);
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });
  const qc = useQueryClient();
  const workspaceId = useSession((s) => s.workspaceId);
  const principalId = useSession((s) => s.principalId);
  const session = useSession();
  const importedIds = new Set(items.map((agent) => agent.harness));
  const available = (catalog.data ?? []).filter((item) => !importedIds.has(item.id));
  const autoImported = useRef(false);

  useEffect(() => {
    if (!workspaceId || !principalId || !catalog.isFetched || autoImported.current) return;
    const missingInstalled = (catalog.data ?? []).filter((item) => item.installed && !importedIds.has(item.id));
    if (missingInstalled.length === 0) return;
    autoImported.current = true;
    void syncDiscoveredAgents(workspaceId, principalId, false).then(() => qc.invalidateQueries());
  }, [workspaceId, principalId, catalog.isFetched, catalog.data, importedIds, qc]);

  return (
    <section className="space-y-4">
      <PageHeader title="助手" description="启动时自动扫描 PATH 和 ACP Registry。本机已安装的会导入成队友；其余条目可一键加入，不用手填命令。">
        <Button
          variant="secondary"
          onClick={async () => {
            if (!workspaceId || !principalId) return;
            await syncDiscoveredAgents(workspaceId, principalId, true);
            await qc.invalidateQueries();
          }}
        >
          <RefreshCw data-icon="inline-start" />
          刷新发现
        </Button>
      </PageHeader>
      {items.length === 0 ? (
        <EmptyList icon={Bot} title="还没有助手" description="装好 Claude / Codex / Gemini 等 CLI 后会自动出现。演示助手也会一并导入。" />
      ) : (
        items.map((agent) => {
          const discovered = (catalog.data ?? []).find((item) => item.id === agent.harness);
          return (
            <Card key={agent.id} size="sm" className="mb-2">
              <CardHeader>
                <CardTitle>{agent.name}</CardTitle>
                <CardDescription>
                  {agent.harness}
                  {discovered?.installed ? " · 本机已安装" : discovered ? " · Registry" : ""}
                  {discovered?.command ? ` · ${discovered.command}` : ""}
                </CardDescription>
                <CardAction>
                  <Button variant="ghost" size="sm" onClick={() => session.setAgent(agent.id, agent.principal_id)}>
                    以它的身份
                  </Button>
                </CardAction>
              </CardHeader>
            </Card>
          );
        })
      )}
      {available.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>发现但未导入</CardTitle>
            <CardDescription>来自 ACP Registry。导入后就可以像指派同事一样指派它；启动时才按命令拉起，不会预先 npm install。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {available.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.installed ? "本机已安装" : "Registry"} · {item.command}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    if (!workspaceId || !principalId) return;
                    await window.coordy.importAgents({
                      workspace_id: workspaceId,
                      principal_id: principalId,
                      ids: [item.id],
                    });
                    await qc.invalidateQueries();
                  }}
                >
                  导入为队友
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
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
  const granteeId = useForm("");
  const fromId = useForm("");
  const toId = useForm("");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  const selectedGrantee = granteeId.value || agentList[0]?.id || "";
  const selectedFrom = fromId.value || agentList[0]?.id || "";
  const selectedTo = toId.value || agentList[1]?.id || agentList[0]?.id || "";
  const agentItems = Object.fromEntries(agentList.map((agent) => [agent.id, agent.name]));
  return (
    <section>
      <PageHeader title="权限" description="把命令权授给某个助手。委托不能升级。" />
      <form
        className="mb-4 grid gap-2 md:grid-cols-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          const grantee = agentList.find((agent) => agent.id === selectedGrantee) ?? agentList[0];
          if (workspaceId && grantee) {
            command.mutate({
              type: "Grant",
              workspace_id: workspaceId,
              grantee_id: grantee.id,
              resource: resource.value || `agent:${grantee.id}`,
              action: action.value || "command",
            });
          }
        }}
      >
        <Select value={selectedGrantee} items={agentItems} onValueChange={(value) => value && granteeId.set(value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {agentList.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="资源，例如 agent:…"
          value={resource.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => resource.set(event.target.value)}
        />
        <Input
          placeholder="动作"
          value={action.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => action.set(event.target.value)}
        />
        <Button type="submit" disabled={agentList.length === 0}>
          授予选中的助手
        </Button>
      </form>
      <div className="mb-4 grid gap-2 md:grid-cols-4">
        <Select value={selectedFrom} items={agentItems} onValueChange={(value) => value && fromId.set(value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {agentList.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                从 {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedTo} items={agentItems} onValueChange={(value) => value && toId.set(value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {agentList.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                到 {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="secondary"
          className="md:col-span-2"
          disabled={!workspaceId || agentList.length < 2 || selectedFrom === selectedTo}
          onClick={() => {
            const from = agentList.find((agent) => agent.id === selectedFrom);
            const to = agentList.find((agent) => agent.id === selectedTo);
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
          {agentList.length < 2 ? "需要至少两个助手才能委托" : "委托给选中的助手"}
        </Button>
      </div>
      {grants.length === 0 ? (
        <EmptyList icon={Shield} title="还没有授权" description="选一个助手授予动作，或把权限委托给另一个助手。" />
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
                {grant.delegated ? <Badge>已委托</Badge> : null}
                {grant.revoked ? (
                  <Badge variant="destructive">已收回</Badge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => command.mutate({ type: "RevokeGrant", grant_id: grant.id })}>
                    收回
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
  const shareTo = useForm("");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  const otherPeople = (ownerId: string) => people.filter((person) => person.id !== ownerId);
  return (
    <section>
      <PageHeader title="记忆" description="私人笔记留在这台电脑。同步永远不会带上它们。" />
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
          placeholder="记忆内容"
          value={body.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => body.set(event.target.value)}
        />
        <Select
          value={visibility.value}
          items={{ principal: "成员私有", agent_private: "助手私有" }}
          onValueChange={(value) => value && visibility.set(value)}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="principal">成员私有</SelectItem>
            <SelectItem value="agent_private">助手私有</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit">记下</Button>
      </form>
      {items.length === 0 ? (
        <EmptyList icon={StickyNote} title="还没有记忆" description="记下一条成员或助手私有笔记。私有记忆不会上传。" />
      ) : (
        items.map((memory) => {
          const recipients = otherPeople(memory.owner_actor_id);
          const recipientId = shareTo.value || recipients[0]?.id || "";
          return (
            <Card key={memory.id} className="mb-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Badge>{memory.visibility}</Badge>
                  <Badge variant="outline">{memory.status}</Badge>
                </CardTitle>
                <CardDescription>{memory.body}</CardDescription>
              </CardHeader>
              <CardFooter className="flex-wrap gap-2">
                <Button variant="secondary" onClick={() => command.mutate({ type: "PublishMemory", memory_id: memory.id })}>
                  公开
                </Button>
                {recipients.length === 0 ? (
                  <Button variant="secondary" disabled>
                    需要另一位成员才能分享
                  </Button>
                ) : (
                  <>
                    <Select
                      value={recipientId}
                      items={Object.fromEntries(recipients.map((person) => [person.id, person.name]))}
                      onValueChange={(value) => value && shareTo.set(value)}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {recipients.map((person) => (
                          <SelectItem key={person.id} value={person.id}>
                            {person.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (recipientId) {
                          command.mutate({
                            type: "ShareMemory",
                            memory_id: memory.id,
                            to_principal_id: recipientId,
                          });
                        }
                      }}
                    >
                      分享给选中的人
                    </Button>
                  </>
                )}
                {memory.status === "proposed_share" ? (
                  <Button onClick={() => command.mutate({ type: "AcceptShare", memory_id: memory.id })}>接受分享</Button>
                ) : null}
              </CardFooter>
            </Card>
          );
        })
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
  const first = useForm("");
  const second = useForm("");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  const firstId = first.value || people[0]?.id || "";
  const secondId = second.value || people[1]?.id || "";
  const peopleItems = Object.fromEntries(people.map((person) => [person.id, person.name]));
  return (
    <section>
      <PageHeader title="契约" description="选两位成员作为参与方，双方批准后契约才生效。" />
      <form
        className="mb-4 grid gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (workspaceId && title.value && firstId && secondId && firstId !== secondId) {
            command.mutate({
              type: "ProposeContract",
              workspace_id: workspaceId,
              title: title.value,
              body: body.value,
              participant_ids: [firstId, secondId],
            });
            title.set("");
            body.set("");
          }
        }}
      >
        <Input
          placeholder="契约标题"
          value={title.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => title.set(event.target.value)}
        />
        <Textarea
          placeholder="正文"
          value={body.value}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => body.set(event.target.value)}
        />
        <div className="grid gap-2 md:grid-cols-2">
          <Select value={firstId} items={peopleItems} onValueChange={(value) => value && first.set(value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {people.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={secondId} items={peopleItems} onValueChange={(value) => value && second.set(value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {people.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" className="w-fit" disabled={people.length < 2 || !firstId || !secondId || firstId === secondId}>
          {people.length < 2 ? "需要至少两位成员才能提议契约" : "向选中的两位成员提议契约"}
        </Button>
      </form>
      {items.length === 0 ? (
        <EmptyList icon={FileText} title="还没有契约" description="再添加一位成员，然后选两个人提议契约。" />
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
                  批准
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
  const board = useWorkspaceQuery((workspace_id) => ({ type: "Board", workspace_id }));
  const agents = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const items = asDependencies(q.data);
  const tasks = asTasks(board.data);
  const agentList = asAgents(agents.data);
  const nodes = [
    ...tasks.map((task) => ({ id: task.id, label: `任务 · ${task.title}` })),
    ...agentList.map((agent) => ({ id: agent.id, label: `助手 · ${agent.name}` })),
  ];
  const nodeItems = Object.fromEntries(nodes.map((node) => [node.id, node.label]));
  const fromId = useForm("");
  const toId = useForm("");
  const entity = useForm("repo");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  const selectedFrom = fromId.value || nodes[0]?.id || "";
  const selectedTo = toId.value || nodes[1]?.id || nodes[0]?.id || "";
  return (
    <section>
      <PageHeader title="依赖" description="声明内核可以校验的边，例如任务锁住仓库。" />
      <form
        className="mb-4 grid gap-2 md:grid-cols-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (workspaceId && selectedFrom && selectedTo) {
            command.mutate({
              type: "DeclareDependency",
              workspace_id: workspaceId,
              from_id: selectedFrom,
              to_id: selectedTo,
              entity: entity.value || "repo",
            });
          }
        }}
      >
        <Select value={selectedFrom} items={nodeItems} onValueChange={(value) => value && fromId.set(value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {nodes.map((node) => (
              <SelectItem key={node.id} value={node.id}>
                {node.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedTo} items={nodeItems} onValueChange={(value) => value && toId.set(value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {nodes.map((node) => (
              <SelectItem key={node.id} value={node.id}>
                {node.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input placeholder="实体，例如 repo" value={entity.value} onChange={(event: ChangeEvent<HTMLInputElement>) => entity.set(event.target.value)} />
        <Button type="submit" disabled={nodes.length < 1 || !selectedFrom || !selectedTo}>
          声明依赖
        </Button>
      </form>
      {items.length === 0 ? (
        <EmptyList icon={GitBranch} title="还没有依赖" description="先有任务或助手，再声明一条从 A 到 B 的边。" />
      ) : (
        items.map((dep) => (
          <Card key={dep.id} size="sm" className="mb-2">
            <CardHeader>
              <CardTitle className="font-mono text-sm">
                {dep.from_id} → {dep.to_id}
              </CardTitle>
              <CardDescription>{dep.entity}</CardDescription>
              <CardAction>
                <Badge variant={dep.valid ? "outline" : "destructive"}>{dep.valid ? "有效" : "失效"}</Badge>
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
  const navigate = useNavigate();
  return (
    <section>
      <PageHeader title="冲突" description="工作计划与承诺打架时会出现在这里。处理入口在收件箱。">
        <Button variant="secondary" onClick={() => navigate("/inbox")}>
          去收件箱
        </Button>
      </PageHeader>
      {items.length === 0 ? (
        <EmptyList icon={AlertTriangle} title="没有冲突" description="助手在压缩后改计划并撞上承诺时，会记一条冲突并投递到收件箱。" />
      ) : (
        items.map((conflict) => (
          <Card key={conflict.id} size="sm" className="mb-2">
            <CardHeader>
              <CardTitle>{conflict.summary}</CardTitle>
              <CardAction>
                <Badge>{conflict.status}</Badge>
              </CardAction>
            </CardHeader>
            <CardFooter>
              <Button variant="secondary" onClick={() => navigate("/inbox")}>
                去收件箱处理
              </Button>
            </CardFooter>
          </Card>
        ))
      )}
    </section>
  );
}

export function RunsPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Runs", workspace_id }));
  const board = useWorkspaceQuery((workspace_id) => ({ type: "Board", workspace_id }));
  const agents = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const items = asRuns(q.data);
  const tasks = asTasks(board.data);
  const agentList = asAgents(agents.data);
  const [runId, setRunId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState("");
  const prompt = useForm("继续做这件事，用中文汇报进度。");
  const detail = useQuery({
    queryKey: ["run", runId],
    enabled: Boolean(runId),
    queryFn: () => view({ type: "Run", run_id: runId! }),
    refetchInterval: 800,
  });
  const qc = useQueryClient();
  const events = asRunDetail(detail.data)?.events ?? [];
  const selectedTask = taskId || tasks[0]?.id || "";
  const taskItems = Object.fromEntries(tasks.map((task) => [task.id, task.title]));
  return (
    <section>
      <PageHeader title="运行" description="ACP 会话事件会进这里。选一个任务继续说，助手会接着干。" />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={selectedTask} items={taskItems} onValueChange={(value) => value && setTaskId(value)}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tasks.map((task) => (
              <SelectItem key={task.id} value={task.id}>
                {task.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="min-w-56 flex-1"
          value={prompt.value}
          onChange={(event) => prompt.set(event.target.value)}
        />
        <Button
          disabled={!selectedTask || agentList.length === 0}
          onClick={async () => {
            const task = tasks.find((item) => item.id === selectedTask) ?? tasks[0];
            if (!task) return;
            const agentId = task.assignee_agent_id || agentList[0]?.id;
            const outcome = await startAcpOnTask(task.id, prompt.value || task.title, agentId);
            const nextRun = String(outcome.ids.run_id ?? "");
            if (nextRun) setRunId(nextRun);
            await qc.invalidateQueries();
          }}
        >
          继续让助手干
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyList icon={Play} title="还没有运行" description="在「开始」或「任务」里派给助手，事件会出现在这里。" />
      ) : (
        items.map((run) => (
          <Card key={run.id} size="sm" className="mb-2">
            <CardHeader>
              <button className="text-left" onClick={() => setRunId(run.id)}>
                <CardTitle className="font-mono text-sm">{run.id}</CardTitle>
                <CardDescription>
                  {run.harness} · 压缩 {run.compaction_count} 次
                </CardDescription>
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
            <CardTitle>事件</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {events.map((event) => (
              <p key={event.seq} className="whitespace-pre-wrap text-sm">
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
      <PageHeader title="收件箱" description="暂停、重规划、被挡住的应用，内核不会自动处理。" />
      {items.length === 0 ? (
        <EmptyList icon={Inbox} title="收件箱是空的" description="漂移、被挡住的补丁和分享提议会出现在这里。" />
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
                忽略
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
  const appInfoQuery = useQuery({
    queryKey: ["app-info"],
    queryFn: () => window.coordy.getAppInfo(),
  });
  const command = useCommand();
  const [notice, setNotice] = useState("");
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const enabled = q.data?.type === "Settings" ? q.data.llm_advisor_enabled : false;
  const status = secrets.data;
  const info = appInfoQuery.data;
  return (
    <section className="space-y-4">
      <PageHeader title="设置" description="密钥留在这台电脑。助手由 PATH + ACP Registry 自动发现，不必手填命令。" />
      <Card>
        <CardHeader>
          <CardTitle>你自己的密钥</CardTitle>
          <CardDescription>写 0600 文件，不进数据库。启动子进程时注入 OPENAI_API_KEY / ANTHROPIC_API_KEY。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            {status?.key_configured ? <Badge>密钥已保存</Badge> : <Badge variant="secondary">还没密钥</Badge>}
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
          </div>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button
            onClick={async () => {
              await window.coordy.setSecret({
                provider,
                api_key: apiKey.trim() ? apiKey.trim() : null,
                base_url: baseUrl.trim() ? baseUrl.trim() : null,
              });
              setApiKey("");
              setNotice("密钥已保存。");
              await qc.invalidateQueries({ queryKey: ["secrets"] });
            }}
          >
            保存
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await window.coordy.clearSecret();
              setNotice("已清除本机密钥。");
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
          <p className="text-xs text-muted-foreground">
            {info ? `${info.version} / ${info.os}${info.cliPath ? ` / ${info.cliPath}` : ""}` : "读取应用信息…"}
          </p>
          {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
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
              const result = await window.coordy.installCli();
              setNotice(result.message);
            }}
          >
            安装 CLI 到 ~/.local/bin
          </Button>
        </CardFooter>
      </Card>
    </section>
  );
}

export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </section>
  );
}
