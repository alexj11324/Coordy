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
import { presenceLabel } from "../lib/coordy/labels";

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
  const known = new Set([
    "claude-acp",
    "codex-acp",
    "gemini",
    "github-copilot-cli",
    "opencode",
    "cursor",
    "coordy-stub",
  ]);
  const installed = items.filter((item) => item.installed);
  const missing = items.filter((item) => !item.installed && known.has(item.id));

  return (
    <section className="space-y-4">
      <PageHeader
        title="运行时"
        description="运行时是这台电脑加上一款 AI 编程工具。智能体在这里执行；离线只是现在跑不了，并不是被删了。"
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
        {info.data ? `这台电脑 · ${info.data.os}` : "正在读取这台电脑…"}
        。新建智能体时再选要用哪一个，这里不会自动变成智能体。
      </p>
      {installed.length === 0 ? (
        <Empty className="bg-muted/30">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Monitor />
            </EmptyMedia>
            <EmptyTitle>还没有检测到运行时</EmptyTitle>
            <EmptyDescription>
              先安装 Claude Code、Codex 或 Gemini CLI，并确认能在终端里运行，再点刷新。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        installed.map((item) => (
          <Card key={item.id} size="sm" className="mb-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {item.name}
                <Badge variant="outline">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {presenceLabel("online")}
                </Badge>
              </CardTitle>
              <CardDescription>
                {item.command}
                {item.version ? ` · ${item.version}` : ""}
              </CardDescription>
              <CardAction>
                <Button size="sm" variant="secondary" onClick={() => navigate("/agents/new")}>
                  用它新建智能体
                </Button>
              </CardAction>
            </CardHeader>
          </Card>
        ))
      )}
      {missing.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">本机尚未安装</h2>
          <p className="text-sm text-muted-foreground">装好后点刷新就会出现在上面。不会把它们先做成智能体。</p>
          {missing.map((item) => (
            <Card key={item.id} size="sm" className="mb-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {item.name}
                  <Badge variant="secondary">
                    <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                    {presenceLabel("offline")}
                  </Badge>
                </CardTitle>
                <CardDescription>{item.command}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : null}
    </section>
  );
}
