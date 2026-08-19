import { createConnection, Socket } from "net";
import { randomUUID } from "crypto";

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("daemon connection timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class DaemonClient {
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  async connect(path: string, token: string, timeoutMs = 2_000): Promise<void> {
    const socket = createConnection(path);
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          socket.once("connect", () => resolve());
          socket.once("error", reject);
        }),
        timeoutMs,
      );
      socket.on("data", (chunk) => this.onData(chunk));
      socket.on("error", (error) => {
        if (this.socket === socket) this.socket = null;
        this.failPending(error);
      });
      socket.on("close", () => {
        if (this.socket === socket) this.socket = null;
        this.failPending(new Error("daemon connection closed"));
      });
      const ack = await withTimeout(
        this.writeRaw({
          protocol: "coordy-local-v1",
          token,
          client: "electron",
        }),
        timeoutMs,
      );
      if (!(ack as { ok?: boolean }).ok) {
        throw new Error("daemon handshake failed");
      }
    } catch (error) {
      if (this.socket === socket) this.socket = null;
      socket.destroy();
      this.failPending(
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32LE(0);
      if (this.buffer.length < 4 + len) return;
      const body = this.buffer.subarray(4, 4 + len);
      this.buffer = this.buffer.subarray(4 + len);
      const parsed = JSON.parse(body.toString("utf8"));
      if (parsed.id && this.pending.has(parsed.id)) {
        this.pending.get(parsed.id)!.resolve(parsed);
        this.pending.delete(parsed.id);
      } else if (parsed.ok !== undefined && this.pending.has("handshake")) {
        this.pending.get("handshake")!.resolve(parsed);
        this.pending.delete("handshake");
      }
    }
  }

  private failPending(error: Error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private writeFrame(obj: unknown) {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      throw new Error("daemon is not connected");
    }
    const payload = Buffer.from(JSON.stringify(obj));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    socket.write(Buffer.concat([header, payload]));
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
    this.failPending(new Error("daemon connection closed"));
  }

  private async writeRaw(obj: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set("handshake", { resolve, reject });
      try {
        this.writeFrame(obj);
      } catch (error) {
        this.pending.delete("handshake");
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async request(methodBody: Record<string, unknown>): Promise<unknown> {
    const id = randomUUID();
    const req = { id, ...methodBody };
    const resp = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        this.pending.set(id, {
          resolve: (value) => resolve(value as Record<string, unknown>),
          reject,
        });
        try {
          this.writeFrame(req);
        } catch (error) {
          this.pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
    if (!resp.ok) {
      throw new Error(
        (resp.error as { message?: string })?.message ?? "rpc error",
      );
    }
    return resp.result;
  }

  async submit(command: unknown) {
    return this.request({ type: "Submit", command });
  }

  async view(query: unknown) {
    return this.request({ type: "View", query });
  }

  async subscribe(cursor: number | null = 0) {
    return this.request({ type: "Subscribe", cursor });
  }

  async secretsStatus() {
    return this.request({ type: "SecretsStatus" });
  }

  async setSecret(input: {
    provider: string;
    api_key?: string | null;
    base_url?: string | null;
    acp_command?: string | null;
  }) {
    return this.request({ type: "SetSecret", ...input });
  }

  async clearSecret() {
    return this.request({ type: "ClearSecret" });
  }

  async completeDraft(kind: string, prompt: string) {
    return this.request({ type: "CompleteDraft", kind, prompt });
  }

  async discoverAgents(refresh = false) {
    return this.request({ type: "DiscoverAgents", refresh });
  }

  async importAgents(input: {
    workspace_id: string;
    principal_id: string;
    ids?: string[] | null;
  }) {
    return this.request({ type: "ImportDiscoveredAgents", ...input });
  }
}
