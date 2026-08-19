import type { IpcMainInvokeEvent, WebContents } from "electron";
import type { DiscoveredAgentView } from "@coordy/protocol";
import type { DaemonManager } from "./daemon/daemon-manager";
import { IPC } from "../shared/ipc-channels";

type InvokeHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;

export type IpcHandlerRegistrar = {
  handle(channel: string, listener: InvokeHandler): void;
};

export type IpcHandlerDependencies = {
  ipcMain: IpcHandlerRegistrar;
  daemon: Pick<DaemonManager, "client">;
  validateSender(sender: WebContents): boolean;
  getAppInfo(): { version: string; os: string; cliPath: string; hostname: string };
  chooseRepository(): Promise<{ canceled: boolean; filePaths: string[] }>;
  revealFile(path: string): void;
  openTerminal(path: string): Promise<void>;
  listDirectory(path: string): unknown;
  installCli(): Promise<unknown> | unknown;
  canonicalHarnessId(id: string): string;
  discoverHarnessModels(runtime: DiscoveredAgentView): Promise<unknown>;
  quit(): void;
};

export function registerIpcHandlers(deps: IpcHandlerDependencies): void {
  const client = () => {
    if (!deps.daemon.client) throw new Error("daemon is not connected");
    return deps.daemon.client;
  };
  const handle = (
    channel: string,
    listener: (...args: unknown[]) => unknown,
  ) => {
    deps.ipcMain.handle(channel, (event, ...args) => {
      if (!deps.validateSender(event.sender)) throw new Error("invalid ipc sender");
      return listener(...args);
    });
  };

  handle(IPC.submit, (command) => client().submit(command as never));
  handle(IPC.view, (query) => client().view(query as never));
  handle(IPC.getAppInfo, () => deps.getAppInfo());
  handle(IPC.chooseRepository, async () => {
    const result = await deps.chooseRepository();
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle(IPC.revealFile, (path) => deps.revealFile(path as string));
  handle(IPC.openTerminal, (path) => deps.openTerminal(path as string));
  handle(IPC.listDirectory, (path) => {
    if (!path || typeof path !== "string") throw new Error("invalid path");
    return deps.listDirectory(path);
  });
  handle(IPC.installCli, () => deps.installCli());
  handle(IPC.suggestTaskSplit, (input) => {
    const request = input as {
      workspace_id?: unknown;
      task_id?: unknown;
      principal_id?: unknown;
    } | null;
    if (
      !request ||
      typeof request.workspace_id !== "string" ||
      typeof request.task_id !== "string" ||
      typeof request.principal_id !== "string"
    ) {
      throw new Error("invalid task split request");
    }
    return client().suggestTaskSplit({
      workspace_id: request.workspace_id,
      task_id: request.task_id,
      principal_id: request.principal_id,
    });
  });
  handle(IPC.discoverAgents, (refresh) =>
    client().discoverAgents(Boolean(refresh)),
  );
  handle(IPC.discoverHarnessModels, async (harness) => {
    if (!harness || typeof harness !== "string") {
      throw new Error("invalid harness");
    }
    const runtimes = (await client().discoverAgents(false)) as DiscoveredAgentView[];
    const wanted = deps.canonicalHarnessId(harness);
    const runtime = runtimes.find(
      (item) => deps.canonicalHarnessId(item.id) === wanted,
    );
    if (!runtime) throw new Error("unknown harness");
    return deps.discoverHarnessModels(runtime);
  });
  handle(IPC.importAgents, (input) => client().importAgents(input as never));
  handle(IPC.quit, () => deps.quit());
}
