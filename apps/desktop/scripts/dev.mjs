import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopRoot, "../..");

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(null);
      else reject(new Error(`${command} ${args.join(" ")} failed`));
    });
  });
}

await run("cargo", ["build", "-p", "coordyd", "-p", "coordy"], repoRoot);
await run(resolve(desktopRoot, "node_modules/.bin/electron-vite"), ["dev"], desktopRoot);
