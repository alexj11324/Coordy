import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from "electron";
import { join, resolve } from "path";
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
import { registerAuthIpc } from "./auth-ipc";
import { parseClerkPublishableKey } from "../shared/clerk-config";
import type { AuthSurface, SanitizedAuthState } from "../shared/auth-bridge";
import { ClerkOAuthClient, type ClerkOAuthConfig } from "./clerk-oauth";
import { EncryptedOAuthTokenStore } from "./oauth-token-store";
import { findOAuthCallback, registerCoordyProtocol } from "./oauth-deep-link";

const daemon = new DaemonManager({
  userDataPath: () => app.getPath("userData"),
  binaryPath: daemonBinaryPath,
});
let effectTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let productWindow: BrowserWindow | null = null;
const rawClerkKey = process.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkConfig = parseClerkPublishableKey(
  rawClerkKey,
  process.env.VITE_CLERK_APPROVED_ORIGIN,
);
const oauthClientId = process.env.VITE_CLERK_OAUTH_CLIENT_ID?.trim() ?? "";
const oauthConfig: ClerkOAuthConfig | null = clerkConfig && oauthClientId
  ? {
      issuer: clerkConfig.frontendOrigin,
      clientId: oauthClientId,
      redirectUri: "coordy://oauth/callback",
      scopes: ["openid", "profile", "email", "user:org:read"],
    }
  : null;
let oauthClient: ClerkOAuthClient | null = null;
const pendingOAuthCallbacks: string[] = [];
let authState: SanitizedAuthState = oauthConfig
  ? { status: "loading", identity: null, organization: null }
  : {
      status: rawClerkKey?.trim() ? "config-error" : "config-missing",
      identity: null,
      organization: null,
    };
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

const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.quit();

function receiveOAuthCallback(url: string): void {
  if (!url.startsWith("coordy://oauth/callback")) return;
  if (oauthClient) void completeOAuthCallback(url);
  else pendingOAuthCallbacks.push(url);
}

function publishAuthState(next: SanitizedAuthState): void {
  authState = next;
  productWindow?.webContents.send(IPC.authChanged, next);
}

async function openAuthSurface(surface: AuthSurface): Promise<void> {
  if (!oauthConfig || !oauthClient) return;
  if (surface === "sign-in" || surface === "organization-list") {
    try {
      const url = await oauthClient.beginAuthorization(surface === "organization-list");
      await shell.openExternal(url);
    } catch {
      publishAuthState({ status: "config-error", identity: null, organization: null });
    }
    return;
  }
  const path = surface === "profile"
    ? "/user"
    : surface === "create-organization"
      ? "/create-organization"
      : "/organization";
  await shell.openExternal(new URL(path, oauthConfig.issuer).href);
}

async function completeOAuthCallback(url: string): Promise<void> {
  if (!oauthClient) return;
  try {
    publishAuthState(await oauthClient.completeAuthorization(url));
    productWindow?.show();
    productWindow?.focus();
  } catch {
    publishAuthState({ status: "signed-out", identity: null, organization: null });
  }
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  receiveOAuthCallback(url);
});
app.on("second-instance", (_event, argv) => {
  const callback = findOAuthCallback(argv);
  if (callback) receiveOAuthCallback(callback);
  if (productWindow && !productWindow.isDestroyed()) {
    if (productWindow.isMinimized()) productWindow.restore();
    productWindow.show();
    productWindow.focus();
  }
});

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
  productWindow = window;
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
  window.on("closed", () => {
    if (productWindow !== window) return;
    productWindow = null;
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
    if (!isPrimaryInstance) return;
    if (process.platform !== "darwin") {
      Menu.setApplicationMenu(null);
    }
    await daemon.start();
    if (oauthConfig) {
      registerCoordyProtocol(
        (scheme, path, args) => app.setAsDefaultProtocolClient(scheme, path, args),
        app.isPackaged,
        process.execPath,
        process.argv[1] ? resolve(process.argv[1]) : undefined,
      );
      oauthClient = new ClerkOAuthClient(
        oauthConfig,
        new EncryptedOAuthTokenStore(
          join(app.getPath("userData"), "auth", "clerk-oauth-session"),
          safeStorage,
        ),
      );
      authState = await oauthClient.restore();
    }
    registerAuthIpc({
      handle: (channel, handler) => ipcMain.handle(channel, handler),
      productContents: () => productWindow?.webContents ?? null,
      state: () => authState,
      open: openAuthSurface,
      signOut: async () => {
        await oauthClient?.signOut();
        publishAuthState({ status: "signed-out", identity: null, organization: null });
      },
    });
    registerIpcHandlers({
      ipcMain,
      daemon,
      validateSender: (sender) => sender === productWindow?.webContents && validateIpcSender(sender),
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
    for (const callback of pendingOAuthCallbacks.splice(0)) {
      void completeOAuthCallback(callback);
    }
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
