/**
 * Spreadsheet parsing — runs in the BROWSER for privacy.
 *
 * Supports:
 *   - .xlsx via xlsx (SheetJS)
 *   - .csv via xlsx (it auto-detects)
 *   - Pasted text (CSV or tab-separated)
 */

import * as XLSX from "xlsx";
import type { ParsedRow, ParsedSheet, CellValue } from "./types";
import { detectFileInTime } from "./file-in-time";

const MAX_ROWS = 5000; // safety limit to avoid browser OOM on malicious input

/**
 * Parse an uploaded file (XLSX or CSV) from its ArrayBuffer.
 */
export function parseFile(buffer: ArrayBuffer): ParsedSheet {
  const wb = XLSX.read(buffer, { type: "array", raw: false, cellDates: true });
  return extractFirstSheet(wb);
}

/**
 * Parse pasted text (CSV or TSV).
 * Detects delimiter automatically.
 */
export function parsePasteText(text: string): ParsedSheet {
  if (!text.trim()) {
    return { headers: [], rows: [], totalRows: 0 };
  }
  // Detect delimiter on first non-empty line
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = tabCount > commaCount ? "\t" : ",";

  // SheetJS parses CSV/TSV if we set FS
  const wb = XLSX.read(text, { type: "string", FS: delimiter, raw: false });
  return extractFirstSheet(wb);
}

function extractFirstSheet(wb: XLSX.WorkBook): ParsedSheet {
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { headers: [], rows: [], totalRows: 0 };
  }
  const sheet = wb.Sheets[sheetName];

  // Convert to JSON. defval ensures every cell has SOME value (even empty)
  // so all rows have consistent keys.
  const json = XLSX.utils.sheet_to_json<Record<string, CellValue>>(sheet, {
    raw: false,
    defval: "",
    blankrows: false,
  });

  if (json.length === 0) {
    return { headers: [], rows: [], sheetName, totalRows: 0 };
  }

  // Truncate at MAX_ROWS
  const truncated = json.slice(0, MAX_ROWS);

  // Headers = keys of first row (SheetJS uses row 1 as headers by default)
  const headers = Object.keys(truncated[0]).filter((h) => h.trim().length > 0);

  // Normalize each row: trim strings, coerce to CellValue
  const rows: ParsedRow[] = truncated.map((row) => {
    const cleaned: ParsedRow = {};
    for (const h of headers) {
      const v = row[h];
      if (v == null || v === "") {
        cleaned[h] = null;
      } else if (typeof v === "number") {
        cleaned[h] = v;
      } else {
        cleaned[h] = String(v).trim();
      }
    }
    return cleaned;
  });

  // Drop rows where ALL cells are null (fully blank row)
  const nonEmptyRows = rows.filter((r) =>
    Object.values(r).some((v) => v !== null && v !== ""),
  );

  return {
    headers,
    rows: nonEmptyRows,
    sheetName,
    totalRows: nonEmptyRows.length,
    detectedPreset: detectFileInTime(headers) ? "file-in-time" : null,
  };
}

/**
 * Extract small sample (first N non-blank rows) for AI mapping suggestion.
 * We send only this to the server — the full sheet stays in the browser.
 */
export function extractSampleForSuggestion(
  sheet: ParsedSheet,
  n = 5,
): Array<Record<string, CellValue>> {
  return sheet.rows.slice(0, n);
}
