import { spawn, ChildProcess } from "child_process";
import { mkdirSync, writeFileSync, chmodSync, existsSync } from "fs";
import { delimiter, join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { DaemonClient } from "./daemon-client";

export type ManagedDaemonClient = DaemonClient;

type ManagerOptions = {
  userDataPath: string | (() => string);
  binaryPath: string | (() => string);
  spawnProcess?: typeof spawn;
  clientFactory?: () => ManagedDaemonClient;
  waitForSocket?: (path: string, attempts: number) => Promise<void>;
};

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
  client: ManagedDaemonClient | null = null;
  effectClient: ManagedDaemonClient | null = null;
  socketPath = "";
  token = "";
  private readonly options: ManagerOptions;
  private stopping = false;
  private restartAttempted = false;
  private automaticRestart: Promise<void> | null = null;

  constructor(options: ManagerOptions) {
    this.options = options;
  }

  async start(): Promise<DaemonClient> {
    this.stopping = false;
    this.restartAttempted = false;
    this.automaticRestart = null;
    const userData =
      typeof this.options.userDataPath === "function"
        ? this.options.userDataPath()
        : this.options.userDataPath;
    const runtime = join(userData, "run");
    mkdirSync(runtime, { recursive: true });
    this.socketPath = join(runtime, "coordyd.sock");
    this.token = randomUUID();
    writeFileSync(join(runtime, "coordyd.token"), this.token, { mode: 0o600 });
    try {
      chmodSync(join(runtime, "coordyd.token"), 0o600);
    } catch {
      /* windows */
    }
    const bin =
      typeof this.options.binaryPath === "function"
        ? this.options.binaryPath()
        : this.options.binaryPath;
    if (!existsSync(bin)) {
      throw new Error(`coordyd binary not found at ${bin}`);
    }
    await this.spawnAndConnect(bin, join(userData, "data"));
    return this.client!;
  }

  private async spawnAndConnect(bin: string, dataDir: string): Promise<void> {
    const spawnProcess = this.options.spawnProcess ?? spawn;
    const child = spawnProcess(
      bin,
      [
        "--data-dir",
        dataDir,
        "--socket",
        this.socketPath,
        "--token",
        this.token,
      ],
      { stdio: "pipe", env: { ...process.env, PATH: daemonPath() } },
    );
    this.process = child;
    let startupStderr = "";
    child.stderr?.on("data", (chunk) => {
      startupStderr = `${startupStderr}${String(chunk)}`.slice(-8_000);
    });
    let connected = false;
    let rejectStartup!: (error: Error) => void;
    const startupFailure = new Promise<never>((_resolve, reject) => {
      rejectStartup = reject;
    });
    child.once("error", (error) => {
      if (connected) this.handleUnexpectedExit(child, bin, dataDir, true);
      else rejectStartup(error);
    });
    child.once("exit", (code, signal) => {
      if (connected) {
        this.handleUnexpectedExit(child, bin, dataDir);
      } else {
        rejectStartup(
          new Error(
            `coordyd exited during startup (code ${String(code)}, signal ${String(signal)})${
              startupStderr.trim() ? `: ${startupStderr.trim()}` : ""
            }`,
          ),
        );
      }
    });
    let foreground: ManagedDaemonClient | null = null;
    let effects: ManagedDaemonClient | null = null;
    try {
      await Promise.race([
        (this.options.waitForSocket ?? waitForSocket)(this.socketPath, 50),
        startupFailure,
      ]);
      foreground = this.createClient();
      effects = this.createClient();
      await Promise.race([
        foreground.connect(this.socketPath, this.token),
        startupFailure,
      ]);
      await Promise.race([
        effects.connect(this.socketPath, this.token),
        startupFailure,
      ]);
      connected = true;
    } catch (error) {
      foreground?.close();
      effects?.close();
      if (this.process === child) {
        this.process = null;
        child.once("error", () => undefined);
        child.kill();
      }
      throw error;
    }
    this.disconnect();
    this.disconnectEffectClient();
    this.client = foreground;
    this.effectClient = effects;
  }

  private createClient(): ManagedDaemonClient {
    return this.options.clientFactory?.() ?? new DaemonClient();
  }

  private handleUnexpectedExit(
    child: ChildProcess,
    bin: string,
    dataDir: string,
    terminateChild = false,
  ): void {
    if (this.process !== child) return;
    this.process = null;
    if (terminateChild) {
      child.once("error", () => undefined);
      child.kill();
    }
    this.disconnect();
    this.disconnectEffectClient();
    if (this.stopping || this.restartAttempted) return;
    this.restartAttempted = true;
    this.automaticRestart = this.spawnAndConnect(bin, dataDir).catch(
      (error) => {
        console.error("coordyd automatic restart failed", error);
      },
    );
  }

  async reconnectEffectClient(): Promise<DaemonClient> {
    await this.automaticRestart;
    if (this.effectClient) return this.effectClient;
    const client = this.createClient();
    await client.connect(this.socketPath, this.token);
    this.effectClient = client;
    return client;
  }

  disconnect() {
    this.client?.close();
    this.client = null;
  }

  disconnectEffectClient() {
    this.effectClient?.close();
    this.effectClient = null;
  }

  stop() {
    if (this.stopping) return;
    this.stopping = true;
    this.disconnect();
    this.disconnectEffectClient();
    const child = this.process;
    this.process = null;
    child?.kill();
  }
}

export async function waitForSocket(path: string, attempts: number) {
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
