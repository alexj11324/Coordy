import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
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
  const existing = process.env.ELECTRON_CLI_ARGS
    ? JSON.parse(process.env.ELECTRON_CLI_ARGS)
    : [];
  process.env.ELECTRON_CLI_ARGS = JSON.stringify([...existing, ...extra]);
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(null);
      else reject(new Error(`${command} ${args.join(" ")} failed`));
    });
  });
}

function findOnPath(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function cargoInvocation() {
  if (process.env.CARGO) {
    return { command: process.env.CARGO, args: [] };
  }
  const cargo = findOnPath(
    process.platform === "win32" ? "cargo.exe" : "cargo",
  );
  if (cargo) return { command: cargo, args: [] };
  const rustup =
    findOnPath(process.platform === "win32" ? "rustup.exe" : "rustup") ??
    (process.platform === "win32"
      ? null
      : ["/opt/homebrew/bin/rustup", join(homedir(), ".cargo/bin/rustup")].find(
          existsSync,
        ));
  if (rustup) {
    return {
      command: rustup,
      args: ["run", process.env.RUSTUP_TOOLCHAIN ?? "stable", "cargo"],
    };
  }
  throw new Error(
    "Cargo was not found; install Rust or set the CARGO environment variable",
  );
}

applyLinuxDisplayFlags();
const cargo = cargoInvocation();
await run(
  cargo.command,
  [...cargo.args, "build", "-p", "coordyd", "-p", "coordy"],
  repoRoot,
);
const vite = resolve(desktopRoot, "node_modules/.bin/electron-vite");
const electronArgs =
  process.platform === "linux" && process.env.ELECTRON_ENABLE_GPU !== "1"
    ? ["dev", "--", "--disable-gpu", "--disable-dev-shm-usage"]
    : ["dev"];
await run(vite, electronArgs, desktopRoot);
