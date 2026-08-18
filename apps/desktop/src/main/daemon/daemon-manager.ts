import { spawn, ChildProcess } from "child_process";
import { mkdirSync, writeFileSync, chmodSync, existsSync } from "fs";
import { delimiter, join } from "path";
import { homedir } from "os";
import { app } from "electron";
import { randomUUID } from "crypto";
import { daemonBinaryPath } from "./daemon-binary-path";
import { DaemonClient } from "./daemon-client";

function daemonPath(): string {
  const extras = [
    join(homedir(), ".local/bin"),
    join(homedir(), ".cargo/bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ];
  return [process.env.PATH, ...extras].filter(Boolean).join(delimiter);
}

export class DaemonManager {
  process: ChildProcess | null = null;
  client: DaemonClient | null = null;
  socketPath = "";
  token = "";

  async start(): Promise<DaemonClient> {
    const runtime = join(app.getPath("userData"), "run");
    mkdirSync(runtime, { recursive: true });
    this.socketPath = join(runtime, "coordyd.sock");
    this.token = randomUUID();
    writeFileSync(join(runtime, "coordyd.token"), this.token, { mode: 0o600 });
    try {
      chmodSync(join(runtime, "coordyd.token"), 0o600);
    } catch {
      /* windows */
    }
    const bin = daemonBinaryPath();
    if (!existsSync(bin)) {
      throw new Error(`coordyd binary not found at ${bin}`);
    }
    const dataDir = join(app.getPath("userData"), "data");
    this.process = spawn(
      bin,
      ["--data-dir", dataDir, "--socket", this.socketPath, "--token", this.token],
      { stdio: "pipe", env: { ...process.env, PATH: daemonPath() } },
    );
    await waitForSocket(this.socketPath, 50);
    this.client = new DaemonClient();
    await this.client.connect(this.socketPath, this.token);
    return this.client;
  }

  stop() {
    this.process?.kill();
  }
}

async function waitForSocket(path: string, attempts: number) {
  const { createConnection } = await import("net");
  for (let i = 0; i < attempts; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const s = createConnection(path);
        s.once("connect", () => {
          s.end();
          resolve();
        });
        s.once("error", reject);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error("coordyd did not start");
}
