import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DaemonClient } from "../daemon/daemon-client";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("daemon client connection lifecycle", () => {
  it("times out and closes a socket when the daemon never acknowledges the handshake", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coordy-daemon-handshake-"));
    tempDirs.push(dir);
    const socketPath = join(dir, "daemon.sock");
    let resolveClosed: (() => void) | undefined;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const server = createServer((socket) => {
      socket.resume();
      socket.on("close", () => resolveClosed?.());
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    try {
      const client = new DaemonClient();
      await expect(
        client.connect(socketPath, "test-token", 50),
      ).rejects.toThrow("daemon connection timed out");
      await closed;
      await expect(client.subscribe(0)).rejects.toThrow(
        "daemon is not connected",
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("fails fast after disconnect and can reconnect for a healthy poll", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coordy-daemon-client-"));
    tempDirs.push(dir);
    const socketPath = join(dir, "daemon.sock");
    let connection = 0;
    const server = createServer((socket) => {
      connection += 1;
      const currentConnection = connection;
      let buffer = Buffer.alloc(0);
      let frames = 0;
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
          const length = buffer.readUInt32LE(0);
          if (buffer.length < 4 + length) return;
          const request = JSON.parse(
            buffer.subarray(4, 4 + length).toString("utf8"),
          ) as { id?: string };
          buffer = buffer.subarray(4 + length);
          frames += 1;
          if (frames === 1) {
            const payload = Buffer.from(JSON.stringify({ ok: true }));
            const header = Buffer.alloc(4);
            header.writeUInt32LE(payload.length, 0);
            socket.write(Buffer.concat([header, payload]));
          } else if (currentConnection === 1) {
            socket.destroy();
          } else {
            const payload = Buffer.from(
              JSON.stringify({ id: request.id, ok: true, result: [] }),
            );
            const header = Buffer.alloc(4);
            header.writeUInt32LE(payload.length, 0);
            socket.write(Buffer.concat([header, payload]));
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    try {
      const client = new DaemonClient();
      await client.connect(socketPath, "test-token");
      await expect(client.subscribe(0)).rejects.toThrow(
        "daemon connection closed",
      );
      await expect(client.subscribe(0)).rejects.toThrow(
        "daemon is not connected",
      );
      await client.connect(socketPath, "test-token");
      await expect(client.subscribe(0)).resolves.toEqual([]);
      client.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
