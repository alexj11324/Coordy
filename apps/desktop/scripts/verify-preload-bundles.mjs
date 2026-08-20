import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const preloadDir = resolve("out/preload");
const entries = ["index.cjs"];

for (const entry of entries) {
  const source = readFileSync(resolve(preloadDir, entry), "utf8");
  const requires = [...source.matchAll(/require\(["']([^"']+)["']\)/g)].map(
    (match) => match[1],
  );
  const unsupported = requires.filter((specifier) => specifier !== "electron");
  if (unsupported.length > 0) {
    throw new Error(
      `${entry} is not sandbox-self-contained; unsupported require: ${unsupported.join(", ")}`,
    );
  }
}

const generatedChunks = readdirSync(preloadDir).filter(
  (name) => !entries.includes(name),
);
if (generatedChunks.length > 0) {
  throw new Error(
    `sandboxed preload build emitted unexpected shared chunks: ${generatedChunks.join(", ")}`,
  );
}
