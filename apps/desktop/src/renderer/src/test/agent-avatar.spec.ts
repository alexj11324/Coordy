import { describe, expect, it } from "vitest";
import {
  AGENT_AVATAR_STYLE,
  agentAvatarDataUri,
  formatAgentAvatar,
  parseAgentAvatar,
  storedAgentAvatar,
} from "../lib/coordy/agent-avatar";

describe("agent DiceBear avatars", () => {
  it("stores a compact dicebear seed instead of SVG", () => {
    expect(formatAgentAvatar("ag_1")).toBe(`dicebear:${AGENT_AVATAR_STYLE}:ag_1`);
    expect(parseAgentAvatar("dicebear:bottts-neutral:alpha", "fallback")).toEqual({
      style: "bottts-neutral",
      seed: "alpha",
    });
    expect(parseAgentAvatar("", "ag_missing").seed).toBe("ag_missing");
    expect(storedAgentAvatar("", "ag_1")).toBe(`dicebear:${AGENT_AVATAR_STYLE}:ag_1`);
    expect(storedAgentAvatar(" dicebear:bottts-neutral:kept ", "ag_1")).toBe("dicebear:bottts-neutral:kept");
  });

  it("renders the same data URI for the same seed", () => {
    const first = agentAvatarDataUri({ avatar: formatAgentAvatar("coordy-agent") });
    const second = agentAvatarDataUri({ avatar: formatAgentAvatar("coordy-agent") });
    expect(first).toBe(second);
    expect(first.startsWith("data:image/svg+xml")).toBe(true);
    expect(agentAvatarDataUri({ avatar: formatAgentAvatar("other") })).not.toBe(first);
  });
});
