import { describe, expect, it, vi } from "vitest";
import { findOAuthCallback, registerCoordyProtocol } from "../oauth-deep-link";

describe("OAuth deep links", () => {
  it("extracts only the fixed callback scheme", () => {
    expect(findOAuthCallback(["electron", "coordy://oauth/callback?code=x&state=y"]))
      .toBe("coordy://oauth/callback?code=x&state=y");
    expect(findOAuthCallback(["electron", "https://evil.example/callback"]))
      .toBeNull();
  });

  it("registers packaged and development protocol handlers without shell interpolation", () => {
    const register = vi.fn(() => true);
    expect(registerCoordyProtocol(register, true, "/Electron", "/app/main.js")).toBe(true);
    expect(register).toHaveBeenLastCalledWith("coordy");
    expect(registerCoordyProtocol(register, false, "/Electron", "/app/main.js")).toBe(true);
    expect(register).toHaveBeenLastCalledWith("coordy", "/Electron", ["/app/main.js"]);
  });
});
