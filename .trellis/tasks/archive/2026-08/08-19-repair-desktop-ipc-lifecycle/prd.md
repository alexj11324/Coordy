# Repair desktop IPC and lifecycle flows

## Goal

Make native desktop boundaries safe and recoverable during terminal launch, long foreground RPCs, daemon crashes, and window lifecycle events.

## Requirements

- Replace shell-string terminal launching with validated absolute-directory argv and `shell: false` process execution.
- Give effect polling an independent daemon client/socket so its timeout cannot disconnect foreground commands or queries.
- Detect unexpected daemon exit and perform one bounded restart/reconnect; never restart during intentional app shutdown.
- Register native Electron lifecycle behavior: macOS activate recreates a missing window; non-macOS last-window close quits; poller/daemon cleanup is idempotent.
- Make the documented dev path compile Rust exactly once.
- Reproduce lifecycle behavior before declaring the symptom fixed.

## Acceptance criteria

- [ ] Hostile terminal path characters remain literal argv and cannot execute shell syntax.
- [ ] A delayed foreground request completes while effect polling times out/reconnects independently.
- [ ] Killing `coordyd` once produces a new healthy authenticated connection without restarting Electron.
- [ ] macOS close/reopen and quit work in a real app run; cleanup occurs once.
- [ ] The root development command contains one Rust build and starts the window.
- [ ] Focused main-process tests plus full desktop test/typecheck/build pass.

## Out of scope

- Full renderer actor-authentication redesign.
- Unbounded retries or distributed recovery.

## Open questions

None.
