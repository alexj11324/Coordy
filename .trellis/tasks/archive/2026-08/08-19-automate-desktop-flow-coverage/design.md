# Design: automated flow coverage

## Test layers

1. Vitest state/helper tests for exhaustive transition tables.
2. jsdom route/component tests with a typed stateful `window.coordy` fake for deterministic UI actions and failure injection.
3. Main/preload contract tests around extracted handler registration with fake Electron dependencies.
4. Playwright Electron golden flow against the production-like main process and real local daemon in isolated state.

The golden test is deliberately one representative product spine; breadth stays in the faster route/mutation matrix.

## Isolation

- Create a validated temporary directory for Electron user data, daemon socket/state, and artifacts.
- Use the maintained deterministic runtime/stub; no credentials or network dependency.
- Capture logs/screenshots only on failure.
- On teardown, quit Electron, wait for the child daemon, and remove only the validated temporary path.
