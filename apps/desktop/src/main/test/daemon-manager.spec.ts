import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DaemonManager,
  type ManagedDaemonClient,
} from "../daemon/daemon-manager";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

class FakeChild extends EventEmitter {
  kill = vi.fn(() => {
    this.emit("exit", 0, null);
    return true;
  });
}

function fixture(connectFailureAt: number | null = null) {
  const userData = mkdtempSync(join(tmpdir(), "coordy-manager-"));
  tempDirs.push(userData);
  const binary = join(userData, "coordyd");
  mkdirSync(userData, { recursive: true });
  writeFileSync(binary, "fake");
  const children: FakeChild[] = [];
  const clients: Array<
    ManagedDaemonClient & { close: ReturnType<typeof vi.fn> }
  > = [];
  const manager = new DaemonManager({
    userDataPath: userData,
    binaryPath: binary,
    spawnProcess: () => {
      const child = new FakeChild();
      children.push(child);
      return child as never;
    },
    waitForSocket: vi.fn(async () => undefined),
    clientFactory: () => {
      const clientIndex = clients.length;
      const client = {
        connect: vi.fn(async () => {
          if (clientIndex === connectFailureAt) {
            throw new Error("client connection failed");
          }
        }),
        close: vi.fn(),
      } as unknown as ManagedDaemonClient & { close: ReturnType<typeof vi.fn> };
      clients.push(client);
      return client;
    },
  });
  return { manager, children, clients, userData, binary };
}

describe("daemon manager", () => {
  it("kills and clears a child when startup readiness fails", async () => {
    const { children, userData, binary } = fixture();
    const failure = new Error("socket never became ready");
    const rejectingManager = new DaemonManager({
      userDataPath: userData,
      binaryPath: binary,
      spawnProcess: () => {
        const child = new FakeChild();
        children.push(child);
        return child as never;
      },
      waitForSocket: vi.fn(async () => {
        throw failure;
      }),
    });

    await expect(rejectingManager.start()).rejects.toBe(failure);

    expect(children).toHaveLength(1);
    expect(children[0].kill).toHaveBeenCalledTimes(1);
    expect(rejectingManager.process).toBeNull();
    expect(rejectingManager.client).toBeNull();
    expect(rejectingManager.effectClient).toBeNull();
  });

  it("handles an asynchronous spawn error without leaking the child", async () => {
    const { userData, binary } = fixture();
    const child = new FakeChild();
    const failure = Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
    const manager = new DaemonManager({
      userDataPath: userData,
      binaryPath: binary,
      spawnProcess: () => {
        queueMicrotask(() => child.emit("error", failure));
        return child as never;
      },
      waitForSocket: () => new Promise<void>(() => undefined),
    });

    await expect(manager.start()).rejects.toBe(failure);

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(manager.process).toBeNull();
    expect(manager.client).toBeNull();
    expect(manager.effectClient).toBeNull();
  });

  it("closes both clients and kills the child when startup authentication fails", async () => {
    const { manager, children, clients } = fixture(1);

    await expect(manager.start()).rejects.toThrow("client connection failed");

    expect(children[0].kill).toHaveBeenCalledTimes(1);
    expect(clients[0].close).toHaveBeenCalledTimes(1);
    expect(clients[1].close).toHaveBeenCalledTimes(1);
    expect(manager.process).toBeNull();
    expect(manager.client).toBeNull();
    expect(manager.effectClient).toBeNull();
  });

  it("owns independent foreground and effect clients", async () => {
    const { manager, clients } = fixture();

    await manager.start();
    manager.disconnectEffectClient();

    expect(clients).toHaveLength(2);
    expect(manager.client).toBe(clients[0]);
    expect(manager.effectClient).toBeNull();
    expect(clients[0].close).not.toHaveBeenCalled();
    expect(clients[1].close).toHaveBeenCalledTimes(1);
  });

  it("restarts once after a runtime child error and reconnects both clients", async () => {
    const { manager, children, clients } = fixture();
    await manager.start();

    children[0].emit("error", new Error("runtime child error"));
    await vi.waitFor(() => expect(children).toHaveLength(2));
    await vi.waitFor(() => expect(clients).toHaveLength(4));
    await vi.waitFor(() => expect(manager.client).toBe(clients[2]));
    await vi.waitFor(() => expect(manager.effectClient).toBe(clients[3]));
    expect(children[0].kill).toHaveBeenCalledTimes(1);

    children[1].emit("error", new Error("second runtime child error"));
    await Promise.resolve();
    expect(children).toHaveLength(2);
    expect(children[1].kill).toHaveBeenCalledTimes(1);
  });

  it("does not restart during intentional idempotent shutdown", async () => {
    const { manager, children, clients } = fixture();
    await manager.start();

    manager.stop();
    manager.stop();
    await Promise.resolve();

    expect(children).toHaveLength(1);
    expect(children[0].kill).toHaveBeenCalledTimes(1);
    expect(clients[0].close).toHaveBeenCalledTimes(1);
    expect(clients[1].close).toHaveBeenCalledTimes(1);
  });

  it.runIf(Boolean(process.env.COORDY_REAL_DAEMON_BINARY))(
    "restarts a real coordyd and restores authenticated clients",
    async () => {
      const binary = process.env.COORDY_REAL_DAEMON_BINARY!;
      expect(isAbsolute(binary)).toBe(true);
      const userData = mkdtempSync(join(tmpdir(), "coordy-real-manager-"));
      tempDirs.push(userData);
      const manager = new DaemonManager({
        userDataPath: userData,
        binaryPath: binary,
      });

      try {
        await manager.start();
        const firstPid = manager.process?.pid;
        expect(firstPid).toBeTypeOf("number");
        await expect(
          manager.client!.request({ type: "Health" }),
        ).resolves.toMatchObject({ status: "ok", pid: firstPid });

        process.kill(firstPid!, "SIGTERM");
        await vi.waitFor(
          () => {
            expect(manager.process?.pid).toBeTypeOf("number");
            expect(manager.process?.pid).not.toBe(firstPid);
            expect(manager.client).not.toBeNull();
            expect(manager.effectClient).not.toBeNull();
          },
          { timeout: 5_000 },
        );
        await expect(
          manager.client!.request({ type: "Health" }),
        ).resolves.toMatchObject({
          status: "ok",
          pid: manager.process!.pid,
        });
      } finally {
        manager.stop();
      }
    },
  );
});
