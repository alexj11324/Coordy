# Desktop flow contracts

## Scenario: Electron-to-daemon lifecycle

### 1. Scope / Trigger

- Applies whenever Electron starts, polls, reconnects, stops `coordyd`, or launches a terminal.
- Prevents polling from cancelling foreground work and failed startup from leaking a child process.

### 2. Signatures

```ts
new DaemonManager({ userDataPath, binaryPath, spawnProcess?, clientFactory?, waitForSocket? })
createEffectPoller({ client, disconnect, reconnect, onEffects, onHealth })
openTerminalAt(absoluteDirectory, platform?, launcher?)
```

### 3. Contracts

- `DaemonManager.client` is for foreground RPCs; `effectClient` is for subscriptions.
- Register child `error` and `exit` listeners immediately after `spawn()` returns.
- An unexpected child failure may trigger at most one automatic restart. Intentional shutdown never restarts.
- Startup failure closes clients, clears the child reference, terminates the child, and reaches app cleanup.
- Terminal directories must be absolute existing directories. Launch with argv and `shell: false`.
- macOS recreates a missing window on `activate`; other platforms quit after the last window closes.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| binary missing | reject before spawn |
| spawn emits `error` | reject/clean; never an unhandled event |
| socket wait or either authentication fails | close clients, kill child, clear references |
| effect poll times out | reconnect only `effectClient`; foreground RPC continues |
| child exits unexpectedly once | start a new child and authenticate both clients |
| child fails again | report unhealthy; do not loop restarts |
| terminal path is relative/missing/file | reject before launch |
| Windows Terminal missing | fall back to `cmd.exe` with the directory in `cwd` |

### 5. Good / Base / Bad Cases

- Good: kill a healthy daemon once; a new PID answers authenticated health without restarting Electron.
- Base: close and reactivate a macOS window; the same Electron process creates one new window.
- Bad: interpolate a renderer path into a shell string, share one socket between polling and foreground RPCs, or leave a child alive after startup rejects.

### 6. Tests Required

- Unit: hostile path argv, Windows fallback, idempotent cleanup, spawn `EACCES`, wait/connect failure cleanup.
- Integration: delayed foreground RPC completes while the effect poll times out.
- Real daemon: kill the child, assert a new PID and authenticated health.
- Real Electron: close, activate, quit, and assert both Electron and `coordyd` terminate.

### 7. Wrong vs Correct

#### Wrong

```ts
exec(`open -a Terminal "${path}"`);
createEffectPoller({ client: () => daemon.client, disconnect: () => daemon.disconnect() });
```

#### Correct

```ts
spawn("open", ["-a", "Terminal", directory], { shell: false });
createEffectPoller({
  client: () => daemon.effectClient,
  disconnect: () => daemon.disconnectEffectClient(),
});
```

## Scenario: Workspace-scoped async mutations and flow evidence

### 1. Scope / Trigger

- Applies to renderer mutations that can outlive a workspace/actor change and to claims that a visible flow is covered.

### 2. Signatures

```ts
submit(command, actorOverride?)
view(query, actorOverride?)
startAcpRun({ workspaceId, principalId, title, prompt, agentId })
activateWorkspace(workspaceId)
```

### 3. Contracts

- A multi-command mutation captures one actor at invocation and reuses it for every query/submit.
- Apply results and notices only when the invocation scope still matches the current workspace and actor.
- Changing workspace clears principal, agent, and actor before loading the new principal; a failed load must not retain the old actor.
- Route tests may claim component routing only when they mount `AppRouter`.
- Command/query tests may claim boundary coverage, not complete UI interaction.
- The golden flow uses visible controls for agent creation, Home dispatch, completion, and detail navigation; the bridge is only for bootstrap/final assertions.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| old mutation resolves after workspace switch | ignore its UI result in the new scope |
| workspace principal load fails | keep the new workspace with daemon actor and no old identity |
| explicit agent ID is absent from current workspace | reject; do not silently replace it at dispatch |
| route owner is missing | inventory test fails |
| UI golden fails | terminate the exact Electron child, verify daemon gone, remove only the validated temp root |

### 5. Good / Base / Bad Cases

- Good: start in workspace A, switch to B while delayed, then confirm every A envelope uses actor A and B shows no A success notice.
- Base: route inventory maps every route, redirect, and unknown path to an executable assertion.
- Bad: read actor state again after each `await`, or label helper-only tests as full UI coverage.

### 6. Tests Required

- Delayed actor/workspace switch regression across every envelope and UI result attribution.
- Workspace switch success and failed-principal lookup regression.
- AppRouter mounting for every inventory route and redirect.
- Success plus representative failure for each declared command/query boundary.
- Real Electron UI golden: create stub agent, dispatch issue, observe completed/tool events, open detail, graceful quit, child/temp cleanup.

### 7. Wrong vs Correct

#### Wrong

```ts
await submit(createTask); // each call rereads global actor
await submit(assignTask);
```

#### Correct

```ts
const actor = useSession.getState().actor;
await submit(createTask, actor);
await submit(assignTask, actor);
```
