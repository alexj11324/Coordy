import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopRoot, "../..");

function applyLinuxDisplayFlags() {
  if (process.platform !== "linux" || process.env.ELECTRON_ENABLE_GPU === "1") {
    return;
  }
  process.env.NO_SANDBOX ??= "1";
  process.env.LIBGL_ALWAYS_SOFTWARE ??= "1";
  const extra = ["--disable-gpu", "--disable-dev-shm-usage"];
  const existing = process.env.ELECTRON_CLI_ARGS ? JSON.parse(process.env.ELECTRON_CLI_ARGS) : [];
  process.env.ELECTRON_CLI_ARGS = JSON.stringify([...existing, ...extra]);
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(null);
      else reject(new Error(`${command} ${args.join(" ")} failed`));
    });
  });
}

applyLinuxDisplayFlags();
await run("cargo", ["build", "-p", "coordyd", "-p", "coordy"], repoRoot);
await run(resolve(desktopRoot, "node_modules/.bin/electron-vite"), ["dev"], desktopRoot);
