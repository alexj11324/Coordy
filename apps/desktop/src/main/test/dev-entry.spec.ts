import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("documented desktop development entrypoint", () => {
  it("has exactly one Rust build owner", () => {
    const desktopRoot = resolve(import.meta.dirname, "../../..");
    const repoRoot = resolve(desktopRoot, "../..");
    const wrapper = readFileSync(resolve(repoRoot, "scripts/dev.sh"), "utf8");
    const launcher = readFileSync(
      resolve(desktopRoot, "scripts/dev.mjs"),
      "utf8",
    );

    expect(wrapper).toContain("pnpm --filter @coordy/desktop dev");
    expect(wrapper).not.toMatch(/cargo\s+build/);
    expect(launcher.match(/"build", "-p", "coordyd"/g)).toHaveLength(1);
    expect(launcher).toContain("RUSTUP_TOOLCHAIN");
    expect(launcher).toContain('child.on("error", reject)');
  });
});
