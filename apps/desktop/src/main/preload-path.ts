import { existsSync } from "fs";
import { join } from "path";

/** Sandboxed Electron preload must be CommonJS; ESM `.mjs` cannot load. */
export function resolvePreloadPath(fromDir: string): string {
  const candidates = [join(fromDir, "../preload/index.cjs"), join(fromDir, "../preload/index.js")];
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(`preload script not found next to ${fromDir}`);
  }
  return found;
}
