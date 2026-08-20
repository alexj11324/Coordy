import type { IpcMainInvokeEvent, WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SanitizedAuthState } from "../../shared/auth-bridge";
import { IPC } from "../../shared/ipc-channels";
import { registerAuthIpc } from "../auth-ipc";

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

describe("browser OAuth IPC", () => {
  const product = {} as WebContents;
  const forged = {} as WebContents;
  const productEvent = { sender: product } as IpcMainInvokeEvent;
  const forgedEvent = { sender: forged } as IpcMainInvokeEvent;
  let handlers: Map<string, Handler>;
  let state: SanitizedAuthState;
  let open: ReturnType<typeof vi.fn>;
  let signOut: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    handlers = new Map();
    state = { status: "signed-out", identity: null, organization: null };
    open = vi.fn();
    signOut = vi.fn();
    registerAuthIpc({
      handle: (channel, handler) => handlers.set(channel, handler),
      productContents: () => product,
      state: () => state,
      open,
      signOut,
    });
  });

  it("exposes sanitized state but never tokens", () => {
    expect(handlers.get(IPC.authState)!(productEvent)).toEqual(state);
    expect(JSON.stringify(handlers.get(IPC.authState)!(productEvent))).not.toContain("token");
    expect(() => handlers.get(IPC.authState)!(forgedEvent)).toThrow("invalid product ipc sender");
  });

  it("allows only fixed browser auth surfaces", async () => {
    await handlers.get(IPC.authOpen)!(productEvent, "sign-in");
    await handlers.get(IPC.authOpen)!(productEvent, "organization-list");
    expect(open).toHaveBeenNthCalledWith(1, "sign-in");
    expect(open).toHaveBeenNthCalledWith(2, "organization-list");
    await expect(handlers.get(IPC.authOpen)!(productEvent, "https://evil.example")).rejects.toThrow("invalid auth surface");
  });

  it("keeps sign-out in the trusted main process", async () => {
    await handlers.get(IPC.authSignOut)!(productEvent);
    expect(signOut).toHaveBeenCalledOnce();
    await expect(handlers.get(IPC.authSignOut)!(forgedEvent)).rejects.toThrow("invalid product ipc sender");
  });
});
