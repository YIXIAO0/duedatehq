import { describe, expect, it } from "vitest";
import {
  normalizeEntityType,
  normalizeStateCode,
  normalizeOperatingStates,
} from "./mapping";

/**
 * The CSV import path is "messy human input → clean DB row". Forgiving
 * normalization keeps friction low for CPAs uploading from File In Time
 * / QuickBooks / spreadsheets, but it's load-bearing — if these
 * functions miss a common variant, the user re-types client lists by
 * hand. Pin down the variants we promise to absorb.
 */
describe("normalizeEntityType", () => {
  it("collapses punctuation variants of S-Corp", () => {
    expect(normalizeEntityType("S-Corp")).toBe("s_corp");
    expect(normalizeEntityType("S Corp")).toBe("s_corp");
    expect(normalizeEntityType("S.Corp.")).toBe("s_corp");
    expect(normalizeEntityType("scorp")).toBe("s_corp");
  });

  it("recognises form codes (1040, 1120, 1065, 1041)", () => {
    expect(normalizeEntityType("1040")).toBe("individual");
    expect(normalizeEntityType("1120")).toBe("c_corp");
    expect(normalizeEntityType("1065")).toBe("partnership");
    expect(normalizeEntityType("1041")).toBe("trust");
  });

  it("handles 501(c)(3) punctuation collapse", () => {
    expect(normalizeEntityType("501(c)(3)")).toBe("nonprofit");
  });

  it("returns null for empty / unknown values", () => {
    expect(normalizeEntityType("")).toBeNull();
    expect(normalizeEntityType(null)).toBeNull();
    expect(normalizeEntityType(undefined)).toBeNull();
    expect(normalizeEntityType("not a real entity type")).toBeNull();
  });
});

describe("normalizeStateCode", () => {
  it("returns the upper-case 2-letter code unchanged", () => {
    expect(normalizeStateCode("CA")).toBe("CA");
    expect(normalizeStateCode("ca")).toBe("CA");
    expect(normalizeStateCode("  TX  ")).toBe("TX");
  });

  it("falls back to full-state-name lookup", () => {
    expect(normalizeStateCode("California")).toBe("CA");
    expect(normalizeStateCode("NEW YORK")).toBe("NY");
  });

  it("returns null for invalid input", () => {
    expect(normalizeStateCode("XX")).toBeNull();
    expect(normalizeStateCode("Atlantis")).toBeNull();
    expect(normalizeStateCode(null)).toBeNull();
  });
});

describe("normalizeOperatingStates", () => {
  it("splits comma-separated lists", () => {
    expect(normalizeOperatingStates("CA, TX, NY")).toEqual(["CA", "TX", "NY"]);
  });

  it("handles mixed delimiters and whitespace", () => {
    // The function splits on comma / semicolon / pipe / whitespace / slash
    expect(normalizeOperatingStates("CA;TX|NY")).toEqual(["CA", "TX", "NY"]);
  });

  it("filters out unrecognized tokens", () => {
    // "ZZ" is not a valid US state, should drop silently
    expect(normalizeOperatingStates("CA, ZZ, NY")).toEqual(["CA", "NY"]);
  });

  it("returns an empty array for null / empty input", () => {
    expect(normalizeOperatingStates(null)).toEqual([]);
    expect(normalizeOperatingStates("")).toEqual([]);
  });
});
