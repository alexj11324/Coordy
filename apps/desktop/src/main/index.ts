import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { join } from "path";
import { exec } from "child_process";
import { IPC } from "../shared/ipc-channels";
import {
  BROWSER_WINDOW_POLICY,
  contentSecurityPolicy,
  validateIpcSender,
} from "./security/browser-window-policy";
import { DaemonManager } from "./daemon/daemon-manager";
import { cliBinaryPath } from "./daemon/daemon-binary-path";
import { installCliBinaries } from "./install-cli";
import { listDirectory } from "./list-directory";
import { resolvePreloadPath } from "./preload-path";

const daemon = new DaemonManager();

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 520,
    title: "Coordy",
    backgroundColor: "#fafafa",
    autoHideMenuBar: true,
    webPreferences: {
      ...BROWSER_WINDOW_POLICY,
      preload: resolvePreloadPath(__dirname),
    },
  });
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [contentSecurityPolicy()],
      },
    });
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://localhost") && !url.startsWith("file:")) {
      event.preventDefault();
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function guard(event: Electron.IpcMainInvokeEvent) {
  if (!validateIpcSender(event.sender)) {
    throw new Error("invalid ipc sender");
  }
}

app.whenReady().then(async () => {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
  }
  await daemon.start();
  ipcMain.handle(IPC.submit, (event, command) => {
    guard(event);
    return daemon.client!.submit(command);
  });
  ipcMain.handle(IPC.view, (event, query) => {
    guard(event);
    return daemon.client!.view(query);
  });
  ipcMain.handle(IPC.getAppInfo, (event) => {
    guard(event);
    return {
      version: app.getVersion(),
      os: process.platform,
      cliPath: cliBinaryPath(),
    };
  });
  ipcMain.handle(IPC.chooseRepository, async (event) => {
    guard(event);
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle(IPC.revealFile, async (event, path: string) => {
    guard(event);
    shell.showItemInFolder(path);
  });
  ipcMain.handle(IPC.openTerminal, async (event, path: string) => {
    guard(event);
    await openTerminalAt(path);
  });
  ipcMain.handle(IPC.listDirectory, (event, path: string) => {
    guard(event);
    if (!path || typeof path !== "string") {
      throw new Error("invalid path");
    }
    return listDirectory(path);
  });
  ipcMain.handle(IPC.installCli, async (event) => {
    guard(event);
    return installCliBinaries();
  });
  ipcMain.handle(IPC.secretsStatus, (event) => {
    guard(event);
    return daemon.client!.secretsStatus();
  });
  ipcMain.handle(IPC.setSecret, (event, input: unknown) => {
    guard(event);
    return daemon.client!.setSecret(input as {
      provider: string;
      api_key?: string | null;
      base_url?: string | null;
      acp_command?: string | null;
    });
  });
  ipcMain.handle(IPC.clearSecret, (event) => {
    guard(event);
    return daemon.client!.clearSecret();
  });
  ipcMain.handle(IPC.discoverAgents, (event, refresh?: boolean) => {
    guard(event);
    return daemon.client!.discoverAgents(Boolean(refresh));
  });
  ipcMain.handle(IPC.importAgents, (event, input: unknown) => {
    guard(event);
    return daemon.client!.importAgents(input as {
      workspace_id: string;
      principal_id: string;
      ids?: string[] | null;
    });
  });
  createWindow();
  let cursor = 0;
  const timer = setInterval(async () => {
    if (!daemon.client) return;
    try {
      const effects = (await daemon.client.subscribe(cursor)) as unknown;
      if (!Array.isArray(effects) || effects.length === 0) return;
      cursor += effects.length;
      for (const win of BrowserWindow.getAllWindows()) {
        for (const effect of effects) {
          win.webContents.send(IPC.effect, effect);
        }
      }
    } catch {
      /* daemon may be restarting */
    }
  }, 400);
  app.on("before-quit", () => {
    clearInterval(timer);
    daemon.stop();
  });
});

function openTerminalAt(path: string): Promise<void> {
  const quoted = path.replace(/"/g, '\\"');
  const command =
    process.platform === "darwin"
      ? `open -a Terminal "${quoted}"`
      : process.platform === "win32"
        ? `start cmd /K cd /d "${quoted}"`
        : [
            `x-terminal-emulator --working-directory="${quoted}"`,
            `xfce4-terminal --working-directory="${quoted}"`,
            `gnome-terminal --working-directory="${quoted}"`,
            `xterm -e "cd \\"${quoted}\\" && exec $SHELL"`,
          ].join(" || ");
  return new Promise((resolve, reject) => {
    exec(command, (error) => {
      if (error) reject(new Error(`无法打开终端：${error.message}`));
      else resolve();
    });
  });
}
