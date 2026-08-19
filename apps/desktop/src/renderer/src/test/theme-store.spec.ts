import { describe, expect, it } from "vitest";
import { DEFAULT_FONT_SIZE_PX, FONT_SIZE_VALUES, nextFontSize } from "../state/theme-store";

describe("global font size", () => {
  it("defaults to 18px and steps through the allowed scale", () => {
    expect(DEFAULT_FONT_SIZE_PX).toBe(18);
    expect(FONT_SIZE_VALUES).toEqual([14, 16, 18, 20, 22]);
    expect(nextFontSize(18, 1)).toBe(20);
    expect(nextFontSize(22, 1)).toBe(22);
    expect(nextFontSize(14, -1)).toBe(14);
    expect(nextFontSize(16, -1)).toBe(14);
  });
});
