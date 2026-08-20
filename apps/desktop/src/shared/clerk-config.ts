export type ClerkClientConfig = {
  publishableKey: string;
  frontendOrigin: string;
};

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return globalThis.atob(padded);
  } catch {
    return null;
  }
}

export function parseClerkPublishableKey(
  value: string | undefined,
  approvedCustomOrigin?: string,
): ClerkClientConfig | null {
  const publishableKey = value?.trim();
  const match = publishableKey?.match(/^pk_(?:test|live)_([A-Za-z0-9_-]+)$/);
  if (!publishableKey || !match?.[1]) return null;

  const decoded = decodeBase64Url(match[1]);
  const host = decoded?.endsWith("$") ? decoded.slice(0, -1) : null;
  if (!host || host.includes("/") || host.includes(":")) return null;

  try {
    const origin = new URL(`https://${host}`).origin;
    if (new URL(origin).hostname !== host.toLowerCase()) return null;
    const approved = approvedCustomOrigin?.trim().replace(/\/$/, "");
    const clerkManaged = new URL(origin).hostname.endsWith(".clerk.accounts.dev");
    if (!clerkManaged && origin !== approved) return null;
    return { publishableKey, frontendOrigin: origin };
  } catch {
    return null;
  }
}
