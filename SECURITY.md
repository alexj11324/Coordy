# Security

- Renderer: `sandbox`, `contextIsolation`, no `nodeIntegration`.
- Every `ipcMain` handler validates the sender URL.
- Preload does not expose `ipcRenderer` or Node.
- Local RPC uses a user-scoped socket and a 0600 token file. No localhost TCP port.
- Private agent memory is local-only and excluded from sync batches.
- API keys stay in environment / OS keychain references, never in SQLite bodies.
