# Coding Runtime Integration Contracts

## Scenario: Add or change a first-class coding runtime

### 1. Scope / Trigger

- Trigger: a runtime ID, executable, launch arguments, wire protocol, permission policy, or discovery state changes.
- A provider name in ACP Registry is discovery metadata, not proof that Coordy implements the provider's native protocol.
- A runtime is first-class only after a real process contract completes one turn and a malformed or failed turn remains visible.

### 2. Signatures

- `BuiltinHarness { id, name, bins, family, fixed_args }` owns stable provider identity and daemon-owned launch arguments.
- `DiscoveredAgentView.launch_state` is one of `ready`, `on_demand`, or `missing`.
- `resolve_launch(kind, configured, registry_json)` returns the concrete executable and arguments.
- Runtime execution must choose transport from the concrete discovered entry. A canonical native ID may resolve to an ACP Registry fallback.

### 3. Contracts

- `ready`: an executable was resolved on the host.
- `on_demand`: a validated Registry package launch command can be executed by an available package runner.
- `missing`: the first-class identity remains visible but cannot be selected or submitted.
- Native structured protocols must observe the provider's terminal-success frame. Receiving text is not sufficient.
- ACP providers share framing but own launch, authentication, model, thinking, workspace metadata, and session capability policies.
- Auto access must stay inside the canonical worktree. Permission escalation requests are rejected; provider bypass flags are Full Access only.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Unknown runtime ID | `unavailable`; never default silently to a native protocol |
| Missing executable without valid on-demand launch | visible `missing`, disabled in every creation path |
| Registry binary archive not installed | `missing`; do not invent a download path |
| Malformed structured frame | `invalid`; do not ignore it after earlier valid text |
| EOF before provider terminal frame | failure |
| Provider terminal status is failed/interrupted | failure with provider detail |
| Auto permission/escalation request | reject/cancel |
| Fixed launch flag appears in `cli_args` | reject before spawning |

### 5. Good / Base / Bad Cases

- Good: `grok` initializes ACP, authenticates using an advertised method, starts a session, emits a message, and completes the prompt.
- Base: a missing `hermes` binary is still shown with its icon and `未安装`, but cannot be selected.
- Bad: a `qwen-code` Registry ACP fallback is displayed as on-demand and then executed by the native Qwen stream parser.
- Bad: a JSON runtime emits one assistant line, then malformed JSON, and Coordy reports success.

### 6. Tests Required

- A schema-enforced set test must cover every first-class identity exactly once.
- Each provider family needs a fake executable that asserts fixed argv/input channel, emits one real successful envelope and terminal frame, and has malformed/non-zero coverage.
- ACP policy tests must assert method order, auth selection, permission rejection in Auto, model/thinking capability, and workspace confinement.
- UI tests must assert ready/on-demand selectability, missing visibility plus disabled state, and submit-time revalidation.
- Cross-layer tests must prove a Registry fallback selects ACP transport instead of the canonical native family.

### 7. Wrong vs Correct

#### Wrong

```rust
// A matching name is treated as native, even when discovery selected ACP.
if protocol_family(kind).uses_acp() { run_acp() } else { run_native() }
```

#### Correct

```rust
// Resolve the concrete catalog entry first; its protocol family owns transport.
let launch = resolved_catalog_entry(kind)?;
match launch.protocol_family.as_str() {
    "acp" => run_acp(launch),
    _ => run_native(launch),
}
```
