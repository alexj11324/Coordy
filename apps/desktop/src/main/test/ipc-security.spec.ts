import { describe, expect, it } from "vitest";
import { validateIpcSender } from "../security/browser-window-policy";

describe("ipc sender policy", () => {
  it("accepts localhost renderer urls", () => {
    const fake = { getURL: () => "http://localhost:5173/" } as Electron.WebContents;
    expect(validateIpcSender(fake)).toBe(true);
  });

  it("rejects remote urls", () => {
    const fake = { getURL: () => "https://evil.example/" } as Electron.WebContents;
    expect(validateIpcSender(fake)).toBe(false);
  });
});
