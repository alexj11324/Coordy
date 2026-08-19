# Repair runtime discovery and agent creation flows

## Goal

Make runtime discovery, selection, model discovery, and agent creation one consistent and recoverable flow.

## Requirements

- Restore the protocol-owned readiness matrix: `ready` and validated `on_demand` are launchable; `missing` is disabled.
- Use one shared readiness projection in the Harness page, create picker, edit picker, submit validation, tests, and README.
- Carry the clicked Harness ID into the create page and validate it against the live catalog.
- Make configured agent creation atomic in the kernel/protocol so a rejected configuration creates no partial agent.
- On registry refresh failure, retain the last usable cache and expose refresh failure instead of erasing entries.
- Select model-discovery strategy from the concrete runtime transport/command; do not claim a native catalog for an ACP fallback.
- Preserve current provider icon, security, and 23-plus-Gemini catalog invariants.

## Acceptance criteria

- [ ] Ready/on-demand/missing behavior passes the active runtime contract matrix.
- [ ] Clicking Harness B opens create with B selected, including when another saved draft exists.
- [ ] Failure injection during configured creation leaves zero new agents and retry succeeds.
- [ ] Offline refresh preserves cached Registry entries and reports stale/error state.
- [ ] Native, ACP, fallback, unsupported, and failed model discovery return truthful sources.
- [ ] Focused renderer, main, Rust discovery, kernel, protocol, typecheck, and build checks pass.

## Out of scope

- Installing missing third-party CLIs automatically.
- Redesigning renderer actor authentication.

## Open questions

None.
