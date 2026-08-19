export type IssueCreateMode = "agent" | "manual";

export type AgentCreateSeed = {
  prompt?: string;
  agentId?: string;
  projectId?: string;
  priority?: string;
  dueDate?: string;
  keepCreating?: boolean;
};

export type ManualCreateSeed = {
  title?: string;
  description?: string;
  agentId?: string;
  projectId?: string;
  priority?: string;
  dueDate?: string;
  keepCreating?: boolean;
};

export function promptFromManual(title: string, description: string): string {
  return [title.trim(), description.trim()].filter(Boolean).join("\n\n");
}

export function titleFromPrompt(prompt: string): string {
  const line = prompt.trim().split("\n", 1)[0]?.trim() ?? "";
  if (!line) return "新事项";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

export function resolveIssueCreateMode(forceManual: boolean, lastMode: IssueCreateMode): IssueCreateMode {
  return forceManual ? "manual" : lastMode;
}
