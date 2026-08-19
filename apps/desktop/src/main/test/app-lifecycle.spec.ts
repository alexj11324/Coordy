import { describe, expect, it, vi } from "vitest";
import {
  createIdempotentCleanup,
  registerAppLifecycle,
  type DesktopAppLifecycle,
} from "../app-lifecycle";

function fakeApp() {
  const handlers = new Map<string, () => void>();
  return {
    app: {
      on: vi.fn((event: string, handler: () => void) => {
        handlers.set(event, handler);
      }),
      quit: vi.fn(),
    } satisfies DesktopAppLifecycle,
    emit(event: string) {
      handlers.get(event)?.();
    },
  };
}

describe("desktop app lifecycle", () => {
  it("recreates the macOS window on activate only when none remain", () => {
    const fixture = fakeApp();
    const createWindow = vi.fn();
    let windows = 1;
    registerAppLifecycle({
      app: fixture.app,
      platform: "darwin",
      windowCount: () => windows,
      createWindow,
      cleanup: vi.fn(),
    });

    fixture.emit("activate");
    windows = 0;
    fixture.emit("activate");

    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(fixture.app.quit).not.toHaveBeenCalled();
  });

  it("quits on last-window-close outside macOS", () => {
    const fixture = fakeApp();
    registerAppLifecycle({
      app: fixture.app,
      platform: "linux",
      windowCount: () => 0,
      createWindow: vi.fn(),
      cleanup: vi.fn(),
    });

    fixture.emit("window-all-closed");

    expect(fixture.app.quit).toHaveBeenCalledTimes(1);
  });

  it("runs cleanup exactly once across repeated quit notifications", () => {
    const fixture = fakeApp();
    const rawCleanup = vi.fn();
    const cleanup = createIdempotentCleanup(rawCleanup);
    registerAppLifecycle({
      app: fixture.app,
      platform: "darwin",
      windowCount: () => 0,
      createWindow: vi.fn(),
      cleanup,
    });

    fixture.emit("before-quit");
    fixture.emit("before-quit");

    expect(rawCleanup).toHaveBeenCalledTimes(1);
  });
});
