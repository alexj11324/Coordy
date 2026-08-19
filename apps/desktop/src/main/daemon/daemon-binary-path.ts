import { app } from "electron";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";

export function developmentWorkspaceRoot(
  appPath: string,
  exists: (path: string) => boolean = existsSync,
): string {
  let candidate = resolve(appPath);
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      exists(join(candidate, "Cargo.toml")) &&
      exists(join(candidate, "apps", "desktop", "package.json"))
    ) {
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Coordy workspace root not found from ${appPath}`);
}

export function daemonBinaryPath(): string {
  const name = process.platform === "win32" ? "coordyd.exe" : "coordyd";
  if (app.isPackaged) {
    return join(process.resourcesPath, "bin", name);
  }
  return join(developmentWorkspaceRoot(app.getAppPath()), "target", "debug", name);
}

export function cliBinaryPath(): string {
  return daemonBinaryPath().replace(/coordyd\.exe$/i, "coordy.exe").replace(/coordyd$/, "coordy");
}
