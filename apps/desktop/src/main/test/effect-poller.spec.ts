import { describe, expect, it, vi } from "vitest";
import { createEffectPoller } from "../daemon/effect-poller";

describe("daemon effect poller", () => {
  it("serializes delayed polls so effects are neither duplicated nor skipped", async () => {
    let releaseFirst: ((effects: unknown[]) => void) | undefined;
    const cursors: number[] = [];
    const batches = [[{ id: 3 }]];
    const client = {
      subscribe: vi.fn((cursor: number) => {
        cursors.push(cursor);
        if (!releaseFirst) {
          return new Promise<unknown[]>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return Promise.resolve(batches.shift() ?? []);
      }),
    };
    const received: unknown[] = [];
    const poll = createEffectPoller({
      client: () => client,
      disconnect: vi.fn(),
      reconnect: vi.fn(),
      onEffects: (effects) => received.push(...effects),
      onHealth: vi.fn(),
    });

    const first = poll();
    await poll();
    expect(client.subscribe).toHaveBeenCalledTimes(1);
    releaseFirst?.([{ id: 1 }, { id: 2 }]);
    await first;
    await poll();

    expect(cursors).toEqual([0, 2]);
    expect(received).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("reports failures, reconnects with a reset cursor, then reports recovery", async () => {
    const health: boolean[] = [];
    const cursors: number[] = [];
    let connected = false;
    const client = {
      subscribe: vi.fn(async (cursor: number) => {
        cursors.push(cursor);
        if (!connected) throw new Error("disconnected");
        return [];
      }),
    };
    const poll = createEffectPoller({
      client: () => client,
      disconnect: vi.fn(),
      reconnect: async () => {
        connected = true;
      },
      onEffects: vi.fn(),
      onHealth: (healthy) => health.push(healthy),
    });

    await poll();
    await poll();

    expect(cursors).toEqual([0, 0]);
    expect(health).toEqual([false, true]);
  });

  it("times out a stalled poll, releases the fence, and reconnects", async () => {
    vi.useFakeTimers();
    const disconnect = vi.fn();
    const reconnect = vi.fn(async () => undefined);
    const subscribe = vi.fn(() => new Promise<unknown[]>(() => undefined));
    const health: boolean[] = [];
    const poll = createEffectPoller({
      client: () => ({ subscribe }),
      disconnect,
      reconnect,
      onEffects: vi.fn(),
      onHealth: (healthy) => health.push(healthy),
      requestTimeoutMs: 100,
    });

    const stalled = poll();
    await vi.advanceTimersByTimeAsync(100);
    await stalled;
    const next = poll();
    await vi.advanceTimersByTimeAsync(100);
    await next;

    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(reconnect).toHaveBeenCalledTimes(2);
    expect(health).toEqual([false]);
    vi.useRealTimers();
  });

  it("enters a no-spin cooldown after reconnect exhaustion, then recovers", async () => {
    vi.useFakeTimers();
    const reconnect = vi.fn(async () => {
      throw new Error("offline");
    });
    let recovered = false;
    const subscribe = vi.fn(async () => {
      if (!recovered) throw new Error("offline");
      return [];
    });
    const health: boolean[] = [];
    const poll = createEffectPoller({
      client: () => ({ subscribe }),
      disconnect: vi.fn(),
      reconnect,
      onEffects: vi.fn(),
      onHealth: (healthy) => health.push(healthy),
      maxReconnectAttempts: 2,
      cooldownMs: 5_000,
    });

    await poll();
    await poll();
    for (let tick = 0; tick < 10; tick += 1) {
      await vi.advanceTimersByTimeAsync(400);
      await poll();
    }

    expect(reconnect).toHaveBeenCalledTimes(2);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(health).toEqual([false]);

    recovered = true;
    await vi.advanceTimersByTimeAsync(1_000);
    await poll();

    expect(subscribe).toHaveBeenCalledTimes(3);
    expect(health).toEqual([false, true]);
    vi.useRealTimers();
  });

  it("times out a reconnect that never settles and reaches cooldown", async () => {
    vi.useFakeTimers();
    const disconnect = vi.fn();
    const reconnect = vi.fn(() => new Promise<never>(() => undefined));
    const subscribe = vi.fn(async () => {
      throw new Error("offline");
    });
    const poll = createEffectPoller({
      client: () => ({ subscribe }),
      disconnect,
      reconnect,
      onEffects: vi.fn(),
      onHealth: vi.fn(),
      maxReconnectAttempts: 1,
      reconnectTimeoutMs: 100,
      cooldownMs: 5_000,
    });

    const attempt = poll();
    await vi.advanceTimersByTimeAsync(100);
    await attempt;
    for (let tick = 0; tick < 10; tick += 1) {
      await vi.advanceTimersByTimeAsync(400);
      await poll();
    }

    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
