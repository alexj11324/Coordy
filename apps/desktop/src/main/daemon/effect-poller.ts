export type EffectClient = {
  subscribe(cursor: number): Promise<unknown>;
};

class PollTimeoutError extends Error {}

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
          () => reject(new PollTimeoutError("daemon poll timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createEffectPoller(input: {
  client: () => EffectClient | null;
  disconnect: () => void;
  reconnect: () => Promise<unknown>;
  onEffects: (effects: unknown[]) => void;
  onHealth: (healthy: boolean) => void;
  maxReconnectAttempts?: number;
  requestTimeoutMs?: number;
  reconnectTimeoutMs?: number;
  cooldownMs?: number;
}) {
  let cursor = 0;
  let inFlight = false;
  let reconnectAttempts = 0;
  let cooldownUntil = 0;
  let lastHealth: boolean | null = null;
  const maxReconnectAttempts = input.maxReconnectAttempts ?? 3;
  const requestTimeoutMs = input.requestTimeoutMs ?? 2_000;
  const reconnectTimeoutMs = input.reconnectTimeoutMs ?? 2_000;
  const cooldownMs = input.cooldownMs ?? 5_000;

  const reportHealth = (healthy: boolean) => {
    if (lastHealth === healthy) return;
    lastHealth = healthy;
    input.onHealth(healthy);
  };

  return async function poll(): Promise<void> {
    if (inFlight || Date.now() < cooldownUntil) return;
    inFlight = true;
    try {
      const client = input.client();
      if (!client) throw new Error("daemon is not connected");
      const effects = await withTimeout(
        client.subscribe(cursor),
        requestTimeoutMs,
      );
      if (!Array.isArray(effects)) throw new Error("invalid effect batch");
      reconnectAttempts = 0;
      cooldownUntil = 0;
      reportHealth(true);
      if (effects.length > 0) {
        cursor += effects.length;
        input.onEffects(effects);
      }
    } catch (error) {
      reportHealth(false);
      if (error instanceof PollTimeoutError) input.disconnect();
      let reconnected = false;
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts += 1;
        try {
          await withTimeout(input.reconnect(), reconnectTimeoutMs);
          cursor = 0;
          reconnected = true;
        } catch (reconnectError) {
          if (reconnectError instanceof PollTimeoutError) input.disconnect();
          // A later poll may make another bounded reconnect attempt.
        }
      }
      if (!reconnected && reconnectAttempts >= maxReconnectAttempts) {
        reconnectAttempts = 0;
        cooldownUntil = Date.now() + cooldownMs;
      }
    } finally {
      inFlight = false;
    }
  };
}
