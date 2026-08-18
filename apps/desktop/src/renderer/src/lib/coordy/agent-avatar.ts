import { Avatar, Style } from "@dicebear/core";
import botttsNeutral from "@dicebear/styles/bottts-neutral.json" with { type: "json" };

export const AGENT_AVATAR_STYLE = "bottts-neutral";
export const AGENT_AVATAR_PREFIX = `dicebear:${AGENT_AVATAR_STYLE}:`;

const style = new Style(botttsNeutral);
const cache = new Map<string, string>();

const BACKGROUNDS = ["b6e3f4", "c0aede", "d1d4f9", "ffd5dc", "ffdfbf"];

export type AgentAvatarInput = {
  id?: string;
  avatar?: string | null;
};

export function parseAgentAvatar(value: string | undefined | null, fallbackSeed: string): { style: string; seed: string } {
  const raw = value?.trim() ?? "";
  const match = /^dicebear:([a-z0-9-]+):(.+)$/i.exec(raw);
  if (match?.[1] && match[2]) return { style: match[1], seed: match[2] };
  if (raw) return { style: AGENT_AVATAR_STYLE, seed: raw };
  return { style: AGENT_AVATAR_STYLE, seed: fallbackSeed || "agent" };
}

export function formatAgentAvatar(seed: string, avatarStyle = AGENT_AVATAR_STYLE): string {
  return `dicebear:${avatarStyle}:${seed}`;
}

export function storedAgentAvatar(value: string | undefined | null, fallbackSeed: string): string {
  const raw = value?.trim() ?? "";
  return raw || formatAgentAvatar(fallbackSeed || "agent");
}

export function newAgentAvatarRef(): string {
  const seed =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `seed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return formatAgentAvatar(seed);
}

export function agentAvatarDataUri(input: AgentAvatarInput): string {
  const parsed = parseAgentAvatar(input.avatar, input.id ?? "agent");
  const key = `${parsed.style}:${parsed.seed}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const uri = new Avatar(style, {
    seed: parsed.seed,
    size: 64,
    backgroundColor: BACKGROUNDS,
  }).toDataUri();
  cache.set(key, uri);
  return uri;
}
