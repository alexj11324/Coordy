import type { IpcMainInvokeEvent, WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC } from "../../shared/ipc-channels";
import {
  registerIpcHandlers,
  type IpcHandlerDependencies,
} from "../ipc-handlers";

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

describe("guarded main IPC handlers", () => {
  let handlers: Map<string, Handler>;
  let deps: IpcHandlerDependencies;
  let client: Record<string, ReturnType<typeof vi.fn>>;
  const validSender = {} as WebContents;
  const validEvent = { sender: validSender } as IpcMainInvokeEvent;
  const invalidEvent = { sender: {} as WebContents } as IpcMainInvokeEvent;

  beforeEach(() => {
    handlers = new Map();
    client = {
      submit: vi.fn(async () => ({ message: "ok", ids: {}, blocked: false })),
      view: vi.fn(async () => ({ type: "Workspaces", items: [] })),
      suggestTaskSplit: vi.fn(async () => ({ titles: ["one", "two"] })),
      discoverAgents: vi.fn(async () => [
        {
          id: "coordy-stub",
          name: "Stub",
          installed: true,
          command: "coordy acp-stub",
          source: "stub",
        },
      ]),
      importAgents: vi.fn(async () => ({ imported: [], skipped: [] })),
    };
    deps = {
      ipcMain: {
        handle: (channel, listener) => handlers.set(channel, listener),
      },
      daemon: { client: client as never },
      validateSender: (sender) => sender === validSender,
      getAppInfo: () => ({ version: "test", os: "test", cliPath: "/tmp/coordy", hostname: "test" }),
      chooseRepository: vi.fn(async () => ({ canceled: false, filePaths: ["/tmp/repo"] })),
      revealFile: vi.fn(),
      openTerminal: vi.fn(async () => undefined),
      listDirectory: vi.fn(() => []),
      installCli: vi.fn(async () => ({ ok: true, message: "installed" })),
      canonicalHarnessId: (id) =>
        ({ "codex-acp": "codex" })[id] ?? id,
      discoverHarnessModels: vi.fn(async () => ({
        models: [],
        model_selection_supported: false,
        source: "unavailable",
      })),
      quit: vi.fn(),
    };
    registerIpcHandlers(deps);
  });

  it("registers every retained invoke channel exactly once", () => {
    expect([...handlers.keys()].sort()).toEqual(
      Object.entries(IPC)
        .filter(([key]) => key !== "effect" && key !== "subscribe")
        .map(([, channel]) => channel)
        .sort(),
    );
  });

  it("rejects an invalid sender before every retained handler", () => {
    for (const [channel, handler] of handlers) {
      expect(() => handler(invalidEvent), channel).toThrow("invalid ipc sender");
    }
    expect(client.submit).not.toHaveBeenCalled();
  });

  it("forwards every valid handler through its success boundary", async () => {
    const calls: Array<[string, unknown[]]> = [
      [IPC.submit, [{ actor: { type: "daemon" }, command: { type: "CreateWorkspace", name: "x" } }]],
      [IPC.view, [{ actor: { type: "daemon" }, query: { type: "Workspaces" } }]],
      [IPC.getAppInfo, []],
      [IPC.chooseRepository, []],
      [IPC.revealFile, ["/tmp/file"]],
      [IPC.openTerminal, ["/tmp"]],
      [IPC.listDirectory, ["/tmp"]],
      [IPC.installCli, []],
      [IPC.suggestTaskSplit, [{ workspace_id: "ws", task_id: "task", principal_id: "p" }]],
      [IPC.discoverAgents, [true]],
      [IPC.discoverHarnessModels, ["coordy-stub"]],
      [IPC.importAgents, [{ workspace_id: "ws", principal_id: "p" }]],
      [IPC.quit, []],
    ];

    for (const [channel, args] of calls) {
      await expect(Promise.resolve(handlers.get(channel)!(validEvent, ...args)), channel).resolves.not.toThrow();
    }

    expect(client.submit).toHaveBeenCalledOnce();
    expect(client.view).toHaveBeenCalledOnce();
    expect(deps.discoverHarnessModels).toHaveBeenCalledWith(
      expect.objectContaining({ id: "coordy-stub" }),
    );
    expect(deps.quit).toHaveBeenCalledOnce();
  });

  it("matches legacy model-discovery ids through the canonical runtime id", async () => {
    client.discoverAgents.mockResolvedValueOnce([
      {
        id: "codex",
        name: "Codex",
        installed: true,
        command: "codex acp",
        source: "path",
      },
    ]);
    await handlers.get(IPC.discoverHarnessModels)!(validEvent, "codex-acp");
    expect(deps.discoverHarnessModels).toHaveBeenCalledWith(
      expect.objectContaining({ id: "codex" }),
    );
  });

  it("keeps validation and downstream failures observable", async () => {
    expect(() => handlers.get(IPC.listDirectory)!(validEvent, "")).toThrow("invalid path");
    expect(() => handlers.get(IPC.suggestTaskSplit)!(validEvent, {})).toThrow(
      "invalid task split request",
    );
    await expect(
      Promise.resolve(handlers.get(IPC.discoverHarnessModels)!(validEvent, "missing")),
    ).rejects.toThrow("unknown harness");

    client.submit.mockRejectedValueOnce(new Error("kernel rejected"));
    await expect(
      Promise.resolve(handlers.get(IPC.submit)!(validEvent, { command: {} })),
    ).rejects.toThrow("kernel rejected");
  });
});
