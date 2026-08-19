# Research: Desktop IPC and runtime flow audit

- Query: Audit renderer bridge -> preload -> Electron IPC main -> local `coordyd` / protocol / harness for concrete contract mismatches, security or availability failures, and stale runtime-discovery assumptions.
- Scope: internal
- Date: 2026-08-19

## Findings

### 1. Critical — `openTerminal` permits shell-command injection from renderer-controlled paths (confirmed)

**Flow and evidence**

- The preload bridge forwards an arbitrary string without normalization: `apps/desktop/src/preload/index.ts:15`.
- The IPC handler checks only the sender URL, then forwards the path unchanged: `apps/desktop/src/main/index.ts:131-134`.
- `openTerminalAt` escapes only double quotes, interpolates the result into a shell command, and executes it with `child_process.exec`: `apps/desktop/src/main/index.ts:234-251`.
- IPC sender validation establishes origin only; it does not validate the path: `apps/desktop/src/main/security/browser-window-policy.ts:3-11`.

**Reproduction path**

From any renderer context that can invoke the exposed preload API, call `window.coordy.openTerminal()` with a path containing shell substitution, for example a path shaped like `$(<command>)`. On macOS/Linux, command substitution is still evaluated inside the double-quoted string built at `index.ts:238-246`; escaping `"` does not neutralize `$()`, backticks, or other shell syntax. Windows builds likewise interpolate into `cmd /K`.

**Impact**

A renderer compromise or unsafe future caller turns a path-opening convenience API into arbitrary main-process command execution. Context isolation does not mitigate this because the dangerous operation is intentionally exposed by preload.

**Suggested minimal fix**

Use `spawn`/`execFile` with `shell: false` and an argv array (`open`, `-a`, `Terminal`, path on macOS; platform-specific executable/argv elsewhere). Validate that the input is a non-empty absolute directory before launch. Add a test with `$()`, backticks, quotes, spaces, and shell metacharacters proving they remain literal argv content.

**Change ownership**

Pre-existing in `HEAD`; the current uncommitted diff only reformats nearby code.

### 2. High — long RPCs share one sequential socket with a 2-second poll timeout, so the poller cancels unrelated user operations (confirmed)

**Flow and evidence**

- `DaemonClient` owns one socket and multiplexes every request over it: `apps/desktop/src/main/daemon/daemon-client.ts:24-30`, `129-152`.
- Rust reads one request, awaits the full dispatch, writes its response, and only then reads the next frame: `crates/coordy-local-runtime/src/ipc.rs:105-115`.
- Registry refresh may wait up to four seconds for HTTP: `crates/coordy-local-runtime/src/discovery.rs:64-75`.
- Draft completion awaits an external LLM request with no shorter application timeout: `crates/coordy-local-runtime/src/draft.rs:34-39`, `97-131`, `140-173`.
- The effect poll runs every 400 ms: `apps/desktop/src/main/index.ts:205-221`.
- A poll that waits two seconds disconnects the shared client: `apps/desktop/src/main/daemon/effect-poller.ts:43-46`, `60-80`.
- Disconnect rejects **all** pending requests, not just Subscribe: `apps/desktop/src/main/daemon/daemon-client.ts:92-97`, `110-115`.

**Reproduction path**

1. Start a `discoverAgents(true)` refresh whose registry HTTP request takes more than about 2–2.4 seconds, or invoke `CompleteDraft` against a normally latent model endpoint.
2. The next scheduled `Subscribe` is queued behind that request in Rust's per-connection loop.
3. The subscribe timeout fires after two seconds, calls `daemon.disconnect()`, and rejects the original discovery/draft request with `daemon connection closed`, even though the daemon and operation need not have failed.

The Harness page exposes the refresh path at `apps/desktop/src/renderer/src/features/runtimes.tsx:40-45`. `CompleteDraft` currently has no live renderer caller because the AI creation pages are deleted in the uncommitted worktree, so that part is an inactive-path manifestation of the same confirmed transport defect.

**Suggested minimal fix**

Give effect subscription its own `DaemonClient`/socket so a poll timeout cannot close the command/query connection. Keep command timeouts operation-specific. Add an integration test with a delayed non-Subscribe response plus concurrent polling and assert the delayed request completes.

**Change ownership**

Pre-existing in `HEAD`.

### 3. High — `on_demand` runtimes are now labeled and disabled as missing despite the protocol contract (confirmed regression in uncommitted changes)

**Contract and evidence**

- The active runtime spec defines `on_demand` as a validated Registry package launch command and explicitly requires ready/on-demand selectability: `.trellis/spec/backend/runtime-integration-contracts.md:12-17`, `37-43`.
- Harness discovery deliberately emits `installed: false`, `launch_state: "on_demand"`, and `protocol_family: "acp"` for Registry fallbacks: `crates/coordy-harness/src/discovery.rs:255-264`, `274-307`.
- Runtime execution already resolves and runs the concrete Registry command: `crates/coordy-harness/src/discovery.rs:433-455`; `crates/coordy-local-runtime/src/live.rs:133-148`.
- Current UI logic requires `installed` and therefore rejects every on-demand entry: `apps/desktop/src/renderer/src/lib/coordy/labels.ts:205-215`.
- The label collapses all `installed: false` states into `未安装`: `apps/desktop/src/renderer/src/lib/coordy/labels.ts:255-260`.
- Agent editing independently uses `item.installed` as its launch gate: `apps/desktop/src/renderer/src/features/runtime-picker.tsx:25-35`.
- Agent creation disables items based on that collapsed `未安装` label: `apps/desktop/src/renderer/src/features/create-agent/agent-create-form.tsx:277-282`.
- The Harness page groups on-demand entries under “本机尚未安装”: `apps/desktop/src/renderer/src/features/runtimes.tsx:121-128`.
- Current uncommitted tests explicitly encode the contradictory behavior, including disabling Grok on-demand: `apps/desktop/src/renderer/src/test/create-agent.spec.ts:259-343`.

**Reproduction path**

Seed/receive a Registry entry with a valid `npx` distribution and no locally installed binary. Discovery returns `launch_state: "on_demand"`. The Harness page shows it under uninstalled, the create dropdown disables it, and the edit runtime picker disables it, even though the Rust launch path can execute it.

**Suggested minimal fix**

Restore a three-state projection: launchable when `launch_state` is `ready` or `on_demand`; disabled only when `missing`. Render a distinct `按需运行` label/tone. Make `runtimeIsLaunchable` the shared predicate used by both pickers and catalog partitioning. Restore/adjust the tests to assert on-demand selection.

**Change ownership**

Introduced by current uncommitted changes. `HEAD`'s `runtimeIsLaunchable` accepted `on_demand`; the working tree changed it to require `installed` and changed the tests to approve that regression.

### 4. High — a crashed `coordyd` can never be restarted by the desktop process (confirmed availability gap)

**Flow and evidence**

- The manager spawns `coordyd` only in `start`: `apps/desktop/src/main/daemon/daemon-manager.ts:26-57`.
- `reconnect` creates only a new socket client; it never checks or respawns the child: `apps/desktop/src/main/daemon/daemon-manager.ts:60-66`.
- There is no child `error`/`exit` handler on the process created at `daemon-manager.ts:42-53`.
- After reconnect exhaustion, the poller merely enters a cooldown and retries the same dead socket later: `apps/desktop/src/main/daemon/effect-poller.ts:72-90`.

**Reproduction path**

Launch the desktop app, terminate its child `coordyd`, and leave Electron running. The effect poll reports unhealthy and repeatedly attempts `connect(this.socketPath, this.token)`. Nothing creates a replacement daemon, so views and commands remain unavailable until the entire app is restarted.

**Suggested minimal fix**

Track intentional shutdown versus unexpected child exit. On unexpected exit (or a reconnect error proving the socket owner is gone), perform one bounded restart through the existing `start` path, then reconnect. Add a manager-level fake-child test that kills the child and proves a new authenticated socket becomes usable. Do not put unbounded retry policy in the renderer.

**Change ownership**

Pre-existing in `HEAD`.

### 5. Medium — refresh discards a usable stale ACP Registry cache on common network failures (confirmed)

**Flow and evidence**

- A normal non-refresh call uses the fresh cache: `crates/coordy-local-runtime/src/discovery.rs:55-63`.
- During refresh, client-build, send, and body-read errors use `?` on `Option`, immediately returning `None`: `crates/coordy-local-runtime/src/discovery.rs:64-75`.
- Cached fallback is reached only when a response body was obtained but did not contain `"agents"`: `crates/coordy-local-runtime/src/discovery.rs:76-80`.
- `None` is passed to `discover`, which removes Registry-only/on-demand entries from that response: `crates/coordy-local-runtime/src/discovery.rs:83-85`; `crates/coordy-harness/src/discovery.rs:242-312`.

**Reproduction path**

Populate the registry cache, disconnect the network, then click Harness → Refresh (`apps/desktop/src/renderer/src/features/runtimes.tsx:40-45`). `fetch_registry(..., true)` returns `None` instead of the cached body, and the refreshed catalog loses Registry-only runtimes or falls back to builtin `missing` entries.

**Suggested minimal fix**

Attempt the refresh, but use `load_cached_registry(data_dir)` for client construction, transport, non-success HTTP status, body decode, and schema failures. Preserve a separate observable freshness/source indicator if the UI needs to tell users the refresh failed; do not silently erase previously runnable entries.

**Change ownership**

Pre-existing in `HEAD`.

### 6. Medium — model discovery branches on canonical identity before concrete transport (confirmed contract mismatch; partially blocked in UI today)

**Contract and evidence**

- The active spec requires runtime behavior to follow the concrete discovered entry because a canonical native ID may resolve to an ACP Registry fallback: `.trellis/spec/backend/runtime-integration-contracts.md:12-18`, `49-58`.
- Execution follows that rule using `launch_uses_acp` and the concrete catalog entry: `crates/coordy-local-runtime/src/live.rs:133-150`; `crates/coordy-harness/src/discovery.rs:332-343`.
- The new, untracked model-discovery implementation canonicalizes only `runtime.id`: `apps/desktop/src/main/model-discovery.ts:76-84`, `147-162`.
- It returns hard-coded `runtime` results for Qwen/Gemini before examining `runtime.protocol_family`, and rejects every on-demand entry before trying its concrete ACP command: `apps/desktop/src/main/model-discovery.ts:79-99`.
- Although `splitCommand` parses the whole concrete command, only the binary is retained: `apps/desktop/src/main/model-discovery.ts:101-102`, `164-184`; provider-ID tables then reconstruct arguments at `25-47`, `109-132`.
- The IPC layer does fetch the concrete runtime object, but erases its type with casts instead of validating the returned DTO: `apps/desktop/src/main/index.ts:176-188`.

**Reproduction path**

Use a canonical runtime such as Qwen whose local native binary is absent but whose Registry entry supplies an ACP on-demand command. Execution classifies the concrete entry as ACP, while model discovery reports source `runtime` solely because the canonical ID is `qwen`. Once finding 3 is fixed and the entry becomes selectable, the model UI and run transport will disagree about who owns model selection.

**Suggested minimal fix**

Choose discovery strategy from `runtime.protocol_family` and the full concrete command first, using canonical ID only for provider-specific ACP authentication/policy. Preserve the parsed command argv rather than replacing it with a second table when safe discovery is supported. For on-demand commands, make the product decision explicit: either permit package-runner discovery with clear user consent or return an explicit `on_demand_not_started`/unavailable source; do not claim native runtime ownership.

**Change ownership**

The mismatch is in `apps/desktop/src/main/model-discovery.ts`, which is currently untracked, plus its new uncommitted IPC surface.

### 7. Medium — renderer chooses its own authenticated actor, including `daemon` (confirmed trust-boundary weakness; exploitability depends on renderer-compromise threat model)

**Flow and evidence**

- The public preload API accepts complete `AuthenticatedCommand` and `AuthorizedQuery` envelopes: `apps/desktop/src/shared/desktop-bridge.ts:27-30`; `apps/desktop/src/preload/index.ts:5-7`.
- Renderer helpers explicitly manufacture `{ type: "daemon" }`: `apps/desktop/src/renderer/src/lib/coordy/client.ts:16-21`.
- Main validates only the sender URL and forwards the envelope unchanged: `apps/desktop/src/main/index.ts:90-109`.
- Rust authenticates the socket token but does not bind that connection to an actor; it dispatches the caller-supplied envelope: `crates/coordy-local-runtime/src/ipc.rs:86-103`, `137-144`.
- Kernel authority gives `Actor::Daemon` special capabilities: `crates/coordy-kernel/src/authority.rs:4-13`, `42-47`.
- Sender validation accepts any `file:` URL and any localhost port, rather than the exact packaged renderer/dev-server identity: `apps/desktop/src/main/security/browser-window-policy.ts:3-11`.

**Reproduction path**

From the renderer, call the exposed raw bridge with an actor of `daemon`; the main process and daemon accept that asserted identity. This is used intentionally for bootstrap in `apps/desktop/src/renderer/src/app.tsx:55-77`, but the authority is not limited to bootstrap calls.

**Impact and caveat**

This is a confirmed absence of actor authentication at the IPC boundary, but its severity depends on whether the project treats the renderer as fully trusted. Under an XSS, malicious local file navigation, or compromised dev server, the attacker can assert daemon/principal/agent identity rather than remaining within a main-owned session. The current project documents kernel authority as a core boundary, so this should not be silently treated as type safety.

**Suggested minimal fix**

Keep the authenticated actor/session in main (or daemon connection state), expose command/query payloads rather than caller-complete envelopes, and give bootstrap a narrow one-time main-owned path. Validate the exact expected renderer URL/frame, not the `file:` scheme or localhost family broadly. This is larger than the other minimal fixes and should be planned separately if renderer compromise is in scope.

**Change ownership**

Pre-existing in `HEAD`.

## Files Found

- `apps/desktop/src/shared/desktop-bridge.ts` — renderer-visible typed API; currently exposes raw authenticated envelopes.
- `apps/desktop/src/preload/index.ts` — direct IPC forwarding with no runtime payload validation.
- `apps/desktop/src/main/index.ts` — IPC registration, daemon forwarding, model-discovery bridge, shell integration, and poll scheduling.
- `apps/desktop/src/main/security/browser-window-policy.ts` — renderer-origin check and BrowserWindow hardening.
- `apps/desktop/src/main/daemon/daemon-client.ts` — shared framed socket and pending-request multiplexing.
- `apps/desktop/src/main/daemon/daemon-manager.ts` — child lifecycle and reconnect behavior.
- `apps/desktop/src/main/daemon/effect-poller.ts` — polling timeout, shared-client disconnect, cursor reset, and cooldown.
- `apps/desktop/src/main/model-discovery.ts` — untracked provider/model discovery implementation.
- `apps/desktop/src/renderer/src/lib/coordy/client.ts` — renderer-selected actor envelopes.
- `apps/desktop/src/renderer/src/lib/coordy/labels.ts` — runtime selectability/readiness projection.
- `apps/desktop/src/renderer/src/features/runtime-picker.tsx` — edit-flow runtime selection.
- `apps/desktop/src/renderer/src/features/runtimes.tsx` — catalog grouping and refresh entry point.
- `apps/desktop/src/renderer/src/features/create-agent/agent-create-form.tsx` — creation-flow runtime/model selection.
- `crates/coordy-local-runtime/src/ipc.rs` — authenticated socket handshake and sequential request dispatch.
- `crates/coordy-local-runtime/src/discovery.rs` — Registry fetch/cache and discovered-agent import.
- `crates/coordy-local-runtime/src/draft.rs` — long-running external completion RPC.
- `crates/coordy-local-runtime/src/live.rs` — concrete runtime transport selection.
- `crates/coordy-harness/src/discovery.rs` — ready/on-demand/missing catalog and launch resolution.
- `crates/coordy-kernel/src/authority.rs` — actor permissions.
- `crates/coordy-protocol/src/lib.rs` — Rust wire envelopes and actor DTO.
- `packages/protocol-ts/src/index.ts` — TypeScript wire projections.

## Code Patterns

- Good: execution selects transport from the concrete discovered entry (`crates/coordy-local-runtime/src/live.rs:133-150`).
- Good: Rust rejects oversized inbound frames (`crates/coordy-local-runtime/src/ipc.rs:218-228`).
- Risky: TypeScript main/preload boundaries rely on casts (`as never`, `as {...}`) rather than decoding `unknown` (`apps/desktop/src/main/index.ts:150-159`, `182-198`; `apps/desktop/src/preload/index.ts:8-11`).
- Risky: availability monitoring mutates the same shared client used for foreground RPCs (`apps/desktop/src/main/index.ts:205-221`).
- Regressed: UI re-derives launchability from `installed` instead of the protocol-owned `launch_state` (`apps/desktop/src/renderer/src/lib/coordy/labels.ts:205-215`).

## External References

- No external sources were required; findings are derived from the repository's current source and active Trellis contract.
- Local dependency context: `apps/desktop/package.json:1-39` declares Electron `^35.2.1`; `pnpm-lock.yaml:75-80` resolves Electron 35.7.5 and electron-vite 3.1.0.

## Related Specs

- `.trellis/spec/backend/runtime-integration-contracts.md` — authoritative ready/on-demand/missing, concrete transport, and model/runtime contract.
- `.trellis/spec/guides/cross-layer-thinking-guide.md` — boundary ownership and decode-once guidance.
- `AGENTS.md` — product kernel is the deep business entry; Electron must not own authority; runtime evidence must be program-verified.
- `apps/desktop/AGENTS.md` — desktop-local instructions (read as part of target-code scope).

## Caveats / Not Found

- The task PRD is still a placeholder (`.trellis/tasks/08-19-audit-desktop-app-flows/prd.md:1-16`), so severity is based on the user's stated whole-app flow/bug audit and repository invariants, not frozen acceptance criteria.
- The worktree contains many unrelated/uncommitted edits. No product file was modified. Finding 3 is explicitly a working-tree regression; finding 6 lives in a new untracked file; other findings are present in `HEAD`.
- No runtime exploit command, GUI launch, network call, or product test was executed in this research role. “Confirmed” means the complete reachable code path and contract mismatch are present in source; where exploitability depends on a renderer compromise (finding 7), that dependency is stated.
- `CompleteDraft` has no live renderer reference in the current worktree because two AI creation pages are deleted; the shared-socket cancellation mechanism remains active and is directly reachable through Harness refresh.
- Effect replay resets its cursor to zero after reconnect (`apps/desktop/src/main/daemon/effect-poller.ts:79-81`). Current consumers are largely idempotent query invalidations / monotonic graph revisions, so this was not promoted to a confirmed user-visible bug; it is a performance/replay-risk follow-up.
- The Node client does not cap inbound frame length and lets `JSON.parse` throw from the socket data listener (`apps/desktop/src/main/daemon/daemon-client.ts:74-88`). Because the peer is the authenticated local child and Rust caps its own output by normal DTO size, this is recorded as defensive-hardening rather than a present blocking defect.
