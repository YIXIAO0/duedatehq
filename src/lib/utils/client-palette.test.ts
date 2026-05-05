import { describe, expect, it } from "vitest";
import { paletteForClient, clientInitials } from "./client-palette";

/**
 * Sticky-color rotation for clients. The rule the rest of the app
 * relies on: same client_id → same palette across reloads / pages.
 * If the hash drifts, every avatar / calendar dot / chip changes
 * color overnight.
 */
describe("paletteForClient", () => {
  it("returns a deterministic slot for a given id", () => {
    const a = paletteForClient("client_abc123");
    const b = paletteForClient("client_abc123");
    expect(a.slot).toBe(b.slot);
    expect(a.ring).toBe(b.ring);
    expect(a.bg).toBe(b.bg);
    expect(a.text).toBe(b.text);
  });

  it("returns one of the five known slots", () => {
    const slot = paletteForClient("client_xyz789").slot;
    expect(["rose", "amber", "green", "blue", "violet"]).toContain(slot);
  });

  it("yields different slots across distinct ids (dispersion sanity)", () => {
    // Not strictly guaranteed for any 5 ids, but for these 10
    // hand-picked values we expect at least 3 distinct slots —
    // protects against a regression where the hash collapses to
    // a single bucket.
    const ids = [
      "client_a",
      "client_b",
      "client_c",
      "client_d",
      "client_e",
      "client_f",
      "client_g",
      "client_h",
      "client_i",
      "client_j",
    ];
    const slots = new Set(ids.map((id) => paletteForClient(id).slot));
    expect(slots.size).toBeGreaterThanOrEqual(3);
  });
});

describe("clientInitials", () => {
  it("uses the first two words' initial letters", () => {
    expect(clientInitials("Smith Holdings LLC")).toBe("SH");
  });

  it("falls back to first two chars when only one word", () => {
    expect(clientInitials("Acme")).toBe("AC");
  });

  it("ignores non-alphanumeric leading parts", () => {
    expect(clientInitials("& Associates Inc")).toBe("AI");
  });

  it("uppercases the result regardless of input case", () => {
    expect(clientInitials("john smith")).toBe("JS");
  });
});
