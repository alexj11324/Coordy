import { readdirSync } from "fs";
import { join, resolve } from "path";

export type DirEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

export function listDirectory(dir: string): DirEntry[] {
  const root = resolve(dir);
  const entries = readdirSync(root, { withFileTypes: true });
  const out: DirEntry[] = [];
  for (const entry of entries) {
    if (out.length >= 200) break;
    if (entry.name === "." || entry.name === "..") continue;
    out.push({
      name: entry.name,
      path: join(root, entry.name),
      isDirectory: entry.isDirectory(),
    });
  }
  out.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
  return out;
}
