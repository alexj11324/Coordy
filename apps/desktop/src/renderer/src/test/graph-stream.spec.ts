import { describe, expect, it } from "vitest";
import { applyGraphDeltaRevision, graphLiveState } from "../lib/coordy/graph-stream";

describe("graph stream", () => {
  it("keeps revision monotonic when applying GraphDelta", () => {
    expect(applyGraphDeltaRevision(3, 5)).toBe(5);
    expect(applyGraphDeltaRevision(5, 4)).toBe(5);
    expect(applyGraphDeltaRevision(5, 5)).toBe(5);
  });

  it("is Live only when consistent, subscribed, and lag is 0", () => {
    expect(
      graphLiveState({
        consistent: true,
        snapshotRevision: 4,
        deltaRevision: 4,
        subscribed: true,
      }),
    ).toEqual({ live: true, tone: "green", lag: 0 });
    expect(
      graphLiveState({
        consistent: true,
        snapshotRevision: 3,
        deltaRevision: 4,
        subscribed: true,
      }),
    ).toEqual({ live: false, tone: "yellow", lag: 1 });
    expect(
      graphLiveState({
        consistent: false,
        snapshotRevision: 4,
        deltaRevision: 4,
        subscribed: true,
      }),
    ).toEqual({ live: false, tone: "red", lag: 0 });
    expect(
      graphLiveState({
        consistent: true,
        snapshotRevision: 4,
        deltaRevision: null,
        subscribed: false,
      }),
    ).toEqual({ live: false, tone: "red", lag: 1 });
  });
});
