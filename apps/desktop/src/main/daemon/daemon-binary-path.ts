import { app } from "electron";
import { join } from "path";

export function daemonBinaryPath(): string {
  const name = process.platform === "win32" ? "coordyd.exe" : "coordyd";
  if (app.isPackaged) {
    return join(process.resourcesPath, "bin", name);
  }
  return join(app.getAppPath(), "..", "..", "target", "debug", name);
}
