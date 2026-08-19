import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { join } from "path";
import { hostname } from "os";
import { IPC } from "../shared/ipc-channels";
import {
  BROWSER_WINDOW_POLICY,
  canOpenExternal,
  contentSecurityPolicy,
  isTrustedRendererUrl,
  validateIpcSender,
} from "./security/browser-window-policy";
import { DaemonManager } from "./daemon/daemon-manager";
import { cliBinaryPath, daemonBinaryPath } from "./daemon/daemon-binary-path";
import { createEffectPoller } from "./daemon/effect-poller";
import { installCliBinaries } from "./install-cli";
import { listDirectory } from "./list-directory";
import {
  canonicalModelDiscoveryHarnessId,
  discoverHarnessModels,
} from "./model-discovery";
import { resolvePreloadPath } from "./preload-path";
import { createIdempotentCleanup, registerAppLifecycle } from "./app-lifecycle";
import { openTerminalAt } from "./terminal-launch";
import { registerIpcHandlers } from "./ipc-handlers";

const daemon = new DaemonManager({
  userDataPath: () => app.getPath("userData"),
  binaryPath: daemonBinaryPath,
});
let effectTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;
const cleanup = createIdempotentCleanup(() => {
  if (effectTimer) {
    clearInterval(effectTimer);
    effectTimer = null;
  }
  daemon.stop();
});

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
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 14 },
        }
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
  window.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [contentSecurityPolicy()],
        },
      });
    },
  );
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) {
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

registerAppLifecycle({
  app,
  platform: process.platform,
  initialized: () => initialized,
  windowCount: () => BrowserWindow.getAllWindows().length,
  createWindow,
  cleanup,
});

app
  .whenReady()
  .then(async () => {
    if (process.platform !== "darwin") {
      Menu.setApplicationMenu(null);
    }
    await daemon.start();
    registerIpcHandlers({
      ipcMain,
      daemon,
      validateSender: validateIpcSender,
      getAppInfo: () => ({
        version: app.getVersion(),
        os: process.platform,
        cliPath: cliBinaryPath(),
        hostname: hostname(),
      }),
      chooseRepository: () =>
        dialog.showOpenDialog({
          properties: ["openDirectory"],
        }),
      revealFile: (path) => shell.showItemInFolder(path),
      openTerminal: openTerminalAt,
      listDirectory,
      installCli: installCliBinaries,
      canonicalHarnessId: canonicalModelDiscoveryHarnessId,
      discoverHarnessModels,
      quit: () => app.quit(),
    });
    initialized = true;
    createWindow();
    const poll = createEffectPoller({
      client: () => daemon.effectClient,
      disconnect: () => daemon.disconnectEffectClient(),
      reconnect: () => daemon.reconnectEffectClient(),
      onHealth: (healthy) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.effect, { type: "StreamHealth", healthy });
        }
      },
      onEffects: (effects) => {
        for (const win of BrowserWindow.getAllWindows()) {
          for (const effect of effects)
            win.webContents.send(IPC.effect, effect);
        }
      },
    });
    effectTimer = setInterval(() => void poll(), 400);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(error);
    cleanup();
    dialog.showErrorBox("Coordy 无法启动", message);
    app.quit();
  });
