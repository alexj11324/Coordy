import type { WebContents } from "electron";

export function validateIpcSender(sender: WebContents): boolean {
  const url = sender.getURL();
  if (!url) return false;
  return (
    url.startsWith("file:") ||
    url.startsWith("http://localhost:") ||
    url.startsWith("http://127.0.0.1:")
  );
}

export const BROWSER_WINDOW_POLICY = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webviewTag: false,
} as const;

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'";
