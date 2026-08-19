import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DaemonClient } from "../daemon/daemon-client";
import { createEffectPoller } from "../daemon/effect-poller";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeFrame(socket: import("node:net").Socket, value: unknown) {
  const payload = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  socket.write(Buffer.concat([header, payload]));
}

describe("daemon transport isolation", () => {
  it("keeps a delayed foreground RPC alive when effect polling times out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coordy-client-isolation-"));
    tempDirs.push(dir);
    const socketPath = join(dir, "daemon.sock");
    const server = createServer((socket) => {
      let buffer = Buffer.alloc(0);
      let handshaken = false;
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
          const length = buffer.readUInt32LE(0);
          if (buffer.length < 4 + length) return;
          const request = JSON.parse(
            buffer.subarray(4, 4 + length).toString("utf8"),
          ) as { id?: string; type?: string };
          buffer = buffer.subarray(4 + length);
          if (!handshaken) {
            handshaken = true;
            writeFrame(socket, { ok: true });
          } else if (request.type === "View") {
            setTimeout(
              () =>
                writeFrame(socket, {
                  id: request.id,
                  ok: true,
                  result: "done",
                }),
              80,
            );
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    const foreground = new DaemonClient();
    const effects = new DaemonClient();
    try {
      await foreground.connect(socketPath, "token");
      await effects.connect(socketPath, "token");
      const poll = createEffectPoller({
        client: () => effects,
        disconnect: () => effects.close(),
        reconnect: vi.fn(async () => undefined),
        onEffects: vi.fn(),
        onHealth: vi.fn(),
        requestTimeoutMs: 20,
      });

      const foregroundRequest = foreground.view({ type: "Health" });
      await poll();

      await expect(foregroundRequest).resolves.toBe("done");
    } finally {
      foreground.close();
      effects.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
