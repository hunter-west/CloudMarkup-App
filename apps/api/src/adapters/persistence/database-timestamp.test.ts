import { describe, expect, it } from "vitest";
import { parseDatabaseTimestamp } from "./database-timestamp.js";

describe("known database timestamptz decoding", () => {
  it.each([
    ["2026-09-14 12:34:56", "2026-09-14T12:34:56.000Z"],
    ["2026-09-14 12:34:56.123456", "2026-09-14T12:34:56.123Z"],
    ["2026-09-14T12:34:56.123Z", "2026-09-14T12:34:56.123Z"],
    ["2026-09-14T08:34:56-04:00", "2026-09-14T12:34:56.000Z"],
    [new Date("2026-09-14T12:34:56.123Z"), "2026-09-14T12:34:56.123Z"],
    ["2024-02-29 00:00:00", "2024-02-29T00:00:00.000Z"],
  ])("normalizes an explicit database timestamp %s", (input, expected) => {
    expect(parseDatabaseTimestamp(input)).toBe(expected);
  });
  it.each([
    null,
    new Date(Number.NaN),
    "2026-09-14T12:34:56",
    "2026-09-14",
    "2026-02-29 00:00:00",
    "2026-09-14 25:00:00",
    "2026-09-14 12:34:56.1234567",
    "2026-09-14 12:34:56 UTC",
  ])("rejects invalid or ambiguous timestamp %s", (input) => {
    expect(parseDatabaseTimestamp(input)).toBeUndefined();
  });
});
