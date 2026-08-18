import { createConnection, Socket } from "net";
import { randomUUID } from "crypto";

export class DaemonClient {
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private pending = new Map<string, (value: unknown) => void>();

  async connect(path: string, token: string): Promise<void> {
    this.socket = createConnection(path);
    await new Promise<void>((resolve, reject) => {
      this.socket!.once("connect", () => resolve());
      this.socket!.once("error", reject);
    });
    this.socket.on("data", (chunk) => this.onData(chunk));
    const ack = await this.writeRaw({
      protocol: "coordy-local-v1",
      token,
      client: "electron",
    });
    if (!(ack as { ok?: boolean }).ok) {
      throw new Error("daemon handshake failed");
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
        this.pending.get(parsed.id)!(parsed);
        this.pending.delete(parsed.id);
      } else if (parsed.ok !== undefined && this.pending.has("handshake")) {
        this.pending.get("handshake")!(parsed);
        this.pending.delete("handshake");
      }
    }
  }

  private writeFrame(obj: unknown) {
    const payload = Buffer.from(JSON.stringify(obj));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    this.socket!.write(Buffer.concat([header, payload]));
  }

  private async writeRaw(obj: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      this.pending.set("handshake", resolve);
      this.writeFrame(obj);
    });
  }

  async request(methodBody: Record<string, unknown>): Promise<unknown> {
    const id = randomUUID();
    const req = { id, ...methodBody };
    const resp = await new Promise<Record<string, unknown>>((resolve) => {
      this.pending.set(id, (value) => resolve(value as Record<string, unknown>));
      this.writeFrame(req);
    });
    if (!resp.ok) {
      throw new Error((resp.error as { message?: string })?.message ?? "rpc error");
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
}
