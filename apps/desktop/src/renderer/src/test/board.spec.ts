import { describe, expect, it, vi } from "vitest";
import {
  acpRunSource,
  chatTurnCommands,
  normalizedAgentId,
  resolveAgentId,
  startAcpRun,
  taskSplitRequest,
} from "../lib/coordy/start-task";
import { draftAgentFromGoal } from "../lib/coordy/agent-draft";
import {
  agentDisplayName,
  catalogItemForHarness,
  createActionLabel,
  emptyCreateHint,
  listableAgents,
  pickerRuntimes,
  providerKey,
  selectableRuntimes,
  taskStatusLabel,
} from "../lib/coordy/labels";
import {
  boardIssues,
  isChatIssue,
  tasksAssignedToMe,
} from "../lib/coordy/issues";
import {
  asTasks,
  activeHomeRun,
  boardColumn,
  isPlaceholderHarness,
  latestRunForTask,
  outcomeId,
} from "../lib/coordy/views";
import type { AgentView, RunView, TaskView, View } from "@coordy/protocol";
import { useSession } from "../state/session-store";

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

  it("asks the assigned Harness for a split without a second model or key payload", () => {
    expect(
      taskSplitRequest({
        workspaceId: "ws",
        taskId: "task",
        principalId: "principal",
      }),
    ).toEqual({
      workspace_id: "ws",
      task_id: "task",
      principal_id: "principal",
    });
  });

  it("puts running and review tasks in kanban columns", () => {
    expect(boardColumn("open")).toBe("open");
    expect(boardColumn("running")).toBe("running");
    expect(boardColumn("review")).toBe("review");
    expect(boardColumn("blocked")).toBe("blocked");
  });

  it("picks the latest run for a task", () => {
    const runs: RunView[] = [
      {
        id: "run_1",
        task_id: "t1",
        agent_id: "a",
        status: "completed",
        harness: "claude-acp",
        compaction_count: 0,
      },
      {
        id: "run_2",
        task_id: "t1",
        agent_id: "a",
        status: "running",
        harness: "claude-acp",
        compaction_count: 0,
      },
      {
        id: "run_3",
        task_id: "t2",
        agent_id: "a",
        status: "completed",
        harness: "claude-acp",
        compaction_count: 0,
      },
    ];
    expect(latestRunForTask(runs, "t1")?.id).toBe("run_2");
  });

  it("keeps every Home progress action on the pinned run", () => {
    const runs: RunView[] = [
      { id: "run_old", task_id: "task_old", agent_id: "a", status: "running", harness: "codex", compaction_count: 0 },
      { id: "run_new", task_id: "task_new", agent_id: "a", status: "running", harness: "codex", compaction_count: 0 },
    ];
    expect(activeHomeRun(runs, "run_old")).toMatchObject({ id: "run_old", task_id: "task_old" });
    expect(activeHomeRun(runs, null)?.id).toBe("run_new");
  });

  it("does not carry a pinned Home run into another workspace run list", () => {
    const workspaceARuns: RunView[] = [
      { id: "run_a", task_id: "task_a", agent_id: "agent_a", status: "running", harness: "codex", compaction_count: 0 },
    ];
    const workspaceBRuns: RunView[] = [
      { id: "run_b", task_id: "task_b", agent_id: "agent_b", status: "running", harness: "codex", compaction_count: 0 },
    ];
    expect(activeHomeRun(workspaceARuns, "run_a")?.id).toBe("run_a");
    expect(activeHomeRun(workspaceBRuns, "run_a")).toBeUndefined();
    expect(activeHomeRun(workspaceBRuns, null)?.id).toBe("run_b");
  });

  it("keeps a pending Home dispatch on its invocation actor after a workspace switch", async () => {
    let resolveAgents!: (value: unknown) => void;
    const agentsResult = new Promise((resolve) => {
      resolveAgents = resolve;
    });
    const submitMock = vi.fn(async (envelope: {
      actor: { type: string; id?: string };
      command: { type: string };
    }) => {
      if (envelope.command.type === "CreateTask") {
        return { message: "created", ids: { task_id: "task_a" }, blocked: false };
      }
      if (envelope.command.type === "AssignTask") {
        return { message: "assigned", ids: {}, blocked: false };
      }
      return { message: "started", ids: { run_id: "run_a" }, blocked: false };
    });
    const viewMock = vi.fn(async () => agentsResult);
    const previousWindow = Reflect.get(globalThis, "window");
    Reflect.set(globalThis, "window", {
      coordy: { view: viewMock, submit: submitMock },
    });
    useSession.getState().setWorkspace("workspace_a");
    useSession.getState().setPrincipal("principal_a");

    try {
      const pending = startAcpRun({
        workspaceId: "workspace_a",
        principalId: "principal_a",
        title: "A task",
        prompt: "A prompt",
        agentId: "agent_a",
      });
      await vi.waitFor(() => expect(viewMock).toHaveBeenCalledTimes(1));
      useSession.getState().setWorkspace("workspace_b");
      useSession.getState().setPrincipal("principal_b");
      resolveAgents({
        type: "Agents",
        items: [{ id: "agent_a", workspace_id: "workspace_a", principal_id: "principal_a", name: "A", harness: "codex" }],
      });
      await expect(pending).resolves.toMatchObject({ taskId: "task_a", runId: "run_a" });
      expect(submitMock.mock.calls.map(([envelope]) => envelope.actor)).toEqual([
        { type: "principal", id: "principal_a" },
        { type: "principal", id: "principal_a" },
        { type: "principal", id: "principal_a" },
      ]);
    } finally {
      if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
      else Reflect.set(globalThis, "window", previousWindow);
    }
  });

  it("hides leftover placeholder agents that are not a real CLI", () => {
    const agents: AgentView[] = [
      {
        id: "ag_1",
        workspace_id: "ws",
        principal_id: "p",
        name: "助手",
        harness: "acp",
      },
      {
        id: "ag_2",
        workspace_id: "ws",
        principal_id: "p",
        name: "助手",
        harness: "acp",
      },
      {
        id: "ag_3",
        workspace_id: "ws",
        principal_id: "p",
        name: "Coordy 演示",
        harness: "coordy-stub",
      },
    ];
    expect(
      agents.filter((agent) => isPlaceholderHarness(agent.harness)),
    ).toHaveLength(2);
    expect(listableAgents(agents).map((agent) => agent.harness)).toEqual([
      "coordy-stub",
    ]);
  });

  it("keeps a custom 智能体 name instead of replacing it with the CLI", () => {
    expect(agentDisplayName({ name: "前端审查", harness: "claude-acp" })).toBe(
      "前端审查",
    );
    expect(agentDisplayName({ name: "助手", harness: "acp" })).toBe(
      "未对应任何 CLI",
    );
    expect(
      agentDisplayName({ name: "助手", harness: "claude-acp" }, [
        {
          id: "claude",
          name: "Claude Code",
          installed: true,
          command: "claude -p --output-format stream-json",
          source: "path",
          protocol_family: "claude",
        },
      ]),
    ).toBe("Claude Code");
    expect(
      catalogItemForHarness(
        [
          {
            id: "claude",
            name: "Claude Code",
            installed: true,
            command: "claude -p",
            source: "path",
          },
        ],
        "claude-acp",
      )?.id,
    ).toBe("claude");
  });

  it("offers only locally installed tools as selectable harnesses", () => {
    expect(
      selectableRuntimes([
        {
          id: "claude",
          name: "Claude Code",
          installed: true,
          command: "claude -p --output-format stream-json",
          source: "path",
        },
        {
          id: "made-up",
          name: "Made Up",
          installed: false,
          command: "npx -y made-up",
          source: "registry",
        },
      ]).map((item) => item.id),
    ).toEqual(["claude"]);
    expect(
      pickerRuntimes(
        [
          {
            id: "claude",
            name: "Claude Code",
            installed: true,
            command: "claude -p",
            source: "path",
          },
          {
            id: "codex",
            name: "Codex",
            installed: true,
            command: "codex exec --json",
            source: "path",
          },
        ],
        "claude-acp",
      ).map((item) => item.id),
    ).toEqual(["claude", "codex"]);
  });

  it("drafts 智能体 fields from a goal description", () => {
    const draft = draftAgentFromGoal(
      "审查前端 Pull Request。\n只看 TypeScript。",
    );
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
      {
        id: "task_1",
        workspace_id: "ws",
        title: "我的",
        status: "open",
        assignee_principal_id: "p1",
      },
      {
        id: "task_2",
        workspace_id: "ws",
        title: "智能体的",
        status: "open",
        assignee_agent_id: "a1",
      },
      {
        id: "task_3",
        workspace_id: "ws",
        title: "别人的",
        status: "open",
        assignee_principal_id: "p2",
      },
    ];
    expect(
      tasksAssignedToMe(tasks, { principalId: "p1", agentId: null }).map(
        (task) => task.id,
      ),
    ).toEqual(["task_1"]);
    expect(
      tasksAssignedToMe(tasks, { principalId: "p1", agentId: "a1" }).map(
        (task) => task.id,
      ),
    ).toEqual(["task_1", "task_2"]);
    expect(
      tasksAssignedToMe(tasks, { principalId: null, agentId: null }),
    ).toEqual([]);
  });

  it("keeps assigned chat backing tasks out of my tasks", () => {
    const tasks: TaskView[] = [
      { id: "task_1", workspace_id: "ws", title: "我的", status: "open", assignee_principal_id: "p1" },
      { id: "task_chat", workspace_id: "ws", title: "对话", status: "backlog", stage: "chat", labels: ["chat"], assignee_principal_id: "p1", assignee_agent_id: "a1" },
    ];
    expect(tasksAssignedToMe(boardIssues(tasks), { principalId: "p1", agentId: "a1" }).map((task) => task.id)).toEqual(["task_1"]);
  });

  it("normalizes workspace selections but rejects an explicit stale agent at dispatch", () => {
    const agents: AgentView[] = [
      { id: "agent_b", workspace_id: "workspace_b", principal_id: "p", name: "B", harness: "codex" },
    ];
    expect(normalizedAgentId(agents, "agent_from_workspace_a")).toBe("agent_b");
    expect(() => resolveAgentId(agents, "agent_from_workspace_a")).toThrow("不属于当前工作区");
    expect(resolveAgentId(agents, "agent_b")).toBe("agent_b");
  });

  it("keeps chat-backed tasks off the issue board", () => {
    const tasks: TaskView[] = [
      { id: "task_1", workspace_id: "ws", title: "修登录", status: "open" },
      {
        id: "task_2",
        workspace_id: "ws",
        title: "对话",
        status: "backlog",
        stage: "chat",
        labels: ["chat"],
      },
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
