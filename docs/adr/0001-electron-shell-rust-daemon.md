# 0001 Electron shell + Rust daemon

Coordy uses an Electron desktop shell and a separate `coordyd` binary. The daemon outlives the UI, is usable from CLI, and isolates harness crashes.
