# Research: Full Multica runtime matrix

- Query: What are all runtime identities supported by Multica `main`, what executable and wire contract does each use, and what is the smallest independently implemented Coordy boundary that would make each identity real rather than decorative?
- Scope: mixed (local Multica source, current Coordy source, and the locally cached ACP Registry snapshot)
- Date: 2026-08-19
- Multica source snapshot: `multica-ai/multica` commit `7fdc854c262a516b11ceb50a4a666b217b67f29d`
- Coordy source snapshot: working tree inspected on 2026-08-19; it already contains in-progress Hermes, Grok, and Antigravity work in addition to the original six native families.

## Findings

### Catalog boundary

Multica's canonical backend whitelist contains 22 protocol-family identities, in this exact order: Claude, CodeBuddy, Codex, Copilot, OpenCode, DevEco, OpenClaw, Hermes, Pi, Cursor, Kimi, Reasonix, DSH, Kiro, Antigravity, Qoder, Qoder CLI CN, Trae CLI, Grok, Qwen, QwenPaw, and MiniMax Code. Oh-My-Pi (`omp`) is a twenty-third runtime identity which deliberately reuses the Pi protocol family while retaining its own binary, display name, skills roots, and model discovery. This split is explicit in `server/pkg/agent/agent.go:280-323` and `server/pkg/agent/builtin_runtimes.go:79-100`.

Multica probes the 23 identities independently. The default executable names are authoritative at `server/internal/daemon/agents_probe.go:154-265`. DSH alone requires more than `PATH`: `dsh --profile multica --probe` must return a version-1 JSON probe frame naming runtime `dsh` and protocol version 1 (`agents_probe.go:200-205,269-289`). OpenClaw additionally performs a minimum-version check before executing (`server/pkg/agent/openclaw.go:284-290`).

The locally cached ACP Registry contains 38 entries. Relevant IDs are `claude-acp`, `codebuddy-code`, `codex-acp`, `cursor`, `github-copilot-cli`, `grok-build`, `kimi`, `opencode`, `pi-acp`, `qoder`, and `qwen-code`. A Registry name is only launch metadata for an ACP package. It is not evidence that Coordy implements the native protocol used by the corresponding Multica identity.

### Coverage legend

- **Native**: Coordy has a built-in ID and local binary probe.
- **Registry**: the cached ACP Registry has a related launch entry. This may be an alternate ACP adapter, not the Multica-native contract.
- **Parity**: whether Coordy's inspected implementation currently satisfies the Multica contract including parser/client and session/model semantics.

### 23-runtime implementation matrix

| # | Runtime identity | Binary / probe | Exact launch contract (fixed portion first) | Wire protocol and session semantics | Auth, permission, model, thinking | Current Coordy coverage | Smallest correct independent implementation |
|---:|---|---|---|---|---|---|---|
| 1 | Claude Code (`claude`) | `claude` (fallback `claude-code` is Coordy-only); `PATH` probe | `claude -p --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions --disallowedTools AskUserQuestion [--strict-mcp-config] [--model M] [--effort E] [--max-turns N] [--resume S] ... [--settings P]`; prompt is a stream-JSON stdin frame | Bidirectional Claude stream JSON; parses assistant/thinking/tool/result events; session ID is emitted by the stream and resumed with `--resume` (`claude.go:717-774`) | Existing Claude login/env; bypass permissions; model and effort are CLI flags; resume is explicit | Native + Registry alias (`claude-acp`); **partial parity**: native family exists, but its exact permission/input/session behavior must remain covered by provider tests | Keep Claude family; strengthen one Claude decoder and stdin writer rather than route through ACP |
| 2 | CodeBuddy (`codebuddy`) | `codebuddy`; `PATH` probe | `codebuddy -p --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions --disallowedTools AskUserQuestion EnterPlanMode ExitPlanMode [--model M] [--effort E] [--max-turns N] [--append-system-prompt P] [--resume S] ...` | Claude-derived stream JSON, but provider-specific result/error/tool rules; resume with `--resume` (`codebuddy.go:38-93`) | Existing CodeBuddy auth; bypass permissions; explicit model/effort; no strict MCP flag | Registry `codebuddy-code` only; **no native parity** because the Registry adapter is ACP while this contract is stream JSON | Add a CodeBuddy descriptor that reuses a parameterized Claude stream decoder but owns argv, blocked flags, result mapping, and fixtures |
| 3 | Codex (`codex`) | `codex`; `PATH` plus bundled Codex.app CLI fallback in Multica | `codex app-server --listen stdio:// [normalized config args] [--enable fast_mode]` (`codex.go:257-269`) | Codex app-server JSON-RPC: `initialize`/`initialized`, `thread/start` or `thread/resume`, then `turn/start`; thread ID is the session. Model and reasoning are fields in thread/turn RPCs (`codex.go:1396-1505,1789-1937`) | Codex login/provider config; approval/sandbox are app-server/config state, not an ACP permission loop; model, effort, and service tier are RPC fields | Native + Registry alias; **not exact parity**: Coordy currently uses `codex exec --json`, a different one-shot protocol | Add a dedicated app-server client. Do not stretch the current Codex JSONL parser into JSON-RPC |
| 4 | GitHub Copilot (`copilot`) | `copilot`; `PATH` probe | `copilot -p PROMPT --output-format json --allow-all --no-ask-user [--model M] [--resume S] ...` (`copilot.go:625-643`) | JSONL event stream (`session.start`, assistant/tool/usage/shutdown events); resume by `--resume`; emitted session ID is authoritative | Copilot login; full tools/paths/URLs; model flag; no independent thinking selector (reasoning can appear in events) | Native + Registry alias; **partial parity**: a generic stream decoder exists, not the complete Copilot event/state machine | Keep a Copilot family, add its event decoder and session/usage terminal rules; do not treat it as Claude JSON |
| 5 | OpenCode (`opencode`) | `opencode`; `PATH` probe | `opencode run --format json --dangerously-skip-permissions [--dir CWD] [--model M] [--variant E] [--session S] ...`; prompt is stdin (`opencode.go:34-113`) | OpenCode NDJSON part/event schema; session ID comes from event `sessionID`, resumes through `--session` | Existing OpenCode auth/provider config; bypass flag; model flag; thinking uses provider-specific `--variant` | Native + Registry; **partial parity**: launch family exists, but current Coordy treats its JSON lines as plain text rather than owning the NDJSON schema | Add one OpenCode NDJSON decoder and stdin transport; retain existing family/argv builder |
| 6 | DevEco Code (`deveco`) | `deveco`; `PATH` probe | `deveco run --format json --dangerously-skip-permissions [--dir CWD] [--model M] [--variant E] [--session S] ... PROMPT` (`deveco.go:58-120`) | OpenCode-derived NDJSON with its own types/lifecycle; prompt is final positional, unlike Multica's OpenCode stdin path | DevEco local auth/config; bypass; model and variant flags; MCP injection intentionally unsupported in Multica | None; **no parity** | Parameterize the OpenCode NDJSON parser, but give DevEco its own argv/input policy and provider error mapping |
| 7 | OpenClaw (`openclaw`) | `openclaw`; `PATH` plus minimum-version probe | `openclaw agent [--local] --json --session-id S [--timeout SEC] [--agent AGENT_ID] ... --message PROMPT`; omit `--local` only in gateway mode (`openclaw.go:225-269`) | One whole JSON result blob, not JSONL; adapter must recognize a complete result even if process keeps stdout open; session ID is supplied/generated and extracted from result (`openclaw_stdout.go:23-63`, `openclaw.go:344-530`) | Auth and model belong to OpenClaw config; UI “model” is actually registered OpenClaw agent ID; instructions are prepended to message; no separate thinking control | None; **no parity** | Add a dedicated whole-buffer JSON adapter with completion/idle boundary; do not use generic line parsing |
| 8 | Hermes Agent (`hermes`) | `hermes`; `PATH` probe | `hermes acp [filtered custom args]`, with `HERMES_YOLO_MODE=1` (`hermes.go:137-169,265-307`) | ACP JSON-RPC v1; `initialize`, `session/new` or Hermes `session/resume`, optional `session/set_model`, optional advertised effort config, `session/prompt`; resume may silently yield a new ID and must be detected (`hermes.go:468-640`) | Existing Hermes profile/config auth; env yolo plus ACP request-permission handling; model is session-scoped; thinking applies only if session advertises a compatible option | Native built-in; no Registry entry; **partial parity**: Coordy launches ACP but currently only new-session/set-model/prompt, with no resume/thinking policy | Reuse generic ACP transport plus a Hermes capability/session policy (resume method, yolo env, model/effort behavior) |
| 9 | Pi (`pi`) | `pi`; `PATH` probe | `pi -p --mode json [--session FILE] [--provider PROVIDER] [--model ID] [--thinking E] ...`; prompt is stdin (`pi.go:620-660`) | Pi JSONL events including text/thinking/tool/result; the session identity is a persistent session-file path, created before launch and reused on resume | Provider credentials from Pi config; full tool registry unless user narrows it; model splits `provider/id`; thinking uses `--thinking` | Registry `pi-acp` only; **no native parity** | Add a Pi JSONL decoder and session-file lifecycle. Registry ACP is a different contract |
| 10 | Oh-My-Pi (`omp`) | `omp`; independent `PATH` probe; models via `omp models --json` | Same Pi argv and stdin contract, but executable is `omp` (`builtin_runtimes.go:87-100`) | Same Pi JSON event protocol and file-backed session | OMP config/auth; Pi model/thinking flags; separate model discovery and skills roots | None; **no parity** | Reuse the Pi adapter through a data descriptor; only binary/name/model-discovery differ. This is the clearest legitimate shared implementation |
| 11 | Cursor (`cursor`) | `cursor-agent`; `PATH` probe | `cursor-agent -p --output-format stream-json --yolo [--workspace CWD] [--model M] [--resume S] ...`; prompt is stdin (`cursor.go:970-1006`) | Cursor stream JSON with Cursor-specific thinking/tool/result subtypes; emitted `session_id`; resume flag | Cursor login; yolo; model flag; no separate thinking selection | Native + Registry; **partial parity**: current Coordy puts prompt on argv and uses a broad stream decoder | Keep Cursor family, change prompt to stdin and add Cursor-specific event/session terminal decoder |
| 12 | Kimi Code (`kimi`) | `kimi`; `PATH` probe | `kimi acp [filtered custom args]` (`kimi.go:17-70`) | ACP v1; `initialize`, Kimi `session/resume` or `session/new`, `session/set_model`, `session/set_config_option(configId=thinking)`, `session/prompt` (`kimi.go:214-383`) | Kimi login/config; ACP permission request auto-approval; session-scoped model; explicit thinking config option | Registry `kimi` only; **catalog coverage, no first-class parity** because generic ACP lacks Kimi resume/thinking policy | Reuse ACP transport with Kimi policy; no new wire parser, but a new session-policy descriptor/client hooks are required |
| 13 | Reasonix (`reasonix`) | `reasonix`; `PATH` probe | `reasonix acp --profile balanced --planner auto --sandbox-network auto --sandbox-bash auto --workspace-only [custom]` (`reasonix.go:19-43,62-94`) | ACP v1; Reasonix `session/resume`/`session/new`, set model, advertised effort option, prompt; provider-specific permission/status/usage mapping | Reasonix setup/auth; workspace-only sandbox plus narrowed ACP permission decisions; model/effort session config | None; **no parity** | Reuse ACP transport, but add exact launch policy and provider-specific permission/usage/error hooks |
| 14 | DeepSeek Harness (`dsh`) | `dsh`; must pass `dsh --profile multica --probe` frame validation | `dsh --profile multica --stdio`; then send version-1 JSONL `execute` frame on stdin (`dsh.go:18-61,116-118,204-270`) | Proprietary versioned JSONL, explicitly not ACP. Requires `ready`, then session/text/thinking/tool/usage/result frames keyed by request ID; cancel is a JSONL `cancel` frame (`dsh.go:25-29,372-429`) | DSH bundle owns auth/tools/MCP; execute frame carries provider/model, reasoning effort, cwd, resume ID, MCP servers | None; **no parity** | New dedicated DSH client/parser and probe. It cannot share ACP or ordinary one-shot JSONL launch code |
| 15 | Kiro CLI (`kiro`) | `kiro-cli`; `PATH` probe | `kiro-cli acp --trust-all-tools [custom]` (`kiro.go:20-67`) | ACP v1; `session/load` (not resume), `session/new`, set model, prompt; special completion/error semantics | Kiro login; CLI trust-all plus ACP permission loop; model session-scoped; no Multica thinking setter | None; **no parity** | Reuse ACP transport with `load` resume policy and Kiro terminal/error mapper |
| 16 | Antigravity (`antigravity`) | `agy`; `PATH`; selected model validated through `agy models` | `agy -p PROMPT --dangerously-skip-permissions [--model M] --print-timeout DURATION --log-file PATH [--conversation S] [--add-dir CWD] ...` (`antigravity.go:430-468`) | Plain stdout plus provider log file. Conversation ID and fallback transcript are recovered from the log; resume uses `--conversation` | Existing `agy` login; skip permissions; model is exact catalog ID; no separate thinking (some model names encode thinking) | Native built-in; **not full parity**: current Coordy only sends `-p` and optional model and has no log/session contract | Extend the existing native family with temp log, timeout, cwd, resume, non-empty-output validation, and plain-text streaming |
| 17 | Qoder (`qoder`) | `qodercli`; `PATH` probe | `qodercli --yolo --acp [custom]` (`qoder.go:14-43,77-106`) | ACP v1; Qoder uses `session/resume` rather than `session/load`, then new/set_model/prompt | Logged-in Qoder; yolo; ACP permissions; session model; no Multica thinking setter | Registry `qoder` only; **catalog coverage, no native parity** | Reuse ACP transport with Qoder launch and `resume` method policy |
| 18 | Qoder CLI CN (`qoderclicn`) | `qoderclicn`; independent `PATH` probe | `qoderclicn --yolo --acp [custom]` | Same Qoder ACP client; independent account/config root and runtime ID (`agent.go:293-295`, `qoder.go:39-43`) | Same semantics as Qoder, separate credentials/config | None; **no parity** | One Qoder protocol family with a second data descriptor/binary; independent discovery identity |
| 19 | TRAE CLI (`traecli`) | `traecli`; `PATH` probe | `traecli acp serve --yolo [custom]` (`traecli.go:14-45,89-119`) | ACP v1; advertises loadSession, uses `session/load`, new/set_model/prompt | Logged-in official TRAE CLI (not open-source `trae-cli`); yolo; model session-scoped; no Multica thinking setter | None; **no parity** | Reuse ACP transport with exact two-subcommand launch and load-session policy |
| 20 | Grok Build (`grok`) | `grok`; `PATH` probe | `grok --no-auto-update agent --always-approve [--effort E] [custom] stdio` (`grok.go:54-69,131-150`) | ACP v1 with mandatory advertised auth handshake between `initialize` and session creation; `session/load`, new/set_model/prompt | `authenticate` selects cached token or API-key method; always approve; model via ACP; thinking via process `--effort` | Native + Registry alias (`grok-build`); **partial parity**: auth exists, but generic ACP path has no thinking/resume input and Registry fallback argv is not automatically strengthened to the native fixed contract | Reuse ACP transport; keep Grok auth extension and add Grok launch/thinking/load-session policy. Canonicalize Registry fallback without discarding required fixed flags |
| 21 | Qwen Code (`qwen`) | `qwen`; `PATH` probe | `qwen -p PROMPT --output-format stream-json [--model M] [--resume S] --yolo ...` (`qwen.go:13-63`) | Qwen-specific stream JSON (not ACP) with assistant content blocks, thinking, usage, result, and `session_id` | Existing Qwen login/provider config; yolo; model and resume flags; no independent thinking selector in Multica | Registry `qwen-code` only; **no native parity** because Registry ACP differs from the native stream protocol | Add a dedicated Qwen stream decoder; it may share low-level content helpers with Claude but not Claude's schema |
| 22 | QwenPaw (`qwenpaw`) | `qwenpaw`; `PATH`; Multica minimum supported v2.0.1 | `qwenpaw acp [extra/custom] [--workspace ISOLATED_PATH]` (`qwenpaw.go:13-49,54-95`) | ACP v2 surface; `session/load`/new/prompt with QwenPaw coding-project `_meta`; no set_model | Runtime login/config; ACP permission loop; model selection deliberately disabled because set_model mutates shared agent config; no thinking override | None; **no parity** | Reuse ACP transport with protocol/capability policy, workspace metadata, and an explicit “runtime-managed model” capability |
| 23 | MiniMax Code (`mcode`) | `mcode`; `PATH` probe | `mcode acp [filtered extra/custom]` (`mcode.go:16-38,74-106`) | ACP v1; current server advertises `loadSession:false`; fresh session/new/prompt only. Resume must return a typed rejection, not silently start fresh | `mcode login`/runtime owns auth, permission, questionnaires, and model; no session model/thinking selection | None; **no parity** | Reuse ACP framing but add capability-gated resume and model-disabled policy plus MiniMax request-loop handling |

### Protocol-family consolidation decision

The 23 identities do **not** require 23 unrelated transports, but they also cannot be collapsed into “ACP plus plain stdout.” The smallest safe family plan is:

1. **Claude stream JSON family**: Claude and CodeBuddy share framing/content mechanics. They still need separate argv and provider result/error policy.
2. **Codex app-server client**: Codex alone. This is a new JSON-RPC client, distinct from Coordy's current `codex exec --json` adapter.
3. **Provider-specific one-shot JSON/JSONL**:
   - Copilot JSONL (dedicated state machine),
   - OpenCode/DevEco NDJSON (shared decoder, separate argv/input policies),
   - OpenClaw whole-buffer JSON (dedicated),
   - Pi/OMP JSONL (shared adapter plus descriptors),
   - Cursor stream JSON (dedicated subtype mapping),
   - Qwen stream JSON (dedicated),
   - Antigravity text+log (dedicated),
   - DSH versioned bidirectional JSONL (dedicated client).
4. **ACP transport plus provider policies**: Hermes, Kimi, Reasonix, Kiro, Qoder/Qoder CN, Trae, Grok, QwenPaw, and MCode can share JSON-RPC framing, session-update decoding, filesystem callbacks, and permission-request plumbing. They require declarative or small hook-level differences for:
   - launch argv and environment,
   - resume method (`session/resume`, `session/load`, or unsupported),
   - auth (Grok mandatory advertised `authenticate`),
   - model capability and method,
   - thinking control (Kimi config option, Hermes/Reasonix advertised option, Grok process flag),
   - provider terminal/error semantics.

This yields **nine reusable transport/parser groups plus provider policies**, not one generic parser and not 23 copies. A shared abstraction is justified only inside the concrete pairs/groups above.

### Fake CLI contract matrix

Every first-class identity should have a process fixture that validates the fixed argv before emitting success. The fixture must also have a malformed-output or non-zero mode proving failure remains visible. Tests should assert the final message/session path, not only that spawn succeeded.

| Runtime(s) | Minimum successful fake contract | Mandatory negative case |
|---|---|---|
| Claude, CodeBuddy | Script records argv, reads one stream-JSON input frame, emits session/status + assistant + terminal result JSONL | malformed JSON before terminal result and exit non-zero |
| Codex | Fake app-server asserts initialize → initialized → thread/start (or resume) → turn/start; emits thread and completed turn notifications | missing thread ID, JSON-RPC error, and malformed frame |
| Copilot | Emit `session.start`, assistant message, and terminal/shutdown JSONL with session ID | `session.error` or exit non-zero |
| OpenCode, DevEco | Assert stdin-vs-positional prompt difference, then emit session and text part NDJSON | malformed part and non-zero exit |
| OpenClaw | Emit one complete documented result blob and optionally keep pipe open briefly to prove protocol-boundary termination | incomplete JSON blob / provider error |
| Pi, OMP | Assert `-p --mode json --session FILE`, read prompt stdin, emit session/text/result event sequence; verify OMP invokes the OMP binary | missing/invalid session event or non-zero exit |
| Cursor | Assert prompt arrives on stdin, emit `session_id`, thinking/tool, assistant, result JSONL | result error or malformed subtype envelope |
| Qwen | Assert prompt/model/resume/yolo argv, emit Qwen assistant content, session ID, result and usage | captured resume-not-found error and malformed stream |
| Antigravity | Assert permission/model/timeout/log/conversation/add-dir argv; write conversation ID/transcript to fake log and non-empty stdout | exit 0 with empty output and exit non-zero must both fail visibly |
| DSH | `--probe` fake emits v1 proof; stdio fake emits ready, reads v1 execute, then session/text/result; accepts cancel frame | wrong protocol version, no ready frame, or result absent |
| Hermes, Kimi, Reasonix, Kiro, Qoder, Qoder CN, Trae, Grok, QwenPaw, MCode | Shared scripted ACP server with per-provider expected argv/capabilities and ordered methods. Assert correct new/load/resume policy, session ID, model/effort behavior, update mapping, and prompt response | malformed initialize, missing session ID, unsupported requested method, request-permission with no safe option, and non-zero exit |
| Grok specifically | Initialize advertises auth methods; assert `authenticate` occurs before `session/new`; assert `--effort` is before final `stdio` | auth failure or no supported advertised method |
| QwenPaw/MCode specifically | Assert no `session/set_model`; QwenPaw receives isolated workspace/meta; MCode rejects resume when loadSession is false | fixture fails if client mutates model or silently drops resume |

### Current Coordy gaps that affect implementation order

- `crates/coordy-harness/src/protocol.rs:56-120` currently lists nine built-ins: the original six plus Hermes, Antigravity, and Grok. Fourteen Multica identities remain absent as built-ins.
- `crates/coordy-harness/src/protocol.rs:134-143` defaults every unknown ID to ACP. This is unsafe for CodeBuddy native, DevEco, OpenClaw, Pi/OMP, DSH, Qwen native, and others: a name can appear runnable while the wire protocol is wrong.
- `crates/coordy-harness/src/native.rs:121-136` has only a broad stream parser for Claude/Cursor/Copilot, a Codex exec parser, and plain-line fallback for OpenCode/Gemini/Antigravity. OpenCode's NDJSON is therefore not semantically decoded today.
- `crates/coordy-harness/src/acp.rs:115-190` supports only initialize, optional Grok auth, new session, optional set_model, and prompt. It has no resume/session-load input, no per-provider model capability, no thinking parameter, and no provider-specific session metadata. This is a useful framing base, not complete support for the ACP group.
- Coordy's current Antigravity launch (`protocol.rs:321-327`) omits permission bypass, print timeout, log file, conversation resume, and add-dir, so it is not yet the stable contract in the Multica source.
- Registry import is functioning and now retains launchable on-demand entries (`crates/coordy-harness/src/discovery.rs:218-297`). The remaining problem is not a Registry fetch failure; it is mistaking Registry discoverability for verified first-class runtime support.

### Recommended implementation boundary

The smallest complete path is to freeze a schema-enforced table of exactly 23 Multica identities plus Gemini, where every row declares `id`, display name, binary candidates, input channel, protocol family, fixed argv builder, session policy, model capability, thinking capability, and fake-contract test ID. Implement families in the consolidation order above and do not mark a row first-class until its fake process exercises a complete successful turn and a visible failure.

The picker may separately show all launchable ACP Registry entries as on-demand integrations. Those entries must retain `protocol_family=acp` and must not satisfy the 23-runtime first-class acceptance assertion unless their actual contract is the matching first-class provider policy.

## Files found

- `multica/server/pkg/agent/agent.go:280-323` — canonical 22 supported backend types.
- `multica/server/pkg/agent/builtin_runtimes.go:79-100` — OMP as independent runtime identity reusing Pi.
- `multica/server/internal/daemon/agents_probe.go:154-289` — binary probes and DSH protocol proof.
- `multica/server/pkg/agent/{claude,codebuddy,codex,copilot,opencode,deveco,openclaw,hermes,pi,cursor,kimi,reasonix,dsh,kiro,antigravity,qoder,traecli,grok,qwen,qwenpaw,mcode}.go` — provider launch and protocol implementations summarized above.
- `multica/server/pkg/agent/models.go:137-288` — model discovery and model-selection capability boundary.
- `multica/server/pkg/agent/thinking.go:12-22` — provider-native thinking vocabularies must round-trip without flattening.
- `crates/coordy-harness/src/protocol.rs:7-154` — current Coordy protocol enum, built-ins, and canonical IDs.
- `crates/coordy-harness/src/native.rs:17-176` — current native spawning and decoder coverage.
- `crates/coordy-harness/src/acp.rs:22-221` — current generic ACP flow and Grok auth.
- `crates/coordy-harness/src/discovery.rs:152-329` — native plus ACP Registry catalog merge.
- `~/Library/Application Support/@coordy/desktop/data/cache/acp-registry.json` — successful local 38-entry Registry snapshot used only to assess catalog coverage.

## External references

- Multica primary source: <https://github.com/multica-ai/multica>, inspected at commit `7fdc854c262a516b11ceb50a4a666b217b67f29d`.
- No secondary web source was needed; exact executable and protocol claims above come from the inspected current source and its captured real-CLI comments/tests.

## Related specs

- `.trellis/spec/guides/cross-layer-thinking-guide.md` — one owner for each external JSON/JSONL/RPC payload contract; consumers must not privately cast provider payloads.
- `.trellis/tasks/08-19-expand-coding-agent-runtimes/prd.md` — all 23 identities require probe, exact launch, parser/client, failure propagation, and fake-process proof.
- `.trellis/tasks/08-19-expand-coding-agent-runtimes/design.md` — Registry discovery and first-class protocol support are separate boundaries.

## Caveats / Not Found

- This is a behavioral specification derived from Multica; it does not recommend copying Multica source, API models, UI, or icon assets.
- “Exact argv” lists daemon-owned fixed arguments and the ordered optional model/thinking/session fields. Provider custom args, wrapper launch prefixes, temporary paths, and generated session IDs are intentionally shown as placeholders.
- Multica contains provider-specific recovery, usage accounting, MCP filtering, cancellation, and diagnostics beyond the minimum fake CLI acceptance boundary. Those are useful evidence but must not be copied wholesale or used to expand Coordy's immediate scope without an observed failure.
- The Coordy coverage column describes the inspected working tree, which includes in-progress changes and may change before implementation begins.
