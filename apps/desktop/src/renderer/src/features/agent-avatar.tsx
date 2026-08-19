import { Button, cn } from "@coordy/ui";
import { RefreshCw } from "lucide-react";
import { agentAvatarDataUri, newAgentAvatarRef } from "../lib/coordy/agent-avatar";
import { agentDisplayName } from "../lib/coordy/labels";
import type { DiscoveredAgentView } from "@coordy/protocol";

type AgentLike = {
  id?: string;
  name?: string;
  harness?: string;
  avatar?: string | null;
};

export function AgentAvatar({
  agent,
  className = "size-8",
}: {
  agent: AgentLike;
  className?: string;
}) {
  return (
    <img
      src={agentAvatarDataUri(agent)}
      alt=""
      draggable={false}
      className={cn("shrink-0 rounded-full bg-muted object-cover", className)}
    />
  );
}

export function NamedAgent({
  agent,
  catalog,
  className,
  avatarClassName = "size-5",
}: {
  agent: AgentLike & { id: string; name: string; harness: string };
  catalog?: DiscoveredAgentView[];
  className?: string;
  avatarClassName?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <AgentAvatar agent={agent} className={avatarClassName} />
      <span className="min-w-0 truncate">{agentDisplayName(agent, catalog)}</span>
    </span>
  );
}

export function AgentAvatarField({
  id = "agent-create-avatar",
  value,
  fallbackSeed,
  onChange,
}: {
  id?: string;
  value: string;
  fallbackSeed?: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <AgentAvatar agent={{ id: fallbackSeed, avatar: value }} className="size-12" />
      <Button id={id} type="button" variant="secondary" size="sm" onClick={() => onChange(newAgentAvatarRef())}>
        <RefreshCw data-icon="inline-start" />
        更换头像
      </Button>
    </div>
  );
}
