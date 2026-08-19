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
  Switch,
  Textarea,
} from "@coordy/ui";
import type {
  DiscoveredAgentView,
  HarnessModelCatalog,
} from "@coordy/protocol";
import { Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  applyDraftFastChange,
  applyDraftModelChange,
  applyDraftRuntimeChange,
  applyDraftThinkingChange,
  DEFAULT_MODEL_VALUE,
  harnessHasFastToggle,
  isCodexFast,
  modelSelectValue,
  type AgentAccess,
  type AgentDraft,
  type HarnessModelOption,
  type ToolAccess,
} from "../../lib/coordy/agent-draft";
import {
  harnessIdsMatch,
  runtimeChipLabel,
  runtimeReadinessLabel,
  runtimeIsLaunchable,
} from "../../lib/coordy/labels";
import { AgentAvatarField } from "../agent-avatar";
import { ProviderLogo } from "../provider-logo";

const ACCESS_OPTIONS: {
  id: AgentAccess;
  title: string;
  description: string;
}[] = [
  { id: "owner", title: "仅自己", description: "仅创建者可运行此智能体。" },
  {
    id: "workspace",
    title: "整个工作区",
    description: "工作区全体成员均可运行。",
  },
];

const TOOL_ACCESS_OPTIONS: {
  id: ToolAccess;
  title: string;
  description: string;
}[] = [
  {
    id: "auto",
    title: "Auto",
    description:
      "常见操作自动放行，但仍拦危险或越界的步骤。Claude 用分类器判断每一步；Codex 只能改当前工作区。",
  },
  {
    id: "full_access",
    title: "Full Access",
    description: "不拦工具审批；Codex 也不再限制只能写工作区。隔离环境再用。",
  },
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
  const set = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) =>
    onChange({ ...draft, [key]: value });
  return (
    <div className={cn("space-y-8", compact && "space-y-6")}>
      <SettingsBlock title="身份">
        <FieldRow label="头像" htmlFor="agent-create-avatar" compact={compact}>
          <AgentAvatarField
            value={draft.avatar}
            onChange={(avatar) => set("avatar", avatar)}
          />
        </FieldRow>
        <FieldRow label="名称" htmlFor="agent-create-name" compact={compact}>
          <div>
            <Input
              id="agent-create-name"
              value={draft.name}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={
                nameError ? "agent-create-name-error" : undefined
              }
              onChange={(event) => set("name", event.target.value)}
              placeholder="例如：深度研究智能体"
            />
            {nameError ? (
              <p
                id="agent-create-name-error"
                className="mt-1.5 text-xs text-destructive"
              >
                {nameError}
              </p>
            ) : null}
          </div>
        </FieldRow>
        <FieldRow
          label="描述"
          htmlFor="agent-create-description"
          compact={compact}
          align="start"
        >
          <Textarea
            id="agent-create-description"
            rows={compact ? 3 : 4}
            value={draft.description}
            onChange={(event) => set("description", event.target.value)}
            placeholder="该智能体的用途"
            className="resize-y"
          />
        </FieldRow>
      </SettingsBlock>

      <SettingsBlock title="行为与能力">
        <FieldRow
          label="指令"
          htmlFor="agent-create-instructions"
          compact={compact}
          align="start"
        >
          <Textarea
            id="agent-create-instructions"
            rows={compact ? 9 : 12}
            value={draft.instructions}
            onChange={(event) => set("instructions", event.target.value)}
            placeholder="说明该智能体应执行的工作、关注范围与禁止事项…"
            className="min-h-44 resize-y font-mono text-sm leading-6"
          />
        </FieldRow>
      </SettingsBlock>

      <SettingsBlock title="执行配置">
        <div
          className={cn("grid gap-4 px-4 py-4", !compact && "sm:grid-cols-2")}
        >
          <HarnessDropdown
            items={runtimes}
            loading={runtimesLoading}
            value={draft.harness}
            os={os}
            onChange={(harness) =>
              onChange(applyDraftRuntimeChange(draft, harness))
            }
          />
          <RuntimeCapabilityFields
            harness={draft.harness}
            model={draft.model}
            thinking={draft.thinking}
            speed={draft.speed}
            disabled={!draft.harness}
            onModelChange={(model) =>
              onChange(applyDraftModelChange(draft, model))
            }
            onThinkingChange={(thinking) =>
              onChange(applyDraftThinkingChange(draft, thinking))
            }
            onFastChange={(on) => onChange(applyDraftFastChange(draft, on))}
          />
        </div>
      </SettingsBlock>

      <SettingsBlock title="工具权限">
        <ToolAccessField
          value={draft.toolAccess}
          onChange={(toolAccess) => set("toolAccess", toolAccess)}
        />
      </SettingsBlock>

      <SettingsBlock title="访问权限">
        <ChoiceRadios
          ariaLabel="访问权限"
          value={draft.access}
          onChange={(access) => set("access", access)}
          options={ACCESS_OPTIONS}
        />
      </SettingsBlock>
    </div>
  );
}

export function HarnessDropdown({
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
  const selected = items.find((item) => harnessIdsMatch(item.id, value));
  const resolved = selected?.id ?? value;
  const itemMap = Object.fromEntries(
    items.map((item) => [item.id, runtimeChipLabel(item, os)]),
  );
  return (
    <div className="min-w-0 space-y-1.5">
      <Label>Harness</Label>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {loading
            ? "正在读取 harness…"
            : "暂无可用 harness。请到「Harness」页刷新检测，或先安装 Claude Code、Codex 或 Gemini CLI。"}
        </p>
      ) : (
        <Select
          value={resolved || undefined}
          items={itemMap}
          onValueChange={(next) => next && onChange(next)}
          disabled={disabled}
        >
          <SelectTrigger className="h-auto min-h-10 py-1.5">
            <SelectValue placeholder="选择 harness">
              {selected ? (
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderLogo
                    provider={selected.id}
                    className="size-4 shrink-0"
                  />
                  <span className="min-w-0 truncate text-left">
                    {runtimeChipLabel(selected, os)}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {runtimeReadinessLabel(selected)}
                  </span>
                </span>
              ) : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem
                key={item.id}
                value={item.id}
                disabled={!runtimeIsLaunchable(item)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderLogo
                    provider={item.id}
                    className="size-4 shrink-0"
                  />
                  <span className="min-w-0 truncate">
                    {runtimeChipLabel(item, os)}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {runtimeReadinessLabel(item)}
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

export function RuntimeCapabilityFields({
  harness,
  model,
  thinking,
  speed,
  disabled,
  onModelChange,
  onThinkingChange,
  onFastChange,
}: {
  harness: string;
  model: string;
  thinking: string;
  speed: string;
  disabled?: boolean;
  onModelChange: (model: string) => void;
  onThinkingChange: (thinking: string) => void;
  onFastChange: (on: boolean) => void;
}) {
  const [catalog, setCatalog] = useState<HarnessModelCatalog | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  useEffect(() => {
    let active = true;
    setCatalog(null);
    if (!harness || typeof window.coordy.discoverHarnessModels !== "function")
      return () => {
        active = false;
      };
    setLoadingModels(true);
    void window.coordy
      .discoverHarnessModels(harness)
      .then((next) => {
        if (active) setCatalog(next);
      })
      .catch(() => {
        if (active)
          setCatalog({
            models: [],
            model_selection_supported: true,
            source: "unavailable",
          });
      })
      .finally(() => {
        if (active) setLoadingModels(false);
      });
    return () => {
      active = false;
    };
  }, [harness]);
  const discoveredThinking = catalog?.models.find(
    (item) => item.id === model,
  )?.thinking;
  const thinkingOptions = discoveredThinking ?? [];
  return (
    <>
      <ModelDropdown
        value={model}
        presets={catalog?.models ?? []}
        loading={loadingModels}
        modelSelectionSupported={catalog?.model_selection_supported ?? true}
        disabled={disabled}
        onChange={onModelChange}
      />
      {thinkingOptions.length > 0 ? (
        <TokenDropdown
          label="思考强度"
          value={thinking}
          presets={thinkingOptions}
          emptyLabel="默认（CLI）"
          disabled={disabled}
          onChange={onThinkingChange}
        />
      ) : null}
      {harnessHasFastToggle(harness) ? (
        <div className="flex min-h-10 min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="agent-codex-fast">Fast</Label>
          </div>
          <Switch
            id="agent-codex-fast"
            checked={isCodexFast(speed)}
            disabled={disabled}
            onCheckedChange={(on) => onFastChange(Boolean(on))}
          />
        </div>
      ) : null}
    </>
  );
}

export function ModelDropdown({
  value,
  presets,
  loading,
  modelSelectionSupported,
  onChange,
  disabled,
}: {
  value: string;
  presets: HarnessModelOption[];
  loading?: boolean;
  modelSelectionSupported?: boolean;
  onChange: (model: string) => void;
  disabled?: boolean;
}) {
  if (!modelSelectionSupported) {
    return (
      <div className="min-w-0 space-y-1.5">
        <Label>模型</Label>
        <Input value="由 harness 管理" disabled />
      </div>
    );
  }
  if (loading) {
    return (
      <div className="min-w-0 space-y-1.5">
        <Label>模型</Label>
        <Input value="正在读取 harness 模型…" disabled />
      </div>
    );
  }
  if (presets.length === 0) {
    return (
      <div className="min-w-0 space-y-1.5">
        <Label>模型</Label>
        <Input
          value={value}
          disabled={disabled}
          autoComplete="off"
          placeholder={
            disabled ? "请先选择 harness" : "模型 id，留空则用 CLI 默认"
          }
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    );
  }
  return (
    <TokenDropdown
      label="模型"
      value={value}
      presets={presets}
      emptyLabel="默认（CLI）"
      disabled={disabled}
      disabledPlaceholder="请先选择 harness"
      onChange={onChange}
    />
  );
}

function TokenDropdown({
  label,
  value,
  presets,
  emptyLabel,
  disabled,
  disabledPlaceholder,
  onChange,
}: {
  label: string;
  value: string;
  presets: HarnessModelOption[];
  emptyLabel: string;
  disabled?: boolean;
  disabledPlaceholder?: string;
  onChange: (value: string) => void;
}) {
  const items: Record<string, string> = { [DEFAULT_MODEL_VALUE]: emptyLabel };
  for (const preset of presets) items[preset.id] = preset.label;
  if (value.trim() && !items[value]) items[value] = value;
  return (
    <div className="min-w-0 space-y-1.5">
      <Label>{label}</Label>
      <Select
        value={modelSelectValue(value)}
        items={items}
        onValueChange={(next) =>
          next && onChange(next === DEFAULT_MODEL_VALUE ? "" : next)
        }
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue
            placeholder={
              disabled ? disabledPlaceholder || emptyLabel : emptyLabel
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_MODEL_VALUE}>{emptyLabel}</SelectItem>
          {presets.map((preset) => (
            <SelectItem key={preset.id} value={preset.id}>
              {preset.label}
            </SelectItem>
          ))}
          {value.trim() && !presets.some((preset) => preset.id === value) ? (
            <SelectItem value={value}>{value}</SelectItem>
          ) : null}
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
        <p
          role="alert"
          className="min-w-0 flex-1 break-words text-sm text-destructive"
        >
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
      <Button
        type="button"
        className={cn("shrink-0", !onDiscard && "ml-auto")}
        onClick={onCreate}
        disabled={!canCreate}
      >
        {creating ? <Loader2 className="size-4 animate-spin" /> : null}
        {creating ? "正在创建…" : "创建并打开"}
      </Button>
    </div>
  );
}

function SettingsBlock({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        {children}
      </div>
    </section>
  );
}

export function ToolAccessField({
  value,
  onChange,
}: {
  value: ToolAccess;
  onChange: (value: ToolAccess) => void;
}) {
  return (
    <ChoiceRadios
      ariaLabel="工具权限"
      value={value}
      onChange={onChange}
      options={TOOL_ACCESS_OPTIONS}
    />
  );
}

function ChoiceRadios<T extends string>({
  ariaLabel,
  value,
  onChange,
  options,
}: {
  ariaLabel: string;
  value: T;
  onChange: (value: T) => void;
  options: { id: T; title: string; description: string }[];
}) {
  return (
    <div className="space-y-1 p-2" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.id)}
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
              {selected ? (
                <span className="size-2 rounded-full bg-foreground" />
              ) : null}
            </span>
            <span>
              <span className="block text-sm font-medium">{option.title}</span>
              <span className="block text-xs text-muted-foreground">
                {option.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
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
