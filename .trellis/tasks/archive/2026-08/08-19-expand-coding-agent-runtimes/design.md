# Design

## Catalog and selection

Keep one `DiscoveredAgentView` catalog. Native built-ins are always present and report whether their executable resolves. ACP Registry entries remain present when they provide an `npx`, `uvx`, or platform command. The picker renders the complete first-class catalog plus launchable Registry integrations: ready entries first, on-demand entries next, then disabled missing first-class entries, with alphabetical ordering inside each group. A selected legacy ID is canonicalized without creating duplicates.

## Provider protocols

- Hermes: local `hermes acp` over Coordy's existing ACP client.
- Grok Build: `grok --no-auto-update agent --always-approve stdio` when local, with Registry `npx` fallback. Extend the generic ACP startup only for an auth method explicitly advertised by `initialize`; fail if no advertised method can be selected.
- Antigravity: local `agy -p <prompt>` native text stream. Pass an explicit model only when configured. Do not invent structured tool events the CLI does not emit.

The complete Multica runtime matrix in `research/full-multica-runtime-matrix.md` is the protocol source of truth for the remaining identities. Reuse a Coordy protocol family only when the real executable and wire format match. Otherwise add the smallest dedicated parser/client and a fake-process contract test. Do not collapse native JSON/JSONL tools into ACP merely because an ACP Registry entry has a similar provider name.

First-class catalog coverage is fixed to: Claude, CodeBuddy, Codex, Copilot, OpenCode, DevEco, OpenClaw, Hermes, Pi, Oh My Pi, Cursor, Kimi, Reasonix, DeepSeek Harness, Kiro, Antigravity, Qoder, Qoder CLI CN, Trae CLI, Grok Build, Qwen Code, QwenPaw, and MiniMax Code. Gemini remains an additional Coordy runtime.

Provider-specific fixed arguments belong to the built-in specification, not user CLI args. User args remain validated after fixed protocol arguments are established.

## Icons and CSP

Keep existing bundled SVG components for current native providers. Add independently drawn local identity marks or consume official Registry icons for every first-class identity. Resolve ACP Registry provider IDs to the Registry CDN icon path for the remaining catalog, restricted by CSP to the exact Registry CDN origin and falling back to a local monitor glyph on failure. No arbitrary icon URL from Registry JSON reaches the renderer, and no Multica icon asset or source is copied.

## UI acceptance matrix

| Axis | Cases |
|---|---|
| Window | 1280x840 baseline; 720x520 minimum |
| Appearance | Light baseline from report; dark smoke check |
| Catalog | loading; installed native; Registry on-demand; missing/failed icon |
| Interaction | closed picker; open picker; keyboard selection; selected chip |

Allowed change: picker text, icon coverage, catalog contents, and list scrolling. Unchanged: form card geometry, model/thinking/access fields, navigation, and create flow.
