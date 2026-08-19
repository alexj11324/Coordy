import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => "/repo/apps/desktop",
  },
}));

import { developmentWorkspaceRoot } from "../daemon/daemon-binary-path";

describe("development daemon binary path", () => {
  it.each([
    "/repo/apps/desktop",
    "/repo/apps/desktop/out",
    "/repo/apps/desktop/out/main",
  ])("finds the workspace from Electron app path %s", (appPath) => {
    const existing = new Set([
      "/repo/Cargo.toml",
      "/repo/apps/desktop/package.json",
    ]);
    expect(developmentWorkspaceRoot(appPath, (path) => existing.has(path))).toBe("/repo");
  });

  it("fails explicitly rather than guessing a wrong binary location", () => {
    expect(() => developmentWorkspaceRoot("/tmp/not-coordy", () => false)).toThrow(
      "Coordy workspace root not found",
    );
  });
});
