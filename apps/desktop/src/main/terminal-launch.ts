import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

export type TerminalLaunchSpec = {
  command: string;
  args: string[];
  cwd?: string;
};

export type TerminalLauncher = (
  command: string,
  args: string[],
  options: { cwd: string | undefined; shell: false },
) => Promise<void>;

export function terminalLaunchSpec(
  platform: NodeJS.Platform,
  directory: string,
): TerminalLaunchSpec[] {
  if (platform === "darwin") {
    return [{ command: "open", args: ["-a", "Terminal", directory] }];
  }
  if (platform === "win32") {
    return [
      { command: "wt.exe", args: ["-d", directory] },
      { command: "cmd.exe", args: ["/D", "/K"], cwd: directory },
    ];
  }
  return [
    {
      command: "x-terminal-emulator",
      args: ["--working-directory", directory],
    },
    { command: "xfce4-terminal", args: ["--working-directory", directory] },
    { command: "gnome-terminal", args: ["--working-directory", directory] },
    { command: "xterm", args: [], cwd: directory },
  ];
}

// Allow the launcher itself to start before treating a still-running process as success.
const IMMEDIATE_EXIT_WINDOW_MS = 1_000;

export const spawnTerminal: TerminalLauncher = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell,
      detached: true,
      stdio: "ignore",
    });
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: { error?: Error } = {}) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      if (result.error) reject(result.error);
      else resolve();
    };
    const onError = (error: Error) => finish({ error });
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0 && signal === null) {
        finish();
        return;
      }
      finish({
        error: new Error(
          `terminal launcher exited immediately (${signal ?? `code ${code ?? "unknown"}`})`,
        ),
      });
    };
    child.once("error", onError);
    child.once("exit", onExit);
    child.once("spawn", () => {
      timer = setTimeout(() => {
        child.unref();
        finish();
      }, IMMEDIATE_EXIT_WINDOW_MS);
    });
  });

export async function openTerminalAt(
  directory: string,
  platform: NodeJS.Platform = process.platform,
  launch: TerminalLauncher = spawnTerminal,
): Promise<void> {
  if (typeof directory !== "string" || !isAbsolute(directory)) {
    throw new Error("terminal path must be an absolute directory");
  }
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(directory);
  } catch {
    throw new Error("terminal path must be an existing directory");
  }
  if (!info.isDirectory()) {
    throw new Error("terminal path must be an existing directory");
  }

  let lastError: unknown;
  for (const spec of terminalLaunchSpec(platform, directory)) {
    try {
      await launch(spec.command, spec.args, {
        cwd: spec.cwd,
        shell: false,
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`无法打开终端：${message}`);
}
