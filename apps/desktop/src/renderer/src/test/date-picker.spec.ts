import { describe, expect, it, vi } from "vitest";
import { openNativeDatePicker } from "../lib/coordy/date-picker";

describe("openNativeDatePicker", () => {
  it("calls showPicker when the browser exposes it", () => {
    const showPicker = vi.fn();
    const input = { showPicker, focus: vi.fn() } as unknown as HTMLInputElement;
    expect(openNativeDatePicker(input)).toBe(true);
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(input.focus).not.toHaveBeenCalled();
  });

  it("focuses the input when showPicker is missing or throws", () => {
    const focus = vi.fn();
    expect(openNativeDatePicker({ focus } as unknown as HTMLInputElement)).toBe(false);
    expect(focus).toHaveBeenCalledTimes(1);
    const showPicker = vi.fn(() => {
      throw new Error("not allowed");
    });
    const throwing = { showPicker, focus } as unknown as HTMLInputElement;
    expect(openNativeDatePicker(throwing)).toBe(false);
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(2);
  });
});
