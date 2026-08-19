import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { join } from "path";
import { hostname } from "os";
import { exec } from "child_process";
import { IPC } from "../shared/ipc-channels";
import {
  BROWSER_WINDOW_POLICY,
  canOpenExternal,
  contentSecurityPolicy,
  validateIpcSender,
} from "./security/browser-window-policy";
import { DaemonManager } from "./daemon/daemon-manager";
import { cliBinaryPath } from "./daemon/daemon-binary-path";
import { createEffectPoller } from "./daemon/effect-poller";
import { installCliBinaries } from "./install-cli";
import { listDirectory } from "./list-directory";
import { resolvePreloadPath } from "./preload-path";

const daemon = new DaemonManager();

if (process.platform === "linux" && process.env.ELECTRON_ENABLE_GPU !== "1") {
  app.disableHardwareAcceleration();
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 520,
    title: "Coordy",
    backgroundColor: "#fafafa",
    autoHideMenuBar: true,
    show: false,
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    webPreferences: {
      ...BROWSER_WINDOW_POLICY,
      preload: resolvePreloadPath(__dirname),
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (canOpenExternal(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
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
    if (
      !url.startsWith("http://localhost") &&
      !url.startsWith("http://127.0.0.1") &&
      !url.startsWith("file:")
    ) {
      event.preventDefault();
    }
  });
  const reveal = () => {
    if (window.isDestroyed() || window.isVisible()) return;
    window.show();
    window.focus();
  };
  window.once("ready-to-show", reveal);
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`window failed to load (${code}) ${description} ${url}`);
    reveal();
  });
  setTimeout(reveal, 8000);
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
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
      hostname: hostname(),
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
  ipcMain.handle(IPC.completeDraft, (event, kind: string, prompt: string) => {
    guard(event);
    if (!kind || typeof kind !== "string" || typeof prompt !== "string") {
      throw new Error("invalid draft request");
    }
    return daemon.client!.completeDraft(kind, prompt);
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
  ipcMain.handle(IPC.quit, (event) => {
    guard(event);
    app.quit();
  });
  createWindow();
  const poll = createEffectPoller({
    client: () => daemon.client,
    disconnect: () => daemon.disconnect(),
    reconnect: () => daemon.reconnect(),
    onHealth: (healthy) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.effect, { type: "StreamHealth", healthy });
      }
    },
    onEffects: (effects) => {
      for (const win of BrowserWindow.getAllWindows()) {
        for (const effect of effects) win.webContents.send(IPC.effect, effect);
      }
    },
  });
  const timer = setInterval(() => void poll(), 400);
  app.on("before-quit", () => {
    clearInterval(timer);
    daemon.stop();
  });
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  dialog.showErrorBox("Coordy 无法启动", message);
  app.quit();
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
