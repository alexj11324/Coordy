import { Badge } from "@coordy/ui";
import type { DiscoveredAgentView } from "@coordy/protocol";
import { presenceLabel, presenceLampTone, harnessIdsMatch, runtimeSubtitle } from "../lib/coordy/labels";
import { ProviderLogo } from "./provider-logo";
import { StatusLamp } from "./status-lamp";

export function RuntimePicker({
  items,
  value,
  onChange,
}: {
  items: DiscoveredAgentView[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        本机暂无可用 harness。请到「Harness」页刷新检测，或先安装 Claude Code、Codex 或 Gemini CLI。
      </p>
    );
  }
  return (
    <div className="grid gap-2">
      {items.map((item) => {
        const selected = harnessIdsMatch(value, item.id);
        const presence = item.installed ? "online" : "offline";
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={[
              "flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
              selected ? "border-foreground bg-muted/60" : "border-border hover:bg-muted/40",
            ].join(" ")}
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                <ProviderLogo provider={item.id} className="size-4" />
                {item.name}
              </p>
              <p className="truncate text-xs text-muted-foreground">{runtimeSubtitle(item)}</p>
            </div>
            <Badge variant={item.installed ? "outline" : "secondary"}>
              <StatusLamp tone={presenceLampTone(presence)} />
              {presenceLabel(presence)}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}
