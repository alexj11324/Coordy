import {
  Button,
  cn,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@coordy/ui";
import type { DiscoveredAgentView } from "@coordy/protocol";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import {
  DEFAULT_MODEL_VALUE,
  applyDraftModelChange,
  applyDraftRuntimeChange,
  type AgentAccess,
  type AgentDraft,
} from "../../lib/coordy/agent-draft";
import { runtimeChipLabel, runtimeSubtitle } from "../../lib/coordy/labels";
import { ProviderLogo } from "../provider-logo";

const ACCESS_OPTIONS: { id: AgentAccess; title: string; description: string }[] = [
  { id: "owner", title: "仅自己", description: "只有你可以运行此智能体。" },
  { id: "workspace", title: "整个工作区", description: "工作区中的所有成员都可以运行。" },
];

export function AgentConfigurationPanel({
  draft,
  onChange,
  runtimes,
  runtimesLoading,
  nameError,
  os,
  compact = false,
}: {
  draft: AgentDraft;
  onChange: (draft: AgentDraft) => void;
  runtimes: DiscoveredAgentView[];
  runtimesLoading: boolean;
  nameError: string | null;
  os?: string | null;
  compact?: boolean;
}) {
  const set = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) => onChange({ ...draft, [key]: value });
  return (
    <div className={cn("space-y-8", compact && "space-y-6")}>
      <SettingsBlock title="身份" description="为智能体设置容易识别的名称和简洁的用途。">
        <FieldRow label="名称" htmlFor="agent-create-name" compact={compact}>
          <div>
            <Input
              id="agent-create-name"
              value={draft.name}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "agent-create-name-error" : undefined}
              onChange={(event) => set("name", event.target.value)}
              placeholder="例如：深度研究智能体"
            />
            {nameError ? (
              <p id="agent-create-name-error" className="mt-1.5 text-xs text-destructive">
                {nameError}
              </p>
            ) : null}
          </div>
        </FieldRow>
        <FieldRow label="描述" htmlFor="agent-create-description" compact={compact} align="start">
          <Textarea
            id="agent-create-description"
            rows={compact ? 3 : 4}
            value={draft.description}
            onChange={(event) => set("description", event.target.value)}
            placeholder="这个智能体做什么？"
            className="resize-y"
          />
        </FieldRow>
      </SettingsBlock>

      <SettingsBlock title="行为与能力" description="定义它的工作方式。只属于这名智能体的长期要求写在指令中。">
        <FieldRow label="指令" htmlFor="agent-create-instructions" compact={compact} align="start">
          <Textarea
            id="agent-create-instructions"
            rows={compact ? 9 : 12}
            value={draft.instructions}
            onChange={(event) => set("instructions", event.target.value)}
            placeholder="写下这个智能体该做什么、关注什么、要避开什么…"
            className="min-h-44 resize-y font-mono text-sm leading-6"
          />
        </FieldRow>
      </SettingsBlock>

      <SettingsBlock
        title="执行配置"
        description="选择智能体使用的运行时，也可以覆盖运行时的默认模型。"
      >
        <div className={cn("grid gap-4 px-4 py-4", !compact && "sm:grid-cols-2")}>
          <RuntimeDropdown
            items={runtimes}
            loading={runtimesLoading}
            value={draft.harness}
            os={os}
            onChange={(harness) => onChange(applyDraftRuntimeChange(draft, harness))}
          />
          <ModelDropdown
            value={draft.model}
            disabled={!draft.harness}
            onChange={(model) => onChange(applyDraftModelChange(draft, model))}
          />
        </div>
      </SettingsBlock>

      <SettingsBlock title="访问权限" description="控制谁可以运行此智能体，创建后仍可修改。">
        <div className="space-y-1 p-2" role="radiogroup" aria-label="访问权限">
          {ACCESS_OPTIONS.map((option) => {
            const selected = draft.access === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => set("access", option.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  selected ? "bg-muted" : "hover:bg-muted/50",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                    selected ? "border-foreground" : "border-muted-foreground/40",
                  )}
                >
                  {selected ? <span className="size-2 rounded-full bg-foreground" /> : null}
                </span>
                <span>
                  <span className="block text-sm font-medium">{option.title}</span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingsBlock>
    </div>
  );
}

export function RuntimeDropdown({
  items,
  value,
  onChange,
  loading,
  os,
  disabled,
}: {
  items: DiscoveredAgentView[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  os?: string | null;
  disabled?: boolean;
}) {
  const selected = items.find((item) => item.id === value);
  const itemMap = Object.fromEntries(items.map((item) => [item.id, runtimeChipLabel(item, os)]));
  return (
    <div className="min-w-0 space-y-1.5">
      <Label>运行时</Label>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {loading ? "正在读取运行时…" : "暂无可用运行时。到「运行时」页点刷新，或先安装 Claude Code、Codex 或 Gemini CLI。"}
        </p>
      ) : (
        <Select value={value || undefined} items={itemMap} onValueChange={(next) => next && onChange(next)} disabled={disabled}>
          <SelectTrigger className="h-auto min-h-10 py-1.5">
            <SelectValue placeholder="选择运行时">
              {selected ? (
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderLogo provider={selected.id} className="size-4 shrink-0" />
                  <span className="min-w-0 truncate text-left">
                    <span className="block truncate">{runtimeChipLabel(selected, os)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{runtimeSubtitle(selected)}</span>
                  </span>
                </span>
              ) : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderLogo provider={item.id} className="size-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate">{runtimeChipLabel(item, os)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{runtimeSubtitle(item)}</span>
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export function ModelDropdown({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}) {
  const items = { [DEFAULT_MODEL_VALUE]: "默认（提供方）" };
  return (
    <div className="min-w-0 space-y-1.5">
      <Label>模型</Label>
      <Select
        value={value.trim() ? value : DEFAULT_MODEL_VALUE}
        items={items}
        onValueChange={(next) => next && onChange(next)}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder={disabled ? "请先选择运行时" : "默认（提供方）"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_MODEL_VALUE}>默认（提供方）</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function CreateAgentFooter({
  canCreate,
  creating,
  error,
  onCreate,
  onDiscard,
  discarding = false,
}: {
  canCreate: boolean;
  creating: boolean;
  error: string | null;
  onCreate: () => void;
  onDiscard?: () => void;
  discarding?: boolean;
}) {
  return (
    <div className="sticky bottom-0 mt-8 flex items-center justify-between gap-3 border-t bg-background/95 py-3 pr-20 pl-5 backdrop-blur">
      {error ? (
        <p role="alert" className="min-w-0 flex-1 break-words text-sm text-destructive">
          {error}
        </p>
      ) : (
        <span />
      )}
      {onDiscard ? (
        <Button
          type="button"
          variant="ghost"
          className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onDiscard}
          disabled={creating || discarding}
        >
          放弃创建
        </Button>
      ) : null}
      <Button type="button" className={cn("shrink-0", !onDiscard && "ml-auto")} onClick={onCreate} disabled={!canCreate}>
        {creating ? <Loader2 className="size-4 animate-spin" /> : null}
        {creating ? "正在创建…" : "创建并打开"}
      </Button>
    </div>
  );
}

function SettingsBlock({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  htmlFor,
  children,
  compact,
  align = "center",
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  compact?: boolean;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "grid gap-2 border-b px-4 py-4 last:border-b-0 sm:grid-cols-[9rem_minmax(0,1fr)]",
        align === "start" ? "sm:items-start" : "sm:items-center",
        compact && "py-3",
      )}
    >
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
