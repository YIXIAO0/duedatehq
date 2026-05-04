/**
 * Column-mapping heuristics: fuzzy-match source spreadsheet headers to
 * DueDateHQ fields, and normalize entity-type strings to our enum.
 *
 * Used as:
 *   1. Fallback when AI Gateway is unavailable.
 *   2. Pre-fill before the AI call lands (perceived speed).
 *   3. Post-validation after AI returns (sanity check).
 */

import type {
  ColumnMapping,
  DueDateField,
  EntityType,
  MappedRow,
  ParsedRow,
  RowPreview,
} from "./types";
import {
  US_STATE_CODES,
  US_STATE_NAME_TO_CODE,
} from "@/lib/constants/us-states";

// ---------------------------------------------------------------------------
// Header alias tables (longest aliases first per field for better matching)
// ---------------------------------------------------------------------------

const FIELD_ALIASES: Record<DueDateField, string[]> = {
  clientName: [
    "client name",
    "customer name",
    "account name",
    "full name",
    "contact name",
    "client",
    "customer",
    "contact",
    "name",
    "account",
  ],
  entityName: [
    "entity name",
    "filer name",
    "business name",
    "legal name",
    "entity",
    "filer",
    "business",
  ],
  entityType: [
    "entity type",
    "filing type",
    "business type",
    "form type",
    "type of entity",
    "structure",
    "type",
    "form",
  ],
  homeState: [
    "home state",
    "domicile state",
    "resident state",
    "state of formation",
    "state",
    "domicile",
    "location",
    "resident",
  ],
  operatingStates: [
    "operating states",
    "other states",
    "states of operation",
    "nexus states",
    "multi-state",
    "nexus",
  ],
  ein: [
    "ein",
    "tax id",
    "federal id",
    "fein",
    "taxpayer id",
    "tin",
    "ssn",
  ],
  contactEmail: ["email", "e-mail", "contact email", "primary email"],
  contactPhone: ["phone", "telephone", "contact phone", "mobile", "cell"],
  notes: ["notes", "comments", "remarks", "memo"],
  ignore: [],
};

// ---------------------------------------------------------------------------
// Entity-type normalization — map messy source values to our enum.
//
// Keys here are ALREADY normalized form: lowercased, punctuation stripped,
// whitespace collapsed. Raw input like "501(c)(3)" → "501 c 3" → matches.
// Raw like "S-Corp." → "s corp" → matches. See normalizeEntityType below.
// ---------------------------------------------------------------------------

const ENTITY_TYPE_MAP: Record<string, EntityType> = {
  // --- Individual ---
  individual: "individual",
  indiv: "individual",
  "1040": "individual",
  person: "individual",
  personal: "individual",
  "sole proprietor": "individual",
  "sole prop": "individual",
  "sole proprietorship": "individual",
  "schedule c": "individual",
  "self employed": "individual",
  contractor: "individual",
  freelancer: "individual",
  freelance: "individual",

  // --- C-Corporation ---
  "c corp": "c_corp",
  "c corporation": "c_corp",
  "1120": "c_corp",
  c: "c_corp",
  ccorp: "c_corp",
  corporation: "c_corp",
  corp: "c_corp",
  inc: "c_corp",
  incorporated: "c_corp",
  // Professional entities — usually C-corp (federal default)
  pc: "c_corp",
  "p c": "c_corp",
  "professional corporation": "c_corp",
  pa: "c_corp",
  "p a": "c_corp",
  "professional association": "c_corp",

  // --- S-Corporation ---
  "s corp": "s_corp",
  "s corporation": "s_corp",
  "1120s": "s_corp",
  "1120 s": "s_corp",
  scorp: "s_corp",
  s: "s_corp",

  // --- Partnership ---
  partnership: "partnership",
  "1065": "partnership",
  lp: "partnership",
  llp: "partnership",
  "general partnership": "partnership",
  gp: "partnership",
  "limited partnership": "partnership",
  "limited liability partnership": "partnership",

  // --- LLC ---
  llc: "llc",
  "l l c": "llc",
  "limited liability": "llc",
  "limited liability company": "llc",
  smllc: "llc",
  mmllc: "llc",
  "single member llc": "llc",
  "multi member llc": "llc",
  disregarded: "llc",
  "disregarded entity": "llc",
  // Professional LLC
  pllc: "llc",
  "p l l c": "llc",
  "professional llc": "llc",

  // --- Trust ---
  trust: "trust",
  "1041": "trust",
  "revocable trust": "trust",
  "irrevocable trust": "trust",
  "grantor trust": "trust",
  "living trust": "trust",
  "testamentary trust": "trust",
  "family trust": "trust",

  // --- Estate ---
  estate: "estate",
  "decedents estate": "estate",
  "decedent estate": "estate",
  deceased: "estate",
  probate: "estate",

  // --- Nonprofit / Tax-exempt ---
  nonprofit: "nonprofit",
  "non profit": "nonprofit",
  "501c3": "nonprofit",
  "501 c 3": "nonprofit",
  "501 c3": "nonprofit",
  "501c": "nonprofit",
  "501c4": "nonprofit",
  "501 c 4": "nonprofit",
  "990": "nonprofit",
  exempt: "nonprofit",
  "tax exempt": "nonprofit",
  charity: "nonprofit",
  foundation: "nonprofit",
};

// ---------------------------------------------------------------------------
// Heuristic column mapping (used as AI fallback)
// ---------------------------------------------------------------------------

export function suggestMappingHeuristic(
  headers: string[],
): ColumnMapping {
  const mapping: ColumnMapping = {};
  const claimedFields = new Set<DueDateField>();

  for (const header of headers) {
    const normalized = header.toLowerCase().trim();
    let matched: DueDateField = "ignore";

    // Prefer the first un-claimed alias match (so we don't map 2 columns
    // to the same target field).
    outer: for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [
      DueDateField,
      string[],
    ][]) {
      if (field === "ignore" || claimedFields.has(field)) continue;
      for (const alias of aliases) {
        if (normalized === alias || normalized.includes(alias)) {
          matched = field;
          claimedFields.add(field);
          break outer;
        }
      }
    }

    mapping[header] = matched;
  }

  return mapping;
}

// ---------------------------------------------------------------------------
// Value normalization helpers
// ---------------------------------------------------------------------------

export function normalizeEntityType(raw: unknown): EntityType | null {
  if (raw == null) return null;
  const key = String(raw)
    .toLowerCase()
    .trim()
    // Replace common separators and punctuation with a single space so
    // "501(c)(3)", "S-Corp.", "L.L.C.", "P.C." all collapse to our keys
    .replace(/[-_/\\.,()]+/g, " ")
    // Collapse any run of whitespace to one space
    .replace(/\s+/g, " ")
    .trim();
  if (!key) return null;
  return ENTITY_TYPE_MAP[key] ?? null;
}

export function normalizeStateCode(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  if (US_STATE_CODES.includes(s)) return s;
  // Full-name fallback ("California" → "CA"). Allows messy CSVs that
  // spell out the state name to still resolve to a valid 2-letter code.
  return US_STATE_NAME_TO_CODE[s] ?? null;
}

export function normalizeOperatingStates(raw: unknown): string[] {
  if (raw == null) return [];
  const s = String(raw).trim();
  return s
    .split(/[,;|\s/]+/)
    .map((x) => normalizeStateCode(x))
    .filter((x): x is string => Boolean(x));
}

// ---------------------------------------------------------------------------
// Apply a column mapping to a raw row → MappedRow + warnings
// ---------------------------------------------------------------------------

export function applyMappingToRow(
  raw: ParsedRow,
  mapping: ColumnMapping,
): { mapped: MappedRow; warnings: string[]; errors: string[] } {
  const mapped: MappedRow = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const [sourceCol, targetField] of Object.entries(mapping)) {
    if (targetField === "ignore") continue;
    const value = raw[sourceCol];
    if (value == null || value === "") continue;

    switch (targetField) {
      case "clientName":
        mapped.clientName = String(value).trim().slice(0, 200);
        break;
      case "entityName":
        mapped.entityName = String(value).trim().slice(0, 200);
        break;
      case "entityType": {
        const normalized = normalizeEntityType(value);
        if (normalized) {
          mapped.entityType = normalized;
        } else {
          warnings.push(
            `Unknown entity type "${value}" — defaulted to Individual`,
          );
          mapped.entityType = "individual";
        }
        break;
      }
      case "homeState": {
        const code = normalizeStateCode(value);
        if (code) mapped.homeState = code;
        else warnings.push(`Invalid state "${value}" — field cleared`);
        break;
      }
      case "operatingStates": {
        const codes = normalizeOperatingStates(value);
        if (codes.length > 0) mapped.operatingStates = codes;
        break;
      }
      case "ein":
        mapped.ein = String(value).trim().slice(0, 20);
        break;
      case "contactEmail": {
        const email = String(value).trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          mapped.contactEmail = email;
        } else {
          warnings.push(`Invalid email "${value}" — field cleared`);
        }
        break;
      }
      case "contactPhone":
        mapped.contactPhone = String(value).trim().slice(0, 50);
        break;
      case "notes":
        mapped.notes = String(value).trim().slice(0, 2000);
        break;
    }
  }

  // Validate required fields
  if (!mapped.clientName) errors.push("Missing client name");
  if (!mapped.entityType) {
    warnings.push("No entity type provided — defaulted to Individual");
    mapped.entityType = "individual";
  }

  // If no entity name provided, default to client name
  if (!mapped.entityName && mapped.clientName) {
    mapped.entityName = mapped.clientName;
  }

  return { mapped, warnings, errors };
}

export function buildRowPreviews(
  rows: ParsedRow[],
  mapping: ColumnMapping,
): RowPreview[] {
  return rows.map((raw, index) => {
    const { mapped, warnings, errors } = applyMappingToRow(raw, mapping);
    return { index, raw, mapped, warnings, errors };
  });
}

// Re-validate a manually-edited MappedRow. Mirrors the validation tail of
// applyMappingToRow without re-parsing raw cells — used by the preview-step
// inline editor so a fixed row can flip from skipped → ready.
export function validateMappedRow(input: MappedRow): {
  mapped: MappedRow;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  const mapped: MappedRow = { ...input };

  if (mapped.contactEmail) {
    const email = mapped.contactEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      warnings.push(`Invalid email "${email}" — field cleared`);
      mapped.contactEmail = undefined;
    } else {
      mapped.contactEmail = email;
    }
  }

  if (!mapped.clientName?.trim()) errors.push("Missing client name");
  if (!mapped.entityType) {
    warnings.push("No entity type provided — defaulted to Individual");
    mapped.entityType = "individual";
  }
  if (!mapped.entityName && mapped.clientName) {
    mapped.entityName = mapped.clientName;
  }

  return { mapped, warnings, errors };
}
