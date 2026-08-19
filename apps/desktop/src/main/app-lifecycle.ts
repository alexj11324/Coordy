export type DesktopAppLifecycle = {
  on(
    event: "activate" | "window-all-closed" | "before-quit",
    handler: () => void,
  ): unknown;
  quit(): void;
};

export function createIdempotentCleanup(cleanup: () => void): () => void {
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    cleanup();
  };
}

export function registerAppLifecycle(input: {
  app: DesktopAppLifecycle;
  platform: NodeJS.Platform;
  windowCount: () => number;
  createWindow: () => void;
  cleanup: () => void;
}): void {
  input.app.on("activate", () => {
    if (input.platform === "darwin" && input.windowCount() === 0) {
      input.createWindow();
    }
  });
  input.app.on("window-all-closed", () => {
    if (input.platform !== "darwin") input.app.quit();
  });
  input.app.on("before-quit", input.cleanup);
}
