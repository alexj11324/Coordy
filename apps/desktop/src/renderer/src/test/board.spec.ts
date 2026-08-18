import { describe, expect, it } from "vitest";
import { acpRunSource, chatTurnCommands } from "../lib/coordy/start-task";
import { draftAgentFromGoal } from "../lib/coordy/agent-draft";
import { agentDisplayName, createActionLabel, emptyCreateHint, listableAgents, providerKey, selectableRuntimes, taskStatusLabel } from "../lib/coordy/labels";
import { boardIssues, isChatIssue, tasksAssignedToMe } from "../lib/coordy/issues";
import { asTasks, boardColumn, isPlaceholderHarness, latestRunForTask, outcomeId } from "../lib/coordy/views";
import type { AgentView, RunView, TaskView, View } from "@coordy/protocol";

describe("board view helpers", () => {
  it("reads tasks from a Board view", () => {
    const view: View = {
      type: "Board",
      tasks: [
        {
          id: "task_1",
          workspace_id: "ws",
          title: "Ship",
          status: "open",
        },
      ],
    };
    expect(asTasks(view)).toHaveLength(1);
    expect(asTasks(view)[0]?.title).toBe("Ship");
  });

  it("extracts outcome ids", () => {
    expect(outcomeId({ task_id: "task_1" }, "task_id")).toBe("task_1");
  });

  it("builds an ACP run source instead of a JSONL fixture", () => {
    expect(acpRunSource("hello")).toEqual({ type: "Acp", prompt: "hello" });
  });

  it("puts running and review tasks in kanban columns", () => {
    expect(boardColumn("open")).toBe("open");
    expect(boardColumn("running")).toBe("running");
    expect(boardColumn("review")).toBe("review");
    expect(boardColumn("blocked")).toBe("blocked");
  });

  it("picks the latest run for a task", () => {
    const runs: RunView[] = [
      { id: "run_1", task_id: "t1", agent_id: "a", status: "completed", harness: "claude-acp", compaction_count: 0 },
      { id: "run_2", task_id: "t1", agent_id: "a", status: "running", harness: "claude-acp", compaction_count: 0 },
      { id: "run_3", task_id: "t2", agent_id: "a", status: "completed", harness: "claude-acp", compaction_count: 0 },
    ];
    expect(latestRunForTask(runs, "t1")?.id).toBe("run_2");
  });

  it("hides leftover placeholder agents that are not a real CLI", () => {
    const agents: AgentView[] = [
      { id: "ag_1", workspace_id: "ws", principal_id: "p", name: "助手", harness: "acp" },
      { id: "ag_2", workspace_id: "ws", principal_id: "p", name: "助手", harness: "acp" },
      { id: "ag_3", workspace_id: "ws", principal_id: "p", name: "Coordy 演示", harness: "coordy-stub" },
    ];
    expect(agents.filter((agent) => isPlaceholderHarness(agent.harness))).toHaveLength(2);
    expect(listableAgents(agents).map((agent) => agent.harness)).toEqual(["coordy-stub"]);
  });

  it("keeps a custom 智能体 name instead of replacing it with the CLI", () => {
    expect(agentDisplayName({ name: "前端审查", harness: "claude-acp" })).toBe("前端审查");
    expect(agentDisplayName({ name: "助手", harness: "acp" })).toBe("未对应任何 CLI");
    expect(
      agentDisplayName(
        { name: "助手", harness: "claude-acp" },
        [{ id: "claude-acp", name: "Claude Code", installed: true, command: "claude acp", source: "path" }],
      ),
    ).toBe("Claude Code");
  });

  it("only offers installed tools as selectable harnesses", () => {
    expect(
      selectableRuntimes([
        { id: "claude-acp", name: "Claude Code", installed: true, command: "claude acp", source: "path" },
        { id: "made-up", name: "Made Up", installed: false, command: "npx -y made-up", source: "registry" },
      ]).map((item) => item.id),
    ).toEqual(["claude-acp"]);
  });

  it("drafts 智能体 fields from a goal description", () => {
    const draft = draftAgentFromGoal("审查前端 Pull Request。\n只看 TypeScript。");
    expect(draft.name).toBe("审查前端 Pull Request");
    expect(draft.description).toContain("审查前端");
    expect(draft.instructions).toContain("只看 TypeScript");
  });

  it("uses Multica status words for issue columns", () => {
    expect(taskStatusLabel("review")).toBe("审核中");
    expect(taskStatusLabel("backlog")).toBe("待规划");
    expect(boardColumn("done")).toBe("done");
    expect(boardColumn("cancelled")).toBe("done");
  });

  it("maps harness ids onto Multica provider keys", () => {
    expect(providerKey("claude-acp")).toBe("claude");
    expect(providerKey("codex-acp")).toBe("codex");
    expect(providerKey("github-copilot-cli")).toBe("copilot");
  });

  it("writes empty-state copy for catalog create actions", () => {
    expect(emptyCreateHint("小队")).toBe("暂无小队。");
    expect(emptyCreateHint("Skill")).toBe("暂无 Skill。");
    expect(createActionLabel("小队")).toBe("新建小队");
    expect(createActionLabel("Skill")).toBe("新建 Skill");
  });

  it("keeps my-task lists to the current principal or agent", () => {
    const tasks: TaskView[] = [
      { id: "task_1", workspace_id: "ws", title: "我的", status: "open", assignee_principal_id: "p1" },
      { id: "task_2", workspace_id: "ws", title: "智能体的", status: "open", assignee_agent_id: "a1" },
      { id: "task_3", workspace_id: "ws", title: "别人的", status: "open", assignee_principal_id: "p2" },
    ];
    expect(tasksAssignedToMe(tasks, { principalId: "p1", agentId: null }).map((task) => task.id)).toEqual(["task_1"]);
    expect(tasksAssignedToMe(tasks, { principalId: "p1", agentId: "a1" }).map((task) => task.id)).toEqual([
      "task_1",
      "task_2",
    ]);
    expect(tasksAssignedToMe(tasks, { principalId: null, agentId: null })).toEqual([]);
  });

  it("keeps chat-backed tasks off the issue board", () => {
    const tasks: TaskView[] = [
      { id: "task_1", workspace_id: "ws", title: "修登录", status: "open" },
      { id: "task_2", workspace_id: "ws", title: "对话", status: "backlog", stage: "chat", labels: ["chat"] },
    ];
    expect(isChatIssue(tasks[1]!)).toBe(true);
    expect(boardIssues(tasks).map((task) => task.id)).toEqual(["task_1"]);
  });

  it("opens a chat turn by leaving backlog before StartRun", () => {
    expect(
      chatTurnCommands({
        chatId: "chat_1",
        taskId: "task_2",
        agentId: "agent_1",
        prompt: "你好",
      }),
    ).toEqual([
      { type: "SetTaskStatus", task_id: "task_2", status: "open" },
      { type: "AssignTask", task_id: "task_2", agent_id: "agent_1" },
      {
        type: "StartRun",
        task_id: "task_2",
        source: acpRunSource("你好"),
        agent_id: "agent_1",
        chat_id: "chat_1",
        trigger: "chat",
      },
    ]);
  });
});
