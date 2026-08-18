import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc-channels";
import type { CoordyDesktopBridge } from "../shared/desktop-bridge";

const bridge: CoordyDesktopBridge = {
  submit: (command) => ipcRenderer.invoke(IPC.submit, command),
  view: (query) => ipcRenderer.invoke(IPC.view, query),
  subscribe: (listener) => {
    const handler = (_: unknown, effect: unknown) => listener(effect as never);
    ipcRenderer.on(IPC.effect, handler);
    return () => ipcRenderer.removeListener(IPC.effect, handler);
  },
  chooseRepository: () => ipcRenderer.invoke(IPC.chooseRepository),
  revealFile: (path) => ipcRenderer.invoke(IPC.revealFile, path),
  openTerminal: (path) => ipcRenderer.invoke(IPC.openTerminal, path),
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  installCli: () => ipcRenderer.invoke(IPC.installCli),
  secretsStatus: () => ipcRenderer.invoke(IPC.secretsStatus),
  setSecret: (input) => ipcRenderer.invoke(IPC.setSecret, input),
  clearSecret: () => ipcRenderer.invoke(IPC.clearSecret),
};

contextBridge.exposeInMainWorld("coordy", bridge);
