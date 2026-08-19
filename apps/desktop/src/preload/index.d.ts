import type { CoordyDesktopBridge } from "../shared/desktop-bridge";

declare global {
  interface Window {
    coordy: CoordyDesktopBridge;
  }
}

export {};
