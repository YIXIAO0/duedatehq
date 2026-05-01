/**
 * Per-client color rotation. Each client gets a sticky color slot from
 * the Arc DNA palette (rose / amber / green / blue / violet) — used for
 * avatars, calendar dots, mini-cal pile-ups, and chip tints.
 *
 * The slot is deterministic per client_id so the same client always
 * shows up in the same color across pages and reloads.
 *
 * Locked 2026-04-30 with the Arc design direction. See memory
 * project_duedatehq_design.md for the palette rationale.
 */

export type ClientPaletteSlot =
  | "rose"
  | "amber"
  | "green"
  | "blue"
  | "violet";

export type ClientPalette = {
  slot: ClientPaletteSlot;
  /** Saturated dot/ring color (e.g. for calendar dots, status rings). */
  ring: string;
  /** Soft tinted background for avatars, chips, hover states. */
  bg: string;
  /** Deep on-tint text color — meets AA on the matching `bg`. */
  text: string;
};

const PALETTES: Record<ClientPaletteSlot, Omit<ClientPalette, "slot">> = {
  rose: { ring: "#FF7B7B", bg: "#FFD0D0", text: "#8A2B2B" },
  amber: { ring: "#FFB85C", bg: "#FFE0B0", text: "#8A6420" },
  green: { ring: "#5EBD8C", bg: "#C5E8D6", text: "#1F6B41" },
  blue: { ring: "#6FA9DD", bg: "#C9DEF7", text: "#1F4F87" },
  violet: { ring: "#B68FE0", bg: "#DDD2F4", text: "#553B91" },
};

const SLOT_ORDER: ClientPaletteSlot[] = [
  "rose",
  "amber",
  "green",
  "blue",
  "violet",
];

/**
 * Hash a client id (UUID, nanoid, etc.) to a stable [0, 5) bucket.
 * Uses djb2 — fine for 5-bucket dispersion, no crypto strength needed.
 */
function hashClientId(clientId: string): number {
  let h = 5381;
  for (let i = 0; i < clientId.length; i++) {
    h = ((h << 5) + h + clientId.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function paletteForClient(clientId: string): ClientPalette {
  const slot = SLOT_ORDER[hashClientId(clientId) % SLOT_ORDER.length];
  return { slot, ...PALETTES[slot] };
}

/** Deterministic 2-letter avatar initials (e.g. "Smith Holdings" → "SH"). */
export function clientInitials(clientName: string): string {
  const parts = clientName
    .split(/\s+/)
    .filter((p) => p.length > 0 && /[a-zA-Z0-9]/.test(p[0]));
  if (parts.length === 0) return clientName.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
