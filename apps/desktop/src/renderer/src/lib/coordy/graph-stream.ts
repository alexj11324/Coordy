export function applyGraphDeltaRevision(current: number, incoming: number): number {
  return incoming >= current ? incoming : current;
}

export function graphLiveState(input: {
  consistent: boolean;
  snapshotRevision: number;
  deltaRevision: number | null;
  subscribed: boolean;
}): { live: boolean; tone: "green" | "yellow" | "red"; lag: number } {
  const lag =
    input.deltaRevision == null ? 0 : Math.max(0, input.deltaRevision - input.snapshotRevision);
  if (!input.subscribed || !input.consistent) {
    return { live: false, tone: "red", lag: Math.max(lag, input.subscribed ? lag : 1) };
  }
  if (lag > 0) {
    return { live: false, tone: "yellow", lag };
  }
  return { live: true, tone: "green", lag: 0 };
}
