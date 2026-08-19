import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  discoverHarnessModels,
  MODEL_DISCOVERY_STRATEGIES,
  parseAcpSession,
  parseClaudeHelp,
  parseCodex,
  parseCursor,
  parseOmp,
  parseOpenCode,
  parsePi,
} from "../model-discovery";

describe("harness model discovery", () => {
  it("defines a truthful strategy for every Multica runtime plus Gemini", () => {
    expect(Object.keys(MODEL_DISCOVERY_STRATEGIES)).toHaveLength(24);
    expect(MODEL_DISCOVERY_STRATEGIES.claude).toBe("claude-cli");
    expect(MODEL_DISCOVERY_STRATEGIES.qwenpaw).toBe("runtime");
    expect(MODEL_DISCOVERY_STRATEGIES.mcode).toBe("runtime");
  });

  it("reads only model selectors and effort levels advertised by the installed Claude CLI", () => {
    expect(
      parseClaudeHelp(
        `Options:\n  --effort <level>  Effort (low, medium, high, xhigh, max)\n  --model <model>   Provide an alias (e.g. 'fable', 'opus', or 'sonnet') or a full name (e.g. 'claude-fable-5').\n  -p, --print       Print and exit\n`,
      ),
    ).toEqual(
      ["fable", "opus", "sonnet", "claude-fable-5"].map((id) => ({
        id,
        label:
          id === "claude-fable-5"
            ? "Claude Fable 5"
            : id.charAt(0).toUpperCase() + id.slice(1),
        thinking: ["low", "medium", "high", "xhigh", "max"].map((level) => ({
          id: level,
          label: level,
        })),
      })),
    );
  });

  it("reads Codex's bundled model and per-model effort catalog", () => {
    expect(
      parseCodex(
        JSON.stringify({
          models: [
            {
              slug: "gpt-live",
              display_name: "GPT Live",
              priority: 1,
              supported_reasoning_levels: [
                { effort: "high", description: "deep" },
              ],
            },
          ],
        }),
      ),
    ).toEqual([
      {
        id: "gpt-live",
        label: "GPT Live",
        default: true,
        thinking: [{ id: "high", label: "high", description: "deep" }],
      },
    ]);
  });

  it("executes the selected installed CLI instead of a renderer catalog", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coordy-model-test-"));
    const fake = join(dir, "codex");
    try {
      await writeFile(
        fake,
        `#!/bin/sh\n[ "$1 $2 $3" = "debug models --bundled" ] || exit 9\nprintf '%s' '{"models":[{"slug":"from-installed-cli","display_name":"Installed CLI model","priority":1,"supported_reasoning_levels":[]}]}'\n`,
      );
      await chmod(fake, 0o755);
      const catalog = await discoverHarnessModels({
        id: "codex",
        name: "Codex",
        installed: true,
        launch_state: "ready",
        command: fake,
        source: "path",
        protocol_family: "codex",
      });
      expect(catalog.models).toEqual([
        {
          id: "from-installed-cli",
          label: "Installed CLI model",
          default: true,
          thinking: [],
        },
      ]);
      expect(catalog.source).toBe("discovered");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("asks the installed Claude CLI for the selectors it actually advertises", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coordy-claude-model-test-"));
    const fake = join(dir, "claude");
    try {
      await writeFile(
        fake,
        `#!/bin/sh
[ "$1" = "--help" ] || exit 9
printf '%s\n' "  --effort <level>  Effort (low, medium, high)"
printf '%s\n' "  --model <model>   Alias ('sonnet') or full name ('claude-local-1')"
printf '%s\n' "  --print           Print and exit"
`,
      );
      await chmod(fake, 0o755);
      const catalog = await discoverHarnessModels({
        id: "claude",
        name: "Claude Code",
        installed: true,
        launch_state: "ready",
        command: fake,
        source: "path",
        protocol_family: "claude",
      });
      expect(catalog.source).toBe("discovered");
      expect(catalog.models).toEqual([
        {
          id: "sonnet",
          label: "Sonnet",
          thinking: ["low", "medium", "high"].map((id) => ({
            id,
            label: id,
          })),
        },
        {
          id: "claude-local-1",
          label: "Claude Local 1",
          thinking: ["low", "medium", "high"].map((id) => ({
            id,
            label: id,
          })),
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses the concrete ACP command for a canonical native fallback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coordy-model-acp-test-"));
    const fake = join(dir, "qwen-acp");
    try {
      await writeFile(
        fake,
        `#!/bin/sh\n[ "$1" = "--acp-fallback" ] || exit 9\nwhile IFS= read -r line; do\n  case "$line" in\n    *initialize*) printf '%s\\n' '{"jsonrpc":"2.0","id":1,"result":{"authMethods":[]}}' ;;\n    *session/new*) printf '%s\\n' '{"jsonrpc":"2.0","id":2,"result":{"models":{"currentModelId":"fallback-model","availableModels":[{"modelId":"fallback-model","name":"Fallback model"}]}}}' ;;\n  esac\ndone\n`,
      );
      await chmod(fake, 0o755);
      const catalog = await discoverHarnessModels({
        id: "qwen-code",
        name: "Qwen Code",
        installed: true,
        launch_state: "ready",
        command: `${fake} --acp-fallback`,
        source: "registry",
        protocol_family: "acp",
      });
      expect(catalog.source).toBe("discovered");
      expect(catalog.models.map((item) => item.id)).toEqual(["fallback-model"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not claim native runtime ownership for an on-demand ACP fallback", async () => {
    const catalog = await discoverHarnessModels({
      id: "qwen-code",
      name: "Qwen Code",
      installed: false,
      launch_state: "on_demand",
      command: "npx qwen-code --acp",
      source: "registry",
      protocol_family: "acp",
    });
    expect(catalog.source).toBe("unavailable");
    expect(catalog.models).toEqual([]);
  });

  it("reports a failed native discovery process as unavailable even if it prints JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coordy-model-failure-test-"));
    const fake = join(dir, "codex");
    try {
      await writeFile(
        fake,
        `#!/bin/sh\nprintf '%s' '{"models":[{"slug":"must-not-leak","display_name":"Bad","priority":1}]}'\nexit 7\n`,
      );
      await chmod(fake, 0o755);
      const catalog = await discoverHarnessModels({
        id: "codex",
        name: "Codex",
        installed: true,
        launch_state: "ready",
        command: fake,
        source: "path",
        protocol_family: "codex",
      });
      expect(catalog.source).toBe("unavailable");
      expect(catalog.models).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads ACP models and the newer configOptions shape", () => {
    expect(
      parseAcpSession({
        models: {
          currentModelId: "m2",
          availableModels: [
            { modelId: "m1", name: "One" },
            { modelId: "m2", name: "Two" },
          ],
        },
      }),
    ).toEqual([
      { id: "m1", label: "One", default: false },
      { id: "m2", label: "Two", default: true },
    ]);
    expect(
      parseAcpSession({
        configOptions: [
          {
            id: "model",
            currentValue: "k3",
            options: [{ value: "k3", name: "K3" }],
          },
        ],
      }),
    ).toEqual([{ id: "k3", label: "K3", default: true }]);
  });

  it("parses each native catalog format without inventing models", () => {
    expect(
      parseCursor(
        "Available models\nauto - Auto (default)\ncomposer-2 - Composer 2\n",
      ),
    ).toEqual([
      { id: "auto", label: "Auto", default: true },
      { id: "composer-2", label: "Composer 2", default: false },
    ]);
    expect(
      parseOpenCode('openai/gpt-x\n{"reasoning":true}\nanthropic/sonnet\n').map(
        (m) => m.id,
      ),
    ).toEqual(["openai/gpt-x", "anthropic/sonnet"]);
    expect(
      parsePi(
        "provider model context\nanthropic claude-x 200k\nopenai:gpt-x\nWarning: ignored\n",
      ).map((m) => m.id),
    ).toEqual(["anthropic/claude-x", "openai/gpt-x"]);
    expect(
      parseOmp(
        '{"models":[{"provider":"openai","id":"gpt-x","selector":"openai/gpt-x","name":"GPT X"}]}',
      ),
    ).toEqual([{ id: "openai/gpt-x", label: "GPT X" }]);
  });
});
