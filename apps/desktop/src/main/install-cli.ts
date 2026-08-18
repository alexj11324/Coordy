import { chmodSync, copyFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { cliBinaryPath, daemonBinaryPath } from "./daemon/daemon-binary-path";

export function installCliBinaries(): { ok: boolean; message: string } {
  const destDir = join(homedir(), ".local", "bin");
  mkdirSync(destDir, { recursive: true });
  const copies: string[] = [];
  for (const [src, name] of [
    [cliBinaryPath(), "coordy"],
    [daemonBinaryPath(), "coordyd"],
  ] as const) {
    if (!existsSync(src)) {
      return { ok: false, message: `找不到 ${name}：${src}` };
    }
    const dest = join(destDir, name);
    copyFileSync(src, dest);
    try {
      chmodSync(dest, 0o755);
    } catch {
      /* windows */
    }
    copies.push(dest);
  }
  return {
    ok: true,
    message: `已经装好，新开一个终端就可以用。如果还是找不到命令，把 ${destDir} 加到终端的搜索路径里。`,
  };
}
