# Expand coding agent runtimes

## Goal

Remove redundant Mac/local CLI labels and make Coordy's first-class runtime support a verified superset of Multica's current catalog, with icons and working launch contracts for every listed agent.

## Requirements

- Remove the redundant host suffix such as `(Mac)` from harness names.
- Remove the `本机 · 原生 CLI` / `本机 · ACP` secondary line from the create-agent picker. The picker should show the agent identity, not implementation trivia.
- Show every runtime Coordy can actually launch: installed native adapters and ACP Registry entries with a launch command. Do not filter the catalog down to already-installed native CLIs.
- Keep every first-class Multica identity plus Gemini visible even when its local binary is missing. Missing first-class entries are disabled with a concise readiness state instead of disappearing; they must not be selectable until launchable.
- Add independently implemented launch support for every runtime family in Multica's current `main`: Claude, CodeBuddy, Codex, GitHub Copilot, OpenCode, DevEco, OpenClaw, Hermes, Pi, Oh My Pi, Cursor, Kimi, Reasonix, DeepSeek Harness, Kiro, Antigravity, Qoder, Qoder CLI CN, Trae CLI, Grok Build, Qwen Code, QwenPaw, and MiniMax Code.
- Retain Coordy's existing Gemini CLI support as an additional first-class runtime.
- A name counts as supported only when Coordy has a verified binary probe, exact launch contract, protocol parser/client, failure propagation, and focused fake-process test. Merely listing a name or finding it in ACP Registry is insufficient.
- Use provider-specific icons. Existing native icons stay local; ACP Registry entries use the Registry's stable icon identity with a local fallback. Do not copy Multica UI or provider source.
- Preserve fail-closed behavior: unknown commands, missing binaries, malformed ACP replies, failed authentication, and non-zero exits must remain visible failures.
- Preserve existing tool-access and worktree boundaries.

## Acceptance Criteria

- [x] The create-agent picker and selected chip never render `(Mac)`, `本机`, `原生 CLI`, or `ACP` as decorative metadata.
- [x] The live 38-entry ACP Registry catalog is visible in the picker instead of being discarded by `installed === false`.
- [x] The picker visibly contains all 23 Multica identities plus Gemini; missing local binaries remain visible but disabled, while ready and on-demand entries remain selectable.
- [x] All 23 Multica runtime identities plus Gemini CLI are present in Coordy's first-class catalog with distinct provider icons or an official Registry icon and a safe local fallback.
- [x] Every Multica runtime identity has a focused fake-process launch test that verifies its executable, fixed arguments, protocol family, and a successful message/session path; non-zero or malformed output fails visibly.
- [x] Hermes launches its ACP server with the correct subcommand and completes a focused fake-session test.
- [x] Grok launches its ACP stdio mode and supports the advertised authentication handshake before session creation.
- [x] Antigravity launches one-shot print mode, streams non-empty output, propagates model selection, and fails on a non-zero exit.
- [x] Existing native adapters and generic ACP Registry sessions keep passing their focused tests.
- [x] Desktop tests, typecheck, production build, Rust harness tests, protocol verification, and diff checks pass.
- [x] Runtime acceptance passes at 1280x840 and 720x520 in the installed macOS app; the open picker is readable, keyboard reachable, and does not disturb the rest of the form.

## Notes

- Multica is reference evidence only. `apps/desktop/AGENTS.md` explicitly forbids copying Multica source.
- Multica currently maintains provider-specific adapters; the immediate Coordy gap is both catalog filtering and missing provider protocols, not copywriting alone.
