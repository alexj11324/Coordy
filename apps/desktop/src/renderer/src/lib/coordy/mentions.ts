import type { Mention } from "@coordy/protocol";

export function mentionsFromBody(body: string): Mention[] {
  const out: Mention[] = [];
  for (const token of body.split(/\s+/)) {
    if (!token.startsWith("@")) continue;
    const rest = token.slice(1);
    if (rest === "all") {
      out.push({ kind: "all", id: "all" });
    } else if (rest.startsWith("agent:")) {
      out.push({ kind: "agent", id: rest.slice("agent:".length) });
    } else if (rest.startsWith("squad:")) {
      out.push({ kind: "squad", id: rest.slice("squad:".length) });
    } else if (rest) {
      out.push({ kind: "principal", id: rest });
    }
  }
  return out;
}

export function insertAgentMention(body: string, agentId: string): string {
  const token = `@agent:${agentId}`;
  const trimmed = body.trimEnd();
  return trimmed ? `${trimmed} ${token} ` : `${token} `;
}
