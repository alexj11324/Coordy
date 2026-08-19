import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CoordyDesktopBridge } from "../../shared/desktop-bridge";
import { IPC } from "../../shared/ipc-channels";

const electron = vi.hoisted(() => {
  const invocations: Array<{ channel: string; args: unknown[] }> = [];
  let exposed: CoordyDesktopBridge | null = null;
  let effectHandler: ((event: unknown, payload: unknown) => void) | null = null;
  return {
    invocations,
    get exposed() {
      return exposed;
    },
    setExposed(value: CoordyDesktopBridge) {
      exposed = value;
    },
    get effectHandler() {
      return effectHandler;
    },
    contextBridge: {
      exposeInMainWorld: vi.fn((_name: string, bridge: CoordyDesktopBridge) => {
        exposed = bridge;
      }),
    },
    ipcRenderer: {
      invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
        invocations.push({ channel, args });
        return undefined;
      }),
      on: vi.fn((_channel: string, handler: (event: unknown, payload: unknown) => void) => {
        effectHandler = handler;
      }),
      removeListener: vi.fn(),
    },
  };
});

vi.mock("electron", () => ({
  contextBridge: electron.contextBridge,
  ipcRenderer: electron.ipcRenderer,
}));

describe("preload bridge contract", () => {
  beforeAll(async () => {
    await import("../../preload/index");
  });

  it("exposes every retained request method on its declared IPC channel", async () => {
    const bridge = electron.exposed;
    if (!bridge) throw new Error("preload bridge was not exposed");

    await bridge.submit({ actor: { type: "daemon" }, command: { type: "CreateWorkspace", name: "x" } });
    await bridge.view({ actor: { type: "daemon" }, query: { type: "Workspaces" } });
    await bridge.chooseRepository();
    await bridge.revealFile("/tmp/file");
    await bridge.openTerminal("/tmp");
    await bridge.listDirectory("/tmp");
    await bridge.getAppInfo();
    await bridge.installCli();
    await bridge.suggestTaskSplit({ workspace_id: "ws", task_id: "task", principal_id: "p" });
    await bridge.discoverAgents(true);
    await bridge.discoverHarnessModels("coordy-stub");
    await bridge.importAgents({ workspace_id: "ws", principal_id: "p" });
    await bridge.quit();

    expect(electron.invocations.map((call) => call.channel)).toEqual([
      IPC.submit,
      IPC.view,
      IPC.chooseRepository,
      IPC.revealFile,
      IPC.openTerminal,
      IPC.listDirectory,
      IPC.getAppInfo,
      IPC.installCli,
      IPC.suggestTaskSplit,
      IPC.discoverAgents,
      IPC.discoverHarnessModels,
      IPC.importAgents,
      IPC.quit,
    ]);
  });

  it("forwards effects and removes exactly the registered listener", () => {
    const bridge = electron.exposed;
    if (!bridge) throw new Error("preload bridge was not exposed");
    const listener = vi.fn();

    const unsubscribe = bridge.subscribe(listener);
    electron.effectHandler?.({}, { type: "StreamHealth", healthy: true });
    unsubscribe();

    expect(electron.ipcRenderer.on).toHaveBeenCalledWith(IPC.effect, expect.any(Function));
    expect(listener).toHaveBeenCalledWith({ type: "StreamHealth", healthy: true });
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC.effect,
      electron.effectHandler,
    );
  });
});
