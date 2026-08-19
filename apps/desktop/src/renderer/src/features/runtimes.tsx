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
import { useNavigate } from "react-router-dom";
import { presenceLabel, presenceLampTone, runtimeSubtitle } from "../lib/coordy/labels";
import { ProviderLogo } from "./provider-logo";
import { StatusLamp } from "./status-lamp";

export function RuntimesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });
  const info = useQuery({
    queryKey: ["app-info"],
    queryFn: () => window.coordy.getAppInfo(),
  });
  const items = catalog.data ?? [];
  const known = new Set(["claude", "codex", "gemini", "copilot", "opencode", "cursor", "coordy-stub"]);
  const installed = items.filter((item) => item.installed);
  const missing = items.filter((item) => !item.installed && known.has(item.id));

  return (
    <section className="space-y-4">
      <PageHeader
        title="Harness"
        description="Harness 是本机上的一款 AI 编程工具，由智能体调用。离线表示当前无法启动，并不表示记录已被删除。"
      >
        <Button
          variant="secondary"
          onClick={async () => {
            await window.coordy.discoverAgents(true);
            await qc.invalidateQueries({ queryKey: ["discover-agents"] });
          }}
        >
          <RefreshCw data-icon="inline-start" />
          刷新
        </Button>
      </PageHeader>
      <p className="text-sm text-muted-foreground">
        {info.data ? `本机 · ${info.data.os}` : "正在读取本机信息…"}
        。创建智能体时再选择要使用的 harness；本页不会自动生成智能体。
      </p>
      {installed.length === 0 ? (
        <Empty className="bg-muted/30">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Monitor />
            </EmptyMedia>
            <EmptyTitle>未检测到 harness</EmptyTitle>
            <EmptyDescription>
              请安装 Claude Code、Codex 或 Gemini CLI，确认可在终端中运行后刷新检测。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        installed.map((item) => (
          <Card key={item.id} size="sm" className="mb-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ProviderLogo provider={item.id} className="size-4" />
                {item.name}
                <Badge variant="outline">
                  <StatusLamp tone={presenceLampTone("online")} />
                  {presenceLabel("online")}
                </Badge>
              </CardTitle>
              <CardDescription>
                {runtimeSubtitle(item)}
                {item.version ? ` · ${item.version}` : ""}
              </CardDescription>
              <CardAction>
                <Button size="sm" variant="secondary" onClick={() => navigate("/agents/new")}>
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
          <p className="text-sm text-muted-foreground">安装完成后刷新检测即可出现在上方。不会自动创建为智能体。</p>
          {missing.map((item) => (
            <Card key={item.id} size="sm" className="mb-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ProviderLogo provider={item.id} className="size-4" />
                  {item.name}
                  <Badge variant="secondary">
                    <StatusLamp tone={presenceLampTone("offline")} />
                    {presenceLabel("offline")}
                  </Badge>
                </CardTitle>
                <CardDescription>{runtimeSubtitle(item)}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : null}
    </section>
  );
}
