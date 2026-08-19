import { spawn } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type {
  DiscoveredAgentView,
  HarnessModelCatalog,
  HarnessModelView,
} from "@coordy/protocol";

const DISCOVERY_TIMEOUT_MS = 15_000;

const ACP_ARGS: Record<string, string[]> = {
  codebuddy: ["--acp"],
  copilot: ["--acp"],
  hermes: ["acp"],
  kimi: ["acp"],
  reasonix: [
    "acp",
    "--profile",
    "balanced",
    "--planner",
    "auto",
    "--sandbox-network",
    "auto",
    "--sandbox-bash",
    "auto",
    "--workspace-only",
  ],
  kiro: ["acp"],
  qoder: ["--yolo", "--acp"],
  qoderclicn: ["--yolo", "--acp"],
  traecli: ["acp", "serve", "--yolo"],
  grok: ["--no-auto-update", "agent", "--always-approve", "stdio"],
};

export const MODEL_DISCOVERY_STRATEGIES = {
  claude: "claude-cli",
  codebuddy: "acp",
  codex: "codex-cli",
  copilot: "acp",
  opencode: "opencode-cli",
  deveco: "opencode-cli",
  openclaw: "openclaw-cli",
  hermes: "acp",
  pi: "pi-cli",
  omp: "omp-cli",
  cursor: "cursor-cli",
  kimi: "acp",
  reasonix: "acp",
  dsh: "dsh-cli",
  kiro: "acp",
  antigravity: "antigravity-cli",
  qoder: "acp",
  qoderclicn: "acp",
  traecli: "acp",
  grok: "acp",
  qwen: "runtime",
  qwenpaw: "runtime",
  mcode: "runtime",
  gemini: "runtime",
} as const;

export async function discoverHarnessModels(
  runtime: DiscoveredAgentView,
): Promise<HarnessModelCatalog> {
  const provider = canonical(runtime.id);
  const [binary, ...launchArgs] = splitCommand(runtime.command);
  if (runtime.protocol_family === "acp") {
    if (runtime.launch_state !== "ready" || !runtime.installed || !binary) {
      return {
        models: [],
        model_selection_supported: true,
        source: "unavailable",
      };
    }
    try {
      return {
        models: dedupe(await discoverAcpModels(binary, launchArgs, provider)),
        model_selection_supported: true,
        source: "discovered",
      };
    } catch {
      return {
        models: [],
        model_selection_supported: true,
        source: "unavailable",
      };
    }
  }
  if (provider === "qwenpaw" || provider === "mcode") {
    return { models: [], model_selection_supported: false, source: "runtime" };
  }
  if (provider === "qwen" || provider === "gemini") {
    return { models: [], model_selection_supported: true, source: "runtime" };
  }
  if (runtime.launch_state !== "ready" || !runtime.installed) {
    return {
      models: [],
      model_selection_supported: true,
      source: "unavailable",
    };
  }

  if (!binary)
    return {
      models: [],
      model_selection_supported: true,
      source: "unavailable",
    };
  try {
    let models: HarnessModelView[] = [];
    if (provider === "claude")
      models = parseClaudeHelp(
        await capture(binary, [...launchArgs, "--help"]),
      );
    else if (ACP_ARGS[provider])
      models = await discoverAcpModels(
        binary,
        launchArgs.length ? launchArgs : ACP_ARGS[provider],
        provider,
      );
    else if (provider === "codex")
      models = parseCodex(
        await capture(binary, [...launchArgs, "debug", "models", "--bundled"]),
      );
    else if (provider === "cursor")
      models = parseCursor(
        await capture(binary, [...launchArgs, "--list-models"]),
      );
    else if (provider === "opencode")
      models = parseOpenCode(
        await capture(binary, [...launchArgs, "models", "--verbose"]),
      );
    else if (provider === "deveco")
      models = parseOpenCode(await capture(binary, [...launchArgs, "models"]));
    else if (provider === "pi")
      models = parsePi(await capture(binary, [...launchArgs, "--list-models"]));
    else if (provider === "omp")
      models = parseOmp(
        await capture(binary, [...launchArgs, "models", "--json"]),
      );
    else if (provider === "antigravity")
      models = parseRows(await capture(binary, [...launchArgs, "models"]));
    else if (provider === "dsh")
      models = parseDsh(
        await capture(binary, [
          ...launchArgs,
          "--profile",
          "multica",
          "--list-models",
        ]),
      );
    else if (provider === "openclaw" && launchArgs.length === 0)
      models = await discoverOpenClaw(binary);
    else {
      return {
        models: [],
        model_selection_supported: false,
        source: "unavailable",
      };
    }
    return {
      models: dedupe(models),
      model_selection_supported: true,
      source: "discovered",
    };
  } catch {
    return {
      models: [],
      model_selection_supported: true,
      source: "unavailable",
    };
  }
}

function canonical(id: string): string {
  return (
    (
      {
        "claude-acp": "claude",
        "codebuddy-code": "codebuddy",
        "codex-acp": "codex",
        "github-copilot-cli": "copilot",
        "gemini-cli": "gemini",
        "grok-build": "grok",
        "pi-acp": "pi",
        "qwen-code": "qwen",
      } as Record<string, string>
    )[id] ?? id
  );
}

function splitCommand(raw: string): string[] {
  const out: string[] = [];
  let token = "";
  let quote = "";
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (quote) {
      if (char === quote) quote = "";
      else if (char === "\\" && i + 1 < raw.length) token += raw[++i];
      else token += char;
    } else if (char === '"' || char === "'") quote = char;
    else if (/\s/.test(char)) {
      if (token) {
        out.push(token);
        token = "";
      }
    } else token += char;
  }
  if (token) out.push(token);
  return out;
}

async function capture(
  binary: string,
  args: string[],
  timeoutMs = DISCOVERY_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("model discovery timed out"));
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout || stderr);
      else
        reject(new Error(stderr || `model discovery exited with code ${code}`));
    });
  });
}

async function discoverAcpModels(
  binary: string,
  args: string[],
  provider: string,
): Promise<HarnessModelView[]> {
  const cwd = await mkdtemp(join(tmpdir(), "coordy-models-"));
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        cwd,
        stdio: ["pipe", "pipe", "ignore"],
        env: process.env,
      });
      let buffer = "";
      let stage: "init" | "auth" | "session" = "init";
      const finish = (value: HarnessModelView[] | Error) => {
        clearTimeout(timer);
        child.kill("SIGKILL");
        value instanceof Error ? reject(value) : resolve(value);
      };
      const send = (id: number, method: string, params: unknown) =>
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        );
      const timer = setTimeout(
        () => finish(new Error("ACP model discovery timed out")),
        DISCOVERY_TIMEOUT_MS,
      );
      child.once("error", (error) => finish(error));
      child.once("close", (code) => {
        if (code !== 0)
          finish(new Error(`ACP model discovery exited with code ${code}`));
      });
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        buffer += chunk;
        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline < 0) break;
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let msg: any;
          try {
            msg = JSON.parse(line);
          } catch {
            finish(new Error("invalid ACP JSON"));
            return;
          }
          if (msg.error) {
            finish(new Error("ACP model discovery failed"));
            return;
          }
          if (stage === "init" && String(msg.id) === "1") {
            const methods = (msg.result?.authMethods ?? []).map((item: any) =>
              typeof item === "string" ? item : (item.id ?? item.methodId),
            );
            if (provider === "grok" && methods.length) {
              const methodId =
                process.env.XAI_API_KEY && methods.includes("xai.api_key")
                  ? "xai.api_key"
                  : methods.includes("cached_token")
                    ? "cached_token"
                    : null;
              if (!methodId) {
                finish(new Error("Grok authentication unavailable"));
                return;
              }
              stage = "auth";
              send(2, "authenticate", { methodId, _meta: { headless: true } });
            } else {
              stage = "session";
              send(2, "session/new", { cwd, mcpServers: [] });
            }
          } else if (stage === "auth" && String(msg.id) === "2") {
            stage = "session";
            send(3, "session/new", { cwd, mcpServers: [] });
          } else if (
            stage === "session" &&
            (String(msg.id) === "2" || String(msg.id) === "3")
          ) {
            finish(parseAcpSession(msg.result));
          }
        }
      });
      send(1, "initialize", {
        protocolVersion: provider === "qwenpaw" ? 2 : 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: "coordy-model-discovery", version: "1" },
      });
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

export function parseAcpSession(result: any): HarnessModelView[] {
  const block = result?.models ?? {};
  const current = block.currentModelId ?? block.current_model_id ?? "";
  const available = block.availableModels ?? block.available_models ?? [];
  const direct = available
    .map((item: any) => ({
      id: String(item.modelId ?? item.model_id ?? "").trim(),
      label: String(item.name ?? item.modelId ?? item.model_id ?? "").trim(),
      default: String(item.modelId ?? item.model_id ?? "") === current,
    }))
    .filter((item: HarnessModelView) => item.id);
  if (direct.length) return direct;
  const config = (result?.configOptions ?? result?.config_options ?? []).find(
    (item: any) =>
      String(item.id ?? item.category).toLowerCase() === "model" ||
      String(item.category).toLowerCase() === "model",
  );
  const selected = config?.currentValue ?? config?.current_value;
  return (config?.options ?? [])
    .map((item: any) => ({
      id: String(item.value ?? "").trim(),
      label: String(item.name ?? item.value ?? "").trim(),
      default: item.value === selected,
    }))
    .filter((item: HarnessModelView) => item.id);
}

export function parseClaudeHelp(output: string): HarnessModelView[] {
  const modelBlock =
    output.match(
      /--model <model>([\s\S]*?)(?=\n\s{2,}-{1,2}[a-zA-Z]|$)/,
    )?.[1] ?? "";
  const aliases = [...modelBlock.matchAll(/['"]([^'"]+)['"]/g)]
    .map((match) => match[1].trim())
    .filter((value) => /^[a-z0-9][a-z0-9._-]*$/i.test(value));
  const effortBlock =
    output.match(
      /--effort <level>([\s\S]*?)(?=\n\s{2,}-{1,2}[a-zA-Z]|$)/,
    )?.[1] ?? "";
  const choices =
    effortBlock
      .match(/\(([^()]*(?:low|medium|high)[^()]*)\)/i)?.[1]
      ?.split(",")
      .map((value) => value.trim())
      .filter((value) => /^[a-z][a-z0-9_-]*$/i.test(value)) ?? [];
  const thinking = choices.map((id) => ({ id, label: id }));
  return [...new Set(aliases)].map((id) => ({
    id,
    label: id.startsWith("claude-")
      ? id
          .split("-")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ")
      : id.charAt(0).toUpperCase() + id.slice(1),
    thinking,
  }));
}

export function parseCodex(output: string): HarnessModelView[] {
  const parsed = JSON.parse(output);
  return (parsed.models ?? [])
    .filter((item: any) => item.visibility !== "hidden")
    .map((item: any) => ({
      id: item.slug,
      label: item.display_name ?? item.slug,
      default: item.priority === 1,
      thinking: (item.supported_reasoning_levels ?? []).map((level: any) => ({
        id: level.effort,
        label: level.effort,
        description: level.description,
      })),
    }));
}

export function parseCursor(output: string): HarnessModelView[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^([A-Za-z0-9][\w./-]*)\s+-\s+(.+)$/);
    if (!match) return [];
    return [
      {
        id: match[1],
        label: match[2].replace(/\s*\([^)]*\)\s*$/, ""),
        default: /default/i.test(match[2]),
      },
    ];
  });
}

export function parseOpenCode(output: string): HarnessModelView[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const id = line.trim().split(/\s+/)[0];
    return id && id.includes("/") && id !== id.toUpperCase()
      ? [{ id, label: id }]
      : [];
  });
}

export function parsePi(output: string): HarnessModelView[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const text = line.trim();
    if (
      !text ||
      /^(warning|error|info|provider)[:\s]/i.test(text) ||
      /--help|usage:|unknown (flag|command)/i.test(text)
    )
      return [];
    const fields = text.split(/\s+/);
    const id = fields[0].includes(":")
      ? fields[0].replace(":", "/")
      : fields[0].includes("/")
        ? fields[0]
        : fields.length > 1
          ? `${fields[0]}/${fields[1]}`
          : "";
    return id.includes("/") ? [{ id, label: id }] : [];
  });
}

export function parseOmp(output: string): HarnessModelView[] {
  const parsed = JSON.parse(output);
  return (parsed.models ?? [])
    .map((item: any) => ({
      id: item.selector || [item.provider, item.id].filter(Boolean).join("/"),
      label: item.name || item.selector || item.id,
    }))
    .filter((item: HarnessModelView) => item.id);
}

function parseRows(output: string): HarnessModelView[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, label] = line.split("\t");
      return { id: id.trim(), label: (label || id).trim() };
    });
}

function parseDsh(output: string): HarnessModelView[] {
  return output.split(/\r?\n/).flatMap((line) => {
    try {
      const frame = JSON.parse(line);
      if (frame.v !== 1 || frame.type !== "models") return [];
      return (frame.models ?? []).map((item: any) => ({
        id: String(item.id ?? ""),
        label: String(item.label ?? item.id ?? ""),
        default: Boolean(item.default),
        thinking: (item.thinking?.supported_levels ?? []).map((level: any) => ({
          id: String(level.value ?? level.id ?? level),
          label: String(level.label ?? level.value ?? level.id ?? level),
        })),
      }));
    } catch {
      return [];
    }
  });
}

async function discoverOpenClaw(binary: string): Promise<HarnessModelView[]> {
  for (const args of [
    ["agents", "list", "--json"],
    ["agents", "list", "--output", "json"],
    ["agents", "list", "-o", "json"],
  ]) {
    try {
      const parsed = JSON.parse(await capture(binary, args));
      const agents = Array.isArray(parsed) ? parsed : parsed.agents;
      if (Array.isArray(agents))
        return agents
          .map((item: any) => ({
            id: String(item.id ?? item.name ?? ""),
            label: item.model
              ? `${item.name ?? item.id} (${item.model})`
              : String(item.name ?? item.id ?? ""),
          }))
          .filter((item: HarnessModelView) => item.id);
    } catch {
      /* try the next supported flag */
    }
  }
  return [];
}

function dedupe(models: HarnessModelView[]): HarnessModelView[] {
  return [
    ...new Map(
      models.filter((model) => model.id).map((model) => [model.id, model]),
    ).values(),
  ];
}
