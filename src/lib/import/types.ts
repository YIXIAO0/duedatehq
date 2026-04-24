/**
 * Shared types for the client-list import flow.
 *
 * The same shapes are used across:
 *   - Browser-side parsing (XLSX / CSV / paste)
 *   - AI mapping suggestion endpoint
 *   - Server action that applies the import
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Target fields in DueDateHQ that a source column can be mapped to.
// ---------------------------------------------------------------------------

export const DUEDATE_FIELDS = [
  "clientName",
  "entityName",
  "entityType",
  "homeState",
  "operatingStates",
  "ein",
  "contactEmail",
  "contactPhone",
  "notes",
  "ignore",
] as const;

export const DueDateFieldSchema = z.enum(DUEDATE_FIELDS);
export type DueDateField = z.infer<typeof DueDateFieldSchema>;

export const EntityTypeSchema = z.enum([
  "individual",
  "c_corp",
  "s_corp",
  "partnership",
  "llc",
  "trust",
  "estate",
  "nonprofit",
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

// ---------------------------------------------------------------------------
// Parsed spreadsheet (browser-side output)
// ---------------------------------------------------------------------------

export type CellValue = string | number | null;
export type ParsedRow = Record<string, CellValue>;

export interface ParsedSheet {
  headers: string[];
  rows: ParsedRow[];
  sheetName?: string;
  totalRows: number;
  detectedPreset?: "file-in-time" | null;
}

// ---------------------------------------------------------------------------
// Mapping (source header → DueDateHQ field)
// ---------------------------------------------------------------------------

export type ColumnMapping = Record<string, DueDateField>;

export const MappingSuggestionSchema = z.object({
  mappings: z.array(
    z.object({
      sourceColumn: z.string(),
      targetField: DueDateFieldSchema,
      confidence: z.enum(["high", "medium", "low"]),
      reasoning: z.string().optional(),
    }),
  ),
  // Optional: for entity_type column, how each unique source value maps
  entityTypeNormalization: z
    .array(
      z.object({
        sourceValue: z.string(),
        normalized: EntityTypeSchema.nullable(),
      }),
    )
    .optional(),
});
export type MappingSuggestion = z.infer<typeof MappingSuggestionSchema>;

// ---------------------------------------------------------------------------
// Per-row preview (after mapping is applied)
// ---------------------------------------------------------------------------

export interface MappedRow {
  clientName?: string;
  entityName?: string;
  entityType?: EntityType;
  homeState?: string;
  operatingStates?: string[];
  ein?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
}

export interface RowPreview {
  index: number; // 0-based original row position
  raw: ParsedRow;
  mapped: MappedRow;
  warnings: string[];
  errors: string[]; // non-empty → row is skipped during apply
}

// ---------------------------------------------------------------------------
// Apply-import payload
// ---------------------------------------------------------------------------

export const ApplyImportInputSchema = z.object({
  rows: z.array(
    z.object({
      clientName: z.string().min(1).max(200),
      entityName: z.string().min(1).max(200).optional(),
      entityType: EntityTypeSchema,
      homeState: z
        .string()
        .length(2)
        .regex(/^[A-Z]{2}$/)
        .optional(),
      operatingStates: z
        .array(
          z
            .string()
            .length(2)
            .regex(/^[A-Z]{2}$/),
        )
        .optional(),
      ein: z.string().max(20).optional(),
      contactEmail: z.string().email().optional(),
      contactPhone: z.string().max(50).optional(),
      notes: z.string().max(2000).optional(),
    }),
  ),
});
export type ApplyImportInput = z.input<typeof ApplyImportInputSchema>;

export interface ApplyImportResult {
  clientsCreated: number;
  entitiesCreated: number;
  deadlinesGenerated: number;
  rowsSkipped: number;
  errors: Array<{ rowIndex: number; message: string }>;
}
