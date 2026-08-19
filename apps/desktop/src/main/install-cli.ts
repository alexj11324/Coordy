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
      return { ok: false, message: `未找到 ${name}：${src}` };
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
    message: `已安装到 ${destDir}。请新开终端后使用。若仍无法找到命令，请将该目录加入 PATH。`,
  };
}
