export const OAUTH_CALLBACK_PREFIX = "coordy://oauth/callback";

export function findOAuthCallback(argv: readonly string[]): string | null {
  return argv.find((value) => value.startsWith(OAUTH_CALLBACK_PREFIX)) ?? null;
}

export function registerCoordyProtocol(
  setDefaultProtocolClient: (scheme: string, path?: string, args?: string[]) => boolean,
  packaged: boolean,
  executablePath: string,
  entryPath: string | undefined,
): boolean {
  if (packaged) return setDefaultProtocolClient("coordy");
  if (!entryPath) return false;
  return setDefaultProtocolClient("coordy", executablePath, [entryPath]);
}
