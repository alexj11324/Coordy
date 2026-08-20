import type { IpcMainInvokeEvent, WebContents } from "electron";
import type { AuthSurface, SanitizedAuthState } from "../shared/auth-bridge";
import { IPC } from "../shared/ipc-channels";

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

export type AuthIpcDependencies = {
  handle(channel: string, handler: Handler): void;
  productContents(): WebContents | null;
  state(): SanitizedAuthState;
  open(surface: AuthSurface): Promise<void> | void;
  signOut(): Promise<void> | void;
};

const SURFACES = new Set<AuthSurface>([
  "sign-in",
  "profile",
  "create-organization",
  "manage-organization",
  "organization-list",
]);

export function registerAuthIpc(deps: AuthIpcDependencies): void {
  const product = (event: IpcMainInvokeEvent) => {
    if (event.sender !== deps.productContents()) throw new Error("invalid product ipc sender");
  };
  deps.handle(IPC.authState, (event) => { product(event); return deps.state(); });
  deps.handle(IPC.authOpen, async (event, surface) => {
    product(event);
    if (!SURFACES.has(surface as AuthSurface)) throw new Error("invalid auth surface");
    await deps.open(surface as AuthSurface);
  });
  deps.handle(IPC.authSignOut, async (event) => {
    product(event);
    await deps.signOut();
  });
}
