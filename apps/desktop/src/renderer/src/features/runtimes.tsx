import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  PageHeader,
} from "@coordy/ui";
import { Monitor, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { DiscoveredAgentView } from "@coordy/protocol";
import { runtimeIsLaunchable, runtimeReadiness } from "../lib/coordy/labels";
import { ProviderLogo } from "./provider-logo";
import { StatusLamp } from "./status-lamp";

export function RuntimesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });
  const items = catalog.data ?? [];
  const { ready, missing } = partitionRuntimeCatalog(items);

  return (
    <section className="space-y-4">
      <PageHeader
        title="Harness"
        description="管理 Coordy 可以使用的编程工具。"
      >
        <Button
          variant="secondary"
          onClick={async () => {
            setRefreshError(null);
            try {
              const refreshed = await window.coordy.discoverAgents(true);
              qc.setQueryData(["discover-agents"], refreshed);
            } catch (error) {
              setRefreshError(
                error instanceof Error
                  ? error.message
                  : "Registry 刷新失败，仍显示上次可用结果。",
              );
            }
          }}
        >
          <RefreshCw data-icon="inline-start" />
          刷新
        </Button>
      </PageHeader>
      {refreshError ? (
        <p role="alert" className="text-sm text-destructive">
          {refreshError}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        创建智能体时再选择 harness；本页不会自动生成智能体。
      </p>
      {ready.length === 0 ? (
        <Empty className="bg-muted/30">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Monitor />
            </EmptyMedia>
            <EmptyTitle>未检测到 harness</EmptyTitle>
            <EmptyDescription>
              请安装 Claude Code、Codex 或 Antigravity
              CLI，确认可在终端中运行后刷新检测。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        ready.map((item) => (
          <Card key={item.id} size="sm" className="mb-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ProviderLogo provider={item.id} className="size-4" />
                {item.name}
                <Badge variant="outline">
                  <StatusLamp tone={runtimeReadiness(item).tone} />
                  {runtimeReadiness(item).label}
                </Badge>
              </CardTitle>
              {item.version ? (
                <CardDescription>{item.version}</CardDescription>
              ) : null}
              <CardAction>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    navigate(
                      `/agents/new?harness=${encodeURIComponent(item.id)}`,
                    )
                  }
                >
                  用此 harness 创建智能体
                </Button>
              </CardAction>
            </CardHeader>
          </Card>
        ))
      )}
      {missing.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">本机尚未安装</h2>
          <p className="text-sm text-muted-foreground">
            安装完成后刷新检测即可出现在上方。不会自动创建为智能体。
          </p>
          {missing.map((item) => (
            <Card key={item.id} size="sm" className="mb-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ProviderLogo provider={item.id} className="size-4" />
                  {item.name}
                  <Badge variant="secondary">
                    <StatusLamp tone="red" />
                    {runtimeReadiness(item).label}
                  </Badge>
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function partitionRuntimeCatalog(items: DiscoveredAgentView[]): {
  ready: DiscoveredAgentView[];
  missing: DiscoveredAgentView[];
} {
  return {
    ready: items.filter(runtimeIsLaunchable),
    missing: items.filter((item) => !runtimeIsLaunchable(item)),
  };
}
