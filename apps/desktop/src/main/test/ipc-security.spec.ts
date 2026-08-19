import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CSP,
  DEV_CSP,
  canOpenExternal,
  contentSecurityPolicy,
  isTrustedRendererUrl,
  validateIpcSender,
} from "../security/browser-window-policy";
import { resolvePreloadPath } from "../preload-path";
import { IPC } from "../../shared/ipc-channels";

describe("ipc sender policy", () => {
  it("accepts localhost renderer urls", () => {
    const fake = {
      getURL: () => "http://localhost:5173/",
    } as Electron.WebContents;
    expect(validateIpcSender(fake)).toBe(true);
  });

  it("rejects remote urls", () => {
    const fake = {
      getURL: () => "https://evil.example/",
    } as Electron.WebContents;
    expect(validateIpcSender(fake)).toBe(false);
  });

  it("rejects localhost-looking URLs whose real host is remote", () => {
    expect(isTrustedRendererUrl("http://localhost:5173/")).toBe(true);
    expect(isTrustedRendererUrl("http://127.0.0.1:5173/")).toBe(true);
    const userInfoSpoof = new URL("http://evil.example/");
    userInfoSpoof.username = "localhost";
    userInfoSpoof.password = "5173";
    expect(isTrustedRendererUrl(userInfoSpoof.href)).toBe(false);
    expect(isTrustedRendererUrl("http://localhost.evil.example:5173/")).toBe(
      false,
    );
    expect(isTrustedRendererUrl("https://localhost:5173/")).toBe(false);
  });
});

describe("content security policy", () => {
  const original = process.env.ELECTRON_RENDERER_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.ELECTRON_RENDERER_URL;
    else process.env.ELECTRON_RENDERER_URL = original;
  });

  it("allows the Vite renderer in development", () => {
    process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
    expect(contentSecurityPolicy()).toBe(DEV_CSP);
    expect(contentSecurityPolicy()).toContain("unsafe-eval");
    expect(contentSecurityPolicy()).toContain("127.0.0.1");
  });

  it("keeps the production policy strict", () => {
    delete process.env.ELECTRON_RENDERER_URL;
    expect(contentSecurityPolicy()).toBe(CSP);
    expect(contentSecurityPolicy()).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy()).toContain(
      "img-src 'self' data: https://cdn.agentclientprotocol.com",
    );
    expect(contentSecurityPolicy()).not.toContain("dicebear.com");
  });
});

describe("preload path", () => {
  it("prefers a CommonJS preload over missing files", () => {
    const root = mkdtempSync(join(tmpdir(), "coordy-preload-"));
    const mainDir = join(root, "out", "main");
    const preloadDir = join(root, "out", "preload");
    mkdirSync(mainDir, { recursive: true });
    mkdirSync(preloadDir, { recursive: true });
    const cjs = join(preloadDir, "index.cjs");
    writeFileSync(cjs, "module.exports = {}");
    expect(resolvePreloadPath(mainDir)).toBe(cjs);
  });

  it("does not fall back to ESM preload", () => {
    const root = mkdtempSync(join(tmpdir(), "coordy-preload-"));
    const mainDir = join(root, "out", "main");
    const preloadDir = join(root, "out", "preload");
    mkdirSync(mainDir, { recursive: true });
    mkdirSync(preloadDir, { recursive: true });
    writeFileSync(join(preloadDir, "index.mjs"), "export {}");
    expect(() => resolvePreloadPath(mainDir)).toThrow(
      /preload script not found/,
    );
  });
});

describe("product ipc channels", () => {
  it("does not expose the retired model-key controls", () => {
    expect(Object.values(IPC)).not.toContain("coordy:secrets-status");
    expect(Object.values(IPC)).not.toContain("coordy:set-secret");
    expect(Object.values(IPC)).not.toContain("coordy:clear-secret");
    expect(IPC.suggestTaskSplit).toBe("coordy:suggest-task-split");
    expect(IPC.discoverAgents).toBe("coordy:discover-agents");
    expect(IPC.discoverHarnessModels).toBe("coordy:discover-harness-models");
    expect(IPC.importAgents).toBe("coordy:import-agents");
    expect(IPC.listDirectory).toBe("coordy:list-directory");
    expect(IPC.quit).toBe("coordy:quit");
  });
});

describe("external link allowlist", () => {
  it("only opens approved HTTPS origins from the shell", () => {
    expect(canOpenExternal("https://discord.com/invite/coordy")).toBe(true);
    expect(canOpenExternal("https://discord.gg/coordy")).toBe(true);
    expect(canOpenExternal("https://github.com/alexj11324/Coordy/pull/7")).toBe(
      true,
    );
    expect(
      canOpenExternal(
        "https://github.com.evil.example/alexj11324/Coordy/pull/7",
      ),
    ).toBe(false);
    expect(canOpenExternal("https://evil.example/")).toBe(false);
    expect(canOpenExternal("http://discord.com/")).toBe(false);
  });
});
