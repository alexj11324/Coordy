import { describe, expect, it } from "vitest";
import { formatIsoDate, parseIsoDate } from "../lib/coordy/date-picker";

describe("parseIsoDate", () => {
  it("reads YYYY-MM-DD as a local calendar day", () => {
    const date = parseIsoDate("2026-08-19");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(7);
    expect(date?.getDate()).toBe(19);
  });

  it("ignores a trailing time suffix", () => {
    expect(formatIsoDate(parseIsoDate("2026-08-19T23:00:00.000Z")!)).toBe("2026-08-19");
  });

  it("rejects empty or impossible days", () => {
    expect(parseIsoDate("")).toBeUndefined();
    expect(parseIsoDate("due")).toBeUndefined();
    expect(parseIsoDate("2026-02-31")).toBeUndefined();
  });
});
