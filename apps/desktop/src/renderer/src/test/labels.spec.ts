import { describe, expect, it } from "vitest";
import {
  daemonConnectionStatus,
  healthLabel,
  presenceLampTone,
} from "../lib/coordy/labels";

describe("daemonConnectionStatus", () => {
  it("is green only after a successful Health round-trip", () => {
    expect(daemonConnectionStatus({ isError: false, status: "ok" })).toEqual({
      tone: "green",
      label: "在线",
    });
  });

  it("is yellow while the socket has not answered", () => {
    expect(daemonConnectionStatus({ isError: false, status: undefined })).toEqual({
      tone: "yellow",
      label: "正在连接",
    });
    expect(daemonConnectionStatus({ isError: false, status: "connecting" })).toEqual({
      tone: "yellow",
      label: healthLabel("connecting"),
    });
  });

  it("is red when the Health query fails", () => {
    expect(daemonConnectionStatus({ isError: true, status: "ok" })).toEqual({
      tone: "red",
      label: "离线",
    });
    expect(daemonConnectionStatus({ isError: false, status: "unhealthy" })).toEqual({
      tone: "red",
      label: "unhealthy",
    });
  });
});

describe("presenceLampTone", () => {
  it("maps installed / demo / missing runtimes to traffic-light tones", () => {
    expect(presenceLampTone("online")).toBe("green");
    expect(presenceLampTone("demo")).toBe("yellow");
    expect(presenceLampTone("offline")).toBe("red");
    expect(presenceLampTone("unknown")).toBe("gray");
  });
});
