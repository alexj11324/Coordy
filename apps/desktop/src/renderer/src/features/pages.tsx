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
  Textarea,
} from "@coordy/ui";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BarChart3,
  FileText,
  FolderKanban,
  GitBranch,
  Inbox,
  MessageSquare,
  Play,
  Plus,
  Puzzle,
  Shield,
  StickyNote,
  User,
  Users,
  UsersRound,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { submit, view } from "../lib/coordy/client";
import { tasksAssignedToMe, taskIdentifier } from "../lib/coordy/issues";
import { agentDisplayName, createActionLabel, emptyCreateHint, listableAgents, taskStatusLabel } from "../lib/coordy/labels";
import { startAcpOnTask } from "../lib/coordy/start-task";
import { useLayoutStore, type PendingFocus } from "../state/layout-store";
import { useSession } from "../state/session-store";
import type { Command, Query, View } from "@coordy/protocol";
import {
  asAgents,
  asAutomations,
  asChats,
  asConflicts,
  asContracts,
  asDependencies,
  asGrants,
  asInbox,
  asMemory,
  asPrincipals,
  asProjects,
  asRunDetail,
  asRuns,
  asSkills,
  asSquads,
  asTasks,
  outcomeId,
} from "../lib/coordy/views";
import { ActivityLine } from "./activity-marker";
import { AgentAvatar, NamedAgent } from "./agent-avatar";

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

function useCatalogComposer(kind: PendingFocus) {
  const pendingFocus = useLayoutStore((s) => s.pendingFocus);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (pendingFocus !== kind) return;
    useLayoutStore.getState().consumePendingFocus();
    setCreating(true);
  }, [kind, pendingFocus]);
  return { creating, setCreating };
}

function CreateEmpty({
  icon: Icon,
  title,
  actionLabel,
  onCreate,
}: {
  icon: LucideIcon;
  title: string;
  actionLabel?: string;
  onCreate?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 pb-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-7" />
      </div>
      <p className="text-sm text-muted-foreground">{title}</p>
      {actionLabel && onCreate ? (
        <Button type="button" onClick={onCreate}>
          <Plus data-icon="inline-start" />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function CatalogShell({
  title,
  description,
  createLabel,
  onCreate,
  creating,
  composer,
  empty,
  hasItems,
  children,
}: {
  title: string;
  description: string;
  createLabel: string;
  onCreate: () => void;
  creating: boolean;
  composer: ReactNode;
  empty: ReactNode;
  hasItems: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-4 md:px-6 md:pt-6">
        <PageHeader title={title} description={description}>
          <Button type="button" variant="outline" onClick={onCreate}>
            <Plus data-icon="inline-start" />
            {createLabel}
          </Button>
        </PageHeader>
        {creating ? composer : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 pb-4 md:px-6">
        {hasItems ? children : creating ? null : empty}
      </div>
    </section>
  );
}

function NamedCreateForm({
  placeholder,
  value,
  onChange,
  onSubmit,
  onCancel,
  extra,
  disabled,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  extra?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <form
      className="mb-4 flex flex-wrap items-center gap-2"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Input
        autoFocus
        className="max-w-xs"
        placeholder={placeholder}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
      {extra}
      <Button type="submit" disabled={disabled || !value.trim()}>
        创建
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        取消
      </Button>
    </form>
  );
}

function NamedCatalogPage<T extends { id: string; name: string }>({
  title,
  description,
  noun,
  icon,
  makeQuery,
  asItems,
  makeCommand,
  placeholder,
  pendingKind,
  descriptionOf,
}: {
  title: string;
  description: string;
  noun: string;
  icon: LucideIcon;
  makeQuery: (workspace_id: string) => Query;
  asItems: (view: View | undefined) => T[];
  makeCommand: (workspaceId: string, name: string) => Command;
  placeholder: string;
  pendingKind: PendingFocus;
  descriptionOf?: (item: T) => string | undefined;
}) {
  const q = useWorkspaceQuery(makeQuery);
  const items = asItems(q.data);
  const name = useForm("");
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  const { creating, setCreating } = useCatalogComposer(pendingKind);
  const createLabel = createActionLabel(noun);
  return (
    <CatalogShell
      title={title}
      description={description}
      createLabel={createLabel}
      onCreate={() => setCreating(true)}
      creating={creating}
      composer={
        <NamedCreateForm
          placeholder={placeholder}
          value={name.value}
          onChange={name.set}
          onSubmit={() => {
            if (!workspaceId || !name.value.trim()) return;
            command.mutate(makeCommand(workspaceId, name.value.trim()), {
              onSuccess: () => {
                name.set("");
                setCreating(false);
              },
            });
          }}
          onCancel={() => setCreating(false)}
        />
      }
      empty={
        <CreateEmpty
          icon={icon}
          title={emptyCreateHint(noun)}
          actionLabel={createLabel}
          onCreate={() => setCreating(true)}
        />
      }
      hasItems={items.length > 0}
    >
      {items.map((item) => (
        <Card key={item.id} size="sm" className="mb-2">
          <CardHeader>
            <CardTitle>{item.name}</CardTitle>
            {descriptionOf?.(item) ? <CardDescription>{descriptionOf(item)}</CardDescription> : null}
          </CardHeader>
        </Card>
      ))}
    </CatalogShell>
  );
}

function NeedAgentHint({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <p className="text-sm text-muted-foreground">须先创建智能体后才能继续。</p>
      <Button type="button" variant="outline" onClick={() => navigate("/agents/new")}>
        新建智能体
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        取消
      </Button>
    </div>
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
      <PageHeader title="成员" description="成员拥有智能体、记忆和契约投票权。" />
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
        <EmptyList icon={Users} title="暂无成员" description="添加将参与协作的成员。" />
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

export function AuthorityPage() {
  const q = useWorkspaceQuery((workspace_id) => ({ type: "Authority", workspace_id }));
  const agents = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const grants = asGrants(q.data);
  const agentList = listableAgents(asAgents(agents.data));
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
      <PageHeader title="权限" description="将命令权授予指定智能体。委托不得提升权限。" />
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
          授权
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
          {agentList.length < 2 ? "至少需要两个智能体" : "委托"}
        </Button>
      </div>
      {grants.length === 0 ? (
        <EmptyList icon={Shield} title="暂无授权" description="选择一个智能体授予动作，或将权限委托给另一个智能体。" />
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
      <PageHeader title="记忆" description="私有笔记仅保存在本机，不会随同步上传。" />
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
          items={{ principal: "成员私有", agent_private: "智能体私有" }}
          onValueChange={(value) => value && visibility.set(value)}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="principal">成员私有</SelectItem>
            <SelectItem value="agent_private">智能体私有</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit">添加</Button>
      </form>
      {items.length === 0 ? (
        <EmptyList icon={StickyNote} title="暂无记忆" description="添加一条成员或智能体私有笔记。私有记忆不会上传。" />
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
                      分享
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
      <PageHeader title="契约" description="选择两位成员作为参与方，双方批准后契约才生效。" />
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
          {people.length < 2 ? "至少需要两位成员" : "提议"}
        </Button>
      </form>
      {items.length === 0 ? (
        <EmptyList icon={FileText} title="暂无契约" description="至少再添加一位成员，然后选择两方提议契约。" />
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
  const agentList = listableAgents(asAgents(agents.data));
  const nodes = [
    ...tasks.map((task) => ({ id: task.id, label: `任务 · ${task.title}` })),
    ...agentList.map((agent) => ({ id: agent.id, label: `智能体 · ${agent.name}` })),
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
      <PageHeader title="依赖" description="声明内核可校验的边，例如任务锁定仓库。" />
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
          添加
        </Button>
      </form>
      {items.length === 0 ? (
        <EmptyList icon={GitBranch} title="暂无依赖" description="在已有任务或智能体后，声明一条从 A 到 B 的边。" />
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
      <PageHeader title="冲突" description="工作计划与约定冲突时会出现在此处，可到收件箱处理。">
        <Button variant="secondary" onClick={() => navigate("/inbox")}>
          打开收件箱
        </Button>
      </PageHeader>
      {items.length === 0 ? (
        <EmptyList icon={AlertTriangle} title="暂无冲突" description="智能体在压缩后修改计划并与既有承诺冲突时，会记录冲突并投递到收件箱。" />
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
                处理
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
  const agentList = listableAgents(asAgents(agents.data));
  const [runId, setRunId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState("");
  const prompt = useForm("继续执行该事项，并用中文汇报进度。");
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
      <PageHeader title="运行" description="ACP 会话事件在此列出。选择任务后可向智能体发送后续指令。" />
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
          继续
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyList icon={Play} title="暂无运行" description="在「开始」或「任务」中指派智能体后，记录会出现在此处。" />
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
              <ActivityLine key={event.seq} event={event} />
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
      <PageHeader title="收件箱" description="暂停、重规划与被拦截的申请由收件箱承接，内核不会自动处理。" />
      {items.length === 0 ? (
        <EmptyList icon={Inbox} title="收件箱为空" description="漂移、被拦截的补丁与分享提议会出现在此处。" />
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

export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </section>
  );
}

export function ChatPage() {
  const chats = useWorkspaceQuery((workspace_id) => ({ type: "Chats", workspace_id }));
  const agents = useWorkspaceQuery((workspace_id) => ({ type: "Agents", workspace_id }));
  const items = asChats(chats.data);
  const agentList = listableAgents(asAgents(agents.data));
  const command = useCommand();
  const workspaceId = useSession((s) => s.workspaceId);
  const { creating, setCreating } = useCatalogComposer("new-chat");
  const createLabel = createActionLabel("聊天");
  const defaultAgentId = agentList[0]?.id ?? "";
  const [agentId, setAgentId] = useState("");
  const selectedAgentId = agentId || defaultAgentId;
  const agentItems = useMemo(
    () => Object.fromEntries(agentList.map((agent) => [agent.id, agentDisplayName(agent)])),
    [agentList],
  );
  return (
    <CatalogShell
      title="聊天"
      description="与智能体进行一对一对话，不依附于某一事项。"
      createLabel={createLabel}
      onCreate={() => setCreating(true)}
      creating={creating}
      composer={
        agentList.length === 0 ? (
          <NeedAgentHint onCancel={() => setCreating(false)} />
        ) : (
          <form
            className="mb-4 flex flex-wrap items-center gap-2"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (!workspaceId || !selectedAgentId) return;
              command.mutate(
                { type: "CreateChat", workspace_id: workspaceId, agent_id: selectedAgentId },
                {
                  onSuccess: (outcome) => {
                    setCreating(false);
                    const id = outcomeId(outcome.ids, "chat_id");
                    useLayoutStore.getState().openChatDock(id);
                  },
                },
              );
            }}
          >
            <Select
              value={selectedAgentId}
              items={agentItems}
              onValueChange={(value) => value && setAgentId(value)}
            >
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
            <Button type="submit" disabled={!selectedAgentId}>
              创建
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              取消
            </Button>
          </form>
        )
      }
      empty={
        <CreateEmpty
          icon={MessageSquare}
          title={emptyCreateHint("聊天")}
          actionLabel={createLabel}
          onCreate={() => setCreating(true)}
        />
      }
      hasItems={items.length > 0}
    >
      {items.map((chat) => {
        const agent = agentList.find((item) => item.id === chat.agent_id);
        return (
          <Card key={chat.id} size="sm" className="mb-2">
            <CardHeader>
              <button
                type="button"
                className="text-left"
                onClick={() => useLayoutStore.getState().openChatDock(chat.id)}
              >
                <CardTitle className="flex items-center gap-2">
                  {agent ? <AgentAvatar agent={agent} className="size-6" /> : null}
                  {chat.title?.trim() || "对话"}
                </CardTitle>
                <CardDescription>{agent ? agentDisplayName(agent) : chat.agent_id}</CardDescription>
              </button>
            </CardHeader>
          </Card>
        );
      })}
    </CatalogShell>
  );
}

export function MyIssuesPage() {
  const board = useWorkspaceQuery((workspace_id) => ({ type: "Board", workspace_id }));
  const principalId = useSession((s) => s.principalId);
  const agentId = useSession((s) => s.agentId);
  const navigate = useNavigate();
  const items = tasksAssignedToMe(asTasks(board.data), { principalId, agentId });
  const createLabel = createActionLabel("任务");
  const openNewTask = () => {
    useLayoutStore.getState().requestNewTaskFocus();
  };
  return (
    <CatalogShell
      title="我的任务"
      description="仅显示指派给你或你正在跟进的事项。"
      createLabel={createLabel}
      onCreate={openNewTask}
      creating={false}
      composer={null}
      empty={
        <CreateEmpty
          icon={User}
          title={emptyCreateHint("任务")}
          actionLabel={createLabel}
          onCreate={openNewTask}
        />
      }
      hasItems={items.length > 0}
    >
      {items.map((task) => (
        <Card key={task.id} size="sm" className="mb-2">
          <CardHeader>
            <button type="button" className="text-left" onClick={() => navigate(`/board/${task.id}`)}>
              <CardTitle>{task.title}</CardTitle>
              <CardDescription>
                {taskIdentifier(task)} · {taskStatusLabel(task.status)}
              </CardDescription>
            </button>
          </CardHeader>
        </Card>
      ))}
    </CatalogShell>
  );
}

export function ProjectsPage() {
  return (
    <NamedCatalogPage
      title="项目"
      description="用项目归集事项。新建任务时可选择所属项目。"
      noun="项目"
      icon={FolderKanban}
      makeQuery={(workspace_id) => ({ type: "Projects", workspace_id })}
      asItems={asProjects}
      makeCommand={(workspace_id, name) => ({ type: "CreateProject", workspace_id, name })}
      placeholder="项目名称"
      pendingKind="new-project"
      descriptionOf={(item) => item.description}
    />
  );
}

export function AutomationsPage() {
  return (
    <NamedCatalogPage
      title="自动化"
      description="保存名称。当前不提供定时器，也不会按 Webhook 自动执行。"
      noun="自动化"
      icon={Workflow}
      makeQuery={(workspace_id) => ({ type: "Automations", workspace_id })}
      asItems={asAutomations}
      makeCommand={(workspace_id, name) => ({ type: "CreateAutomation", workspace_id, name, runbook: "" })}
      placeholder="自动化名称"
      pendingKind="new-automation"
      descriptionOf={(item) => item.runbook || item.schedule}
    />
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
  const agentItems = useMemo(
    () => Object.fromEntries(agentList.map((agent) => [agent.id, agentDisplayName(agent)])),
    [agentList],
  );
  return (
    <CatalogShell
      title="小队"
      description="小队有一名领队智能体，由领队向成员派发工作。"
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
              <Select
                value={selectedLeader}
                items={agentItems}
                onValueChange={(value) => value && setLeaderId(value)}
              >
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
                  onSuccess: () => {
                    name.set("");
                    setCreating(false);
                  },
                },
              );
            }}
            onCancel={() => setCreating(false)}
            disabled={!selectedLeader}
          />
        )
      }
      empty={
        <CreateEmpty
          icon={UsersRound}
          title={emptyCreateHint("小队")}
          actionLabel={createLabel}
          onCreate={() => setCreating(true)}
        />
      }
      hasItems={items.length > 0}
    >
      {items.map((squad) => {
        const leader = agentList.find((agent) => agent.id === squad.leader_agent_id);
        const members = squad.member_agent_ids?.length ?? 0;
        return (
          <Card key={squad.id} size="sm" className="mb-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {leader ? <AgentAvatar agent={leader} className="size-6" /> : null}
                {squad.name}
              </CardTitle>
              <CardDescription>
                领队 {leader ? agentDisplayName(leader) : squad.leader_agent_id}
                {members > 0 ? ` · ${members} 名成员` : ""}
              </CardDescription>
            </CardHeader>
          </Card>
        );
      })}
    </CatalogShell>
  );
}

export function StatsPage() {
  const board = useWorkspaceQuery((workspace_id) => ({ type: "Board", workspace_id }));
  const runs = useWorkspaceQuery((workspace_id) => ({ type: "Runs", workspace_id }));
  const tasks = asTasks(board.data);
  const runList = asRuns(runs.data);
  const running = tasks.filter((task) => task.status === "running").length;
  const done = tasks.filter((task) => task.status === "done").length;
  const empty = tasks.length === 0 && runList.length === 0;
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-4 md:px-6 md:pt-6">
        <PageHeader title="统计" description="工作区事项和执行的汇总。" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 pb-4 md:px-6">
        {empty ? (
          <CreateEmpty icon={BarChart3} title="暂无可汇总的事项。" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card size="sm">
              <CardHeader>
                <CardDescription>事项</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{tasks.length}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>进行中</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{running}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>已完成</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{done}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>运行</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{runList.length}</CardTitle>
              </CardHeader>
            </Card>
          </div>
        )}
      </div>
    </section>
  );
}

export function SkillsPage() {
  return (
    <NamedCatalogPage
      title="Skills"
      description="保存 Skill 名称与正文。当前没有将 Skill 挂接到智能体的界面。"
      noun="Skill"
      icon={Puzzle}
      makeQuery={(workspace_id) => ({ type: "Skills", workspace_id })}
      asItems={asSkills}
      makeCommand={(workspace_id, name) => ({ type: "CreateSkill", workspace_id, name, body: "" })}
      placeholder="Skill 名称"
      pendingKind="new-skill"
    />
  );
}
