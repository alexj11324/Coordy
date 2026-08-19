import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTerminalAt, terminalLaunchSpec } from "../terminal-launch";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("terminal launch boundary", () => {
  it("keeps hostile path characters as one literal argv value", () => {
    const hostile = "/tmp/space ' quote \" $() `ticks`;semi\nnewline";

    expect(terminalLaunchSpec("darwin", hostile)).toEqual([
      { command: "open", args: ["-a", "Terminal", hostile] },
    ]);
    expect(terminalLaunchSpec("win32", hostile)).toEqual([
      { command: "wt.exe", args: ["-d", hostile] },
      { command: "cmd.exe", args: ["/D", "/K"], cwd: hostile },
    ]);
    expect(terminalLaunchSpec("linux", hostile)[0]).toEqual({
      command: "x-terminal-emulator",
      args: ["--working-directory", hostile],
    });
  });

  it("falls back to cmd.exe without embedding the directory in a command", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coordy $() `literal`; "));
    tempDirs.push(dir);
    const launch = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }))
      .mockResolvedValueOnce(undefined);

    await openTerminalAt(dir, "win32", launch);

    expect(launch).toHaveBeenNthCalledWith(1, "wt.exe", ["-d", dir], {
      cwd: undefined,
      shell: false,
    });
    expect(launch).toHaveBeenNthCalledWith(2, "cmd.exe", ["/D", "/K"], {
      cwd: dir,
      shell: false,
    });
  });

  it("validates an absolute existing directory and launches without a shell", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coordy $() `literal`; "));
    tempDirs.push(dir);
    const launch = vi.fn(async () => undefined);

    await openTerminalAt(dir, "darwin", launch);

    expect(launch).toHaveBeenCalledWith("open", ["-a", "Terminal", dir], {
      cwd: undefined,
      shell: false,
    });
  });

  it("rejects relative, missing, and non-directory paths before launch", async () => {
    const launch = vi.fn(async () => undefined);
    const dir = mkdtempSync(join(tmpdir(), "coordy-terminal-file-"));
    tempDirs.push(dir);
    const file = join(dir, "not-a-directory");
    writeFileSync(file, "content");

    await expect(openTerminalAt("relative", "darwin", launch)).rejects.toThrow(
      "absolute directory",
    );
    await expect(
      openTerminalAt("/definitely/missing/coordy", "darwin", launch),
    ).rejects.toThrow("existing directory");
    await expect(openTerminalAt(file, "darwin", launch)).rejects.toThrow(
      "existing directory",
    );
    expect(launch).not.toHaveBeenCalled();
  });
});
