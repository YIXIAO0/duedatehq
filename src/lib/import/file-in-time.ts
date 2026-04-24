/**
 * File In Time (CFS / TimeValue Software) CSV-export preset.
 *
 * FIT users can export their client list to CSV. Known column headers
 * (from TimeValue documentation + user uploads). If ≥3 match, we
 * auto-apply the FIT-specific mapping without asking.
 */

import type { ColumnMapping } from "./types";

// Known FIT export column names (case-insensitive match)
const FIT_SIGNATURE_HEADERS = [
  "Client ID",
  "Client Name",
  "Entity Type",
  "Federal ID",
  "Address State",
  "Service",
  "Due Date",
  "Task Status",
  "Period End",
];

export function detectFileInTime(headers: string[]): boolean {
  const lowered = new Set(headers.map((h) => h.trim().toLowerCase()));
  const matches = FIT_SIGNATURE_HEADERS.filter((sig) =>
    lowered.has(sig.toLowerCase()),
  );
  return matches.length >= 3;
}

/**
 * FIT-specific mapping. Applied when detectFileInTime returns true.
 * Any FIT column not listed here maps to 'ignore'.
 */
export const FILE_IN_TIME_MAPPING: ColumnMapping = {
  "Client Name": "clientName",
  "Client ID": "notes", // FIT's internal ID → stash in notes so CPA can cross-reference
  "Entity Type": "entityType",
  "Federal ID": "ein",
  "Address State": "homeState",
  "Email": "contactEmail",
  "Phone": "contactPhone",
  // Tax-filing specific fields we don't directly use:
  "Service": "ignore",
  "Due Date": "ignore", // we recompute all deadlines from our own catalog
  "Task Status": "ignore",
  "Period End": "ignore",
};
