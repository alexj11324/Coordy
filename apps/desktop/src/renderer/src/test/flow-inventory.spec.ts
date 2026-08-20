import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { IPC } from "../../../shared/ipc-channels";
import {
  APP_ROUTE_CASES,
  LEGACY_ROUTE_REDIRECTS,
} from "../app/router";

type InventoryRow = { id: string; owner: string; outcome?: string };
type FlowInventory = {
  schema_version: number;
  routes: InventoryRow[];
  actions: InventoryRow[];
  ipc: InventoryRow[];
  runtime: InventoryRow[];
};

const inventory = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../../flow-inventory.json", import.meta.url)),
    "utf8",
  ),
) as FlowInventory;
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

describe("machine-readable desktop flow inventory", () => {
  it("links every row to an executable owner that exists", () => {
    const rows = [
      ...inventory.routes,
      ...inventory.actions,
      ...inventory.ipc,
      ...inventory.runtime,
    ];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.owner, row.id).toMatch(/\.spec\.ts$/);
      expect(existsSync(resolve(desktopRoot, row.owner)), `${row.id}: ${row.owner}`).toBe(true);
    }
  });

  it("tracks every declared route, redirect and unknown recovery", () => {
    const expected = [
      ...APP_ROUTE_CASES.map((route) => route.id),
      ...LEGACY_ROUTE_REDIRECTS.map((route) => route.id),
      "unknown",
    ].sort();
    expect(inventory.routes.map((route) => route.id).sort()).toEqual(expected);
    expect(inventory.routes.every((row) => row.owner.endsWith(".spec.ts"))).toBe(true);
  });

  it("tracks all required visible mutations", () => {
    expect(inventory.actions.map((row) => row.id).sort()).toEqual(
      [
        "agent",
        "automation",
        "bootstrap",
        "chat",
        "issue-run",
        "project",
        "settings",
        "skill",
        "squad",
        "stats",
        "task-action",
        "workspace-switch",
      ].sort(),
    );
  });

  it("tracks every retained preload method and the real runtime spine", () => {
    const bridgeMethods = Object.keys(IPC).filter((key) => key !== "effect");
    expect(inventory.ipc.map((row) => row.id).sort()).toEqual(bridgeMethods.sort());
    expect(inventory.runtime).toEqual([
      expect.objectContaining({ id: "electron-real-daemon-golden" }),
    ]);
  });
});
