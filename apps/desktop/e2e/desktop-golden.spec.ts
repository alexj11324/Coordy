import { chromium, expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type GoldenIds = {
  workspaceId: string;
  principalId: string;
  agentId: string;
  taskId: string;
  runId: string;
  daemonPid: number;
};

type BootstrapIds = Pick<GoldenIds, "workspaceId" | "principalId" | "daemonPid">;
type GoldenRuntime = {
  application: ChildProcess;
  browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null;
  page: import("@playwright/test").Page | null;
  daemonPid: number;
  runtimeRoot: string;
  temporaryRoot: string;
};

const require = createRequire(import.meta.url);
const electronPath = String(require("electron")).trim();

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function waitForDevtoolsPort(
  child: ChildProcess,
  userData: string,
  logs: () => string,
): Promise<number> {
  const portFile = join(userData, "DevToolsActivePort");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const port = Number(readFileSync(portFile, "utf8").split(/\r?\n/, 1)[0]);
      if (Number.isInteger(port) && port > 0) return port;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Electron exited before DevTools was ready: ${logs()}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Electron DevTools port did not appear within 10s: ${logs()}`);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function cleanupGoldenRuntime(runtime: GoldenRuntime): Promise<{
  gracefulExit: boolean;
  daemonStopped: boolean;
  tempRemoved: boolean;
}> {
  if (runtime.page && runtime.application.exitCode === null && runtime.application.signalCode === null) {
    await runtime.page.evaluate(() => window.coordy.quit()).catch(() => undefined);
  }
  const gracefulExit = await waitForExit(runtime.application, 10_000);
  if (!gracefulExit && runtime.application.exitCode === null && runtime.application.signalCode === null) {
    runtime.application.kill("SIGTERM");
    await waitForExit(runtime.application, 5_000);
  }
  await runtime.browser?.close().catch(() => undefined);
  if (runtime.daemonPid > 0) {
    const deadline = Date.now() + 10_000;
    while (processExists(runtime.daemonPid) && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }
  const daemonStopped = runtime.daemonPid <= 0 || !processExists(runtime.daemonPid);
  if (!runtime.runtimeRoot.startsWith(join(runtime.temporaryRoot, "cdy-e2e-"))) {
    throw new Error(`refusing to remove unexpected golden path: ${runtime.runtimeRoot}`);
  }
  rmSync(runtime.runtimeRoot, { recursive: true, force: true });
  return {
    gracefulExit,
    daemonStopped,
    tempRemoved: !existsSync(runtime.runtimeRoot),
  };
}

let activeRuntime: GoldenRuntime | null = null;

test.afterEach(async () => {
  if (!activeRuntime) return;
  try {
    await cleanupGoldenRuntime(activeRuntime);
  } finally {
    activeRuntime = null;
  }
});

test("clean Electron state completes the real coordyd product spine and terminates its child", async () => {
  const temporaryRoot = process.platform === "darwin" ? "/private/tmp" : tmpdir();
  const runtimeRoot = mkdtempSync(join(temporaryRoot, "cdy-e2e-"));
  const userData = join(runtimeRoot, "user-data");
  const main = resolve("out/main/index.js");
  const daemon = resolve("../../target/debug/coordyd");
  const cli = resolve("../../target/debug/coordy");
  expect(existsSync(main), "build the desktop before running the golden flow").toBe(true);
  expect(existsSync(daemon), "build coordyd before running the golden flow").toBe(true);
  expect(existsSync(cli), "build coordy so the deterministic ACP stub is discoverable").toBe(true);

  const logs: string[] = [];
  const application = spawn(electronPath, [
    main,
    `--user-data-dir=${userData}`,
    "--remote-debugging-port=0",
  ], {
    env: {
      ...process.env,
      PATH: `${resolve("../../target/debug")}:${process.env.PATH ?? ""}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  application.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  application.stderr?.on("data", (chunk) => logs.push(String(chunk)));
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  let page: import("@playwright/test").Page | null = null;
  const runtime: GoldenRuntime = {
    application,
    browser,
    page,
    daemonPid: 0,
    runtimeRoot,
    temporaryRoot,
  };
  activeRuntime = runtime;
  try {
    const port = await waitForDevtoolsPort(application, userData, () => logs.join(""));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    runtime.browser = browser;
    await expect
      .poll(() => browser?.contexts()[0]?.pages().length ?? 0, { timeout: 10_000 })
      .toBeGreaterThan(0);
    page = browser.contexts()[0]!.pages()[0]!;
    runtime.page = page;
    page.setDefaultTimeout(10_000);
    await expect(page.locator("body")).not.toContainText("Coordy 无法启动");

    await expect
      .poll(() =>
        page.evaluate(async () => {
          const bridge = window.coordy;
          const workspaces = await bridge.view({ actor: { type: "daemon" }, query: { type: "Workspaces" } });
          if (workspaces.type !== "Workspaces" || !workspaces.items[0]) return false;
          const principals = await bridge.view({
            actor: { type: "daemon" },
            query: { type: "Principals", workspace_id: workspaces.items[0].id },
          });
          return principals.type === "Principals" && principals.items.length > 0;
        }),
      )
      .toBe(true);

    const bootstrapIds = await page.evaluate(async (): Promise<BootstrapIds> => {
      const bridge = window.coordy;
      const health = await bridge.view({ actor: { type: "daemon" }, query: { type: "Health" } });
      const workspaces = await bridge.view({ actor: { type: "daemon" }, query: { type: "Workspaces" } });
      if (health.type !== "Health" || workspaces.type !== "Workspaces" || !workspaces.items[0]) {
        throw new Error("golden bootstrap state disappeared");
      }
      const workspaceId = workspaces.items[0].id;
      const principals = await bridge.view({
        actor: { type: "daemon" },
        query: { type: "Principals", workspace_id: workspaceId },
      });
      if (principals.type !== "Principals" || !principals.items[0]) {
        throw new Error("golden principal missing");
      }
      const principalId = principals.items[0].id;
      const runtimes = await bridge.discoverAgents(false);
      if (!runtimes.some((runtime) => runtime.id === "coordy-stub" && runtime.installed)) {
        throw new Error("deterministic coordy-stub runtime was not discovered");
      }
      return {
        workspaceId,
        principalId,
        daemonPid: health.pid,
      };
    });

    runtime.daemonPid = bootstrapIds.daemonPid;
    await page.evaluate(() => {
      window.location.hash = "#/agents/new?harness=coordy-stub";
    });
    await expect(page.getByLabel("名称")).toBeVisible();
    await page.getByLabel("名称").fill("Golden Stub");
    const createAgent = page.getByRole("button", { name: "创建并打开", exact: true });
    await expect(createAgent).toBeEnabled();
    await createAgent.click();
    await expect(page).toHaveURL(/#\/agents\/[^/?#]+$/);
    await expect(page.locator("body")).toContainText("Golden Stub");

    await page.getByRole("button", { name: "搜索", exact: true }).click();
    const palette = page.getByRole("dialog", { name: "搜索", exact: true });
    const paletteInput = palette.getByPlaceholder("搜索页面或命令…");
    await paletteInput.fill("开始");
    await paletteInput.press("Enter");
    await expect(page.getByLabel("事项标题")).toBeVisible();
    await page.getByLabel("事项标题").fill("Golden Electron issue");
    await page.getByLabel("指令").fill("Return one deterministic completion.");
    await page.getByRole("main").getByRole("button", { name: "开始", exact: true }).click();
    await expect(page.locator("body")).toContainText("已派发给智能体");
    await expect(page.locator("body")).toContainText("已结束。", { timeout: 15_000 });
    const openIssue = page.getByRole("button", { name: "打开事项", exact: true });
    await expect(openIssue).toBeVisible();
    await openIssue.click();
    await expect(page).toHaveURL(/#\/board\/[^/?#]+$/);
    await expect(page.locator("body")).toContainText("Golden Electron issue");

    const ids = await page.evaluate(async ({ workspaceId, principalId }): Promise<GoldenIds> => {
      const bridge = window.coordy;
      const health = await bridge.view({ actor: { type: "daemon" }, query: { type: "Health" } });
      const agents = await bridge.view({
        actor: { type: "daemon" },
        query: { type: "Agents", workspace_id: workspaceId },
      });
      const board = await bridge.view({
        actor: { type: "daemon" },
        query: { type: "Board", workspace_id: workspaceId },
      });
      const runs = await bridge.view({
        actor: { type: "daemon" },
        query: { type: "Runs", workspace_id: workspaceId },
      });
      if (
        health.type !== "Health" ||
        agents.type !== "Agents" ||
        board.type !== "Board" ||
        runs.type !== "Runs"
      ) {
        throw new Error("golden final projections have unexpected types");
      }
      const agent = agents.items.find((item) => item.name === "Golden Stub");
      const task = board.tasks.find((item) => item.title === "Golden Electron issue");
      const run = task ? runs.items.find((item) => item.task_id === task.id) : undefined;
      if (!agent || !task || !run) throw new Error("UI-created golden entities are missing");
      return {
        workspaceId,
        principalId,
        agentId: agent.id,
        taskId: task.id,
        runId: run.id,
        daemonPid: health.pid,
      };
    }, bootstrapIds);

    await expect
      .poll(async () =>
        page.evaluate(async (runId) => {
          const result = await window.coordy.view({
            actor: { type: "daemon" },
            query: { type: "Run", run_id: runId },
          });
          return result.type === "Run" ? result.run.status : "missing";
        }, ids.runId),
      )
      .not.toBe("running");

    const runProjection = await page.evaluate(async (runId) =>
      window.coordy.view({ actor: { type: "daemon" }, query: { type: "Run", run_id: runId } }), ids.runId);
    if (runProjection.type !== "Run") throw new Error("missing run projection");
    expect(
      runProjection.run.status,
      `run events: ${JSON.stringify(runProjection.events)}`,
    ).toBe("completed");
    expect(runProjection.events.length).toBeGreaterThanOrEqual(3);
    expect(runProjection.events.some((event) => event.kind === "tool")).toBe(true);

  } finally {
    const cleanup = await cleanupGoldenRuntime(runtime);
    activeRuntime = null;
    expect(cleanup.daemonStopped, "coordyd child remained alive after quit").toBe(true);
    expect(cleanup.tempRemoved, "isolated golden state was not removed").toBe(true);
    expect(cleanup.gracefulExit, `Electron did not quit cleanly: ${logs.join("")}`).toBe(true);
  }
});
