import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  PageHeader,
} from "@coordy/ui";
import { Bot, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { view } from "../lib/coordy/client";
import {
  agentDisplayName,
  agentPresence,
  agentSubtitle,
  listableAgents,
  presenceLabel,
  presenceLampTone,
} from "../lib/coordy/labels";
import { asAgents } from "../lib/coordy/views";
import { useSession } from "../state/session-store";
import { AgentAvatar } from "./agent-avatar";
import { StatusLamp } from "./status-lamp";

export function AgentsPage() {
  const workspaceId = useSession((s) => s.workspaceId);
  const session = useSession();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["view", { type: "Agents", workspace_id: workspaceId }, workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => view({ type: "Agents", workspace_id: workspaceId! }),
  });
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });
  const items = listableAgents(asAgents(q.data));

  return (
    <section className="space-y-4">
      <PageHeader
        title="智能体"
        description="智能体是工作区里反复使用的身份。它决定谁来做、按什么方式做；harness 决定在这台电脑上用哪款工具执行。"
      >
        <Button onClick={() => navigate("/agents/new")}>
          <Plus data-icon="inline-start" />
          新建智能体
        </Button>
      </PageHeader>
      {items.length === 0 ? (
        <Empty className="bg-muted/30">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bot />
            </EmptyMedia>
            <EmptyTitle>还没有智能体</EmptyTitle>
            <EmptyDescription>先新建一个，再选这台电脑上的 harness。未安装的工具不会出现在这里。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => navigate("/agents/new")}>新建智能体</Button>
          </EmptyContent>
        </Empty>
      ) : (
        items.map((agent) => {
          const presence = agentPresence(agent, catalog.data);
          return (
            <Card key={agent.id} size="sm" className="mb-2">
              <CardHeader>
                <button type="button" className="text-left" onClick={() => navigate(`/agents/${agent.id}`)}>
                  <CardTitle className="flex items-center gap-2">
                    <AgentAvatar agent={agent} className="size-8" />
                    {agentDisplayName(agent, catalog.data)}
                    <Badge variant={presence === "online" || presence === "demo" ? "outline" : "secondary"}>
                      <StatusLamp tone={presenceLampTone(presence)} />
                      {presenceLabel(presence)}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{agentSubtitle(agent, catalog.data)}</CardDescription>
                </button>
                <CardAction>
                  <Button variant="ghost" size="sm" onClick={() => session.setAgent(agent.id, agent.principal_id)}>
                    切换
                  </Button>
                </CardAction>
              </CardHeader>
            </Card>
          );
        })
      )}
    </section>
  );
}
