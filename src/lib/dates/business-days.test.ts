import { describe, expect, it } from "vitest";
import { isNonBusinessDay, nextBusinessDay } from "./business-days";

/**
 * Why these tests matter: filed extensions auto-shift to the next
 * business day at write time (see fileExtension service). A bug here
 * silently moves real IRS-relevant dates by one or more days. Edge
 * cases worth pinning down: weekend boundaries, fixed-date federal
 * holidays, and observed-on-Monday Sunday holidays.
 */
describe("isNonBusinessDay", () => {
  it("flags Saturdays as non-business", () => {
    // 2026-04-25 is a Saturday
    expect(isNonBusinessDay("2026-04-25")).toBe(true);
  });

  it("flags Sundays as non-business", () => {
    // 2026-04-26 is a Sunday
    expect(isNonBusinessDay("2026-04-26")).toBe(true);
  });

  it("treats normal weekdays as business days", () => {
    // 2026-04-15 is Wednesday — Tax Day, but a working day
    expect(isNonBusinessDay("2026-04-15")).toBe(false);
  });

  it("flags fixed-date federal holidays (July 4, Christmas)", () => {
    expect(isNonBusinessDay("2026-07-04")).toBe(true); // Independence Day
    expect(isNonBusinessDay("2026-12-25")).toBe(true); // Christmas
  });
});

describe("nextBusinessDay", () => {
  it("is idempotent on a normal weekday", () => {
    const result = nextBusinessDay("2026-04-15"); // Wed
    expect(result.date).toBe("2026-04-15");
    expect(result.shifted).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("shifts a Saturday forward to the following Monday", () => {
    const result = nextBusinessDay("2026-04-25"); // Sat
    expect(result.date).toBe("2026-04-27"); // Mon
    expect(result.shifted).toBe(true);
    expect(result.reason).toBe("weekend");
  });

  it("shifts a Sunday forward to the next Monday", () => {
    const result = nextBusinessDay("2026-04-26"); // Sun
    expect(result.date).toBe("2026-04-27");
    expect(result.shifted).toBe(true);
  });

  it("walks past a holiday + weekend chain", () => {
    // 2026-07-04 is Saturday Independence Day. Federal observance
    // moves to Friday 2026-07-03, but the raw date itself is still
    // a non-business day → walking forward from Saturday should
    // skip Sunday too and land on Monday 2026-07-06.
    const result = nextBusinessDay("2026-07-04");
    expect(result.date).toBe("2026-07-06");
    expect(result.shifted).toBe(true);
  });
});
