export function draftAgentFromGoal(goal: string): {
  name: string;
  description: string;
  instructions: string;
} {
  const text = goal.trim();
  const firstLine = text.split(/\n/)[0]?.trim() ?? "";
  const nameSeed = firstLine.replace(/[。！？.!?].*$/, "").trim();
  const name = (nameSeed || "新智能体").slice(0, 24);
  return {
    name,
    description: firstLine.slice(0, 80),
    instructions: text,
  };
}
