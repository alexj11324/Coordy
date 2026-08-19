# Design: desktop IPC and lifecycle

- Extract a platform terminal launch specification `{command, args}` and execute it with `spawn`/`execFile`, `shell: false`; validate with filesystem stat at the IPC entry.
- `DaemonManager` owns separate foreground and subscription clients connected to the same authenticated socket; poller disconnect/reconnect touches only the subscription client.
- Track child identity and `stopping` state. Unexpected exit schedules one serialized restart through the existing spawn/connect path; repeated failure stays unhealthy and observable.
- Centralize timer and daemon teardown behind an idempotent cleanup closure registered with Electron lifecycle events.
- Remove the outer Rust build from `scripts/dev.sh`; the desktop dev launcher remains the single build owner used directly and through the wrapper.

No authority, business command, or retry policy moves into the renderer.
