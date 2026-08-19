import type { WebContents } from "electron";

export function validateIpcSender(sender: WebContents): boolean {
  return isTrustedRendererUrl(sender.getURL());
}

export function isTrustedRendererUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return true;
    return (
      parsed.protocol === "http:" &&
      Boolean(parsed.port) &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

export const BROWSER_WINDOW_POLICY = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webviewTag: false,
} as const;

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.agentclientprotocol.com; connect-src 'self'";

export const DEV_CSP =
  "default-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* http://127.0.0.1:*; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.agentclientprotocol.com; connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*";

export function contentSecurityPolicy(): string {
  return process.env.ELECTRON_RENDERER_URL ? DEV_CSP : CSP;
}

export const EXTERNAL_LINK_ALLOWLIST = [
  "https://discord.com/",
  "https://discord.gg/",
  "https://github.com/",
] as const;

export function canOpenExternal(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return EXTERNAL_LINK_ALLOWLIST.some(
      (allowed) => parsed.origin === new URL(allowed).origin,
    );
  } catch {
    return false;
  }
}
