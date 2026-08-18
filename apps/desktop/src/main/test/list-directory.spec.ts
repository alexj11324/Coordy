import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { listDirectory } from "../list-directory";

describe("listDirectory", () => {
  it("returns files and directories from a folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "coordy-dir-"));
    writeFileSync(join(dir, "readme.md"), "hi");
    mkdirSync(join(dir, "src"));
    const entries = listDirectory(dir);
    expect(entries.some((entry) => entry.name === "src" && entry.isDirectory)).toBe(true);
    expect(entries.some((entry) => entry.name === "readme.md" && !entry.isDirectory)).toBe(true);
  });
});
