/**
 * Source registry — single source of truth for which feeds the
 * announcements scraper knows about. Cron fans out to every entry.
 *
 * NB: the `id` field of each SourceConfig is what gets persisted in
 * `announcements.source`, and the dedupe predicate is the unique
 * `(source, external_id)` pair. Don't rename existing source ids
 * without a migration — the dedupe will see existing rows as new
 * and re-insert them.
 */

import type { SourceConfig } from "./types";
import { IRS_NEWSROOM } from "./irs-newsroom";
import { TX_COMPTROLLER } from "./tx-comptroller";

export const SOURCES: Record<string, SourceConfig> = {
  [IRS_NEWSROOM.id]: IRS_NEWSROOM,
  [TX_COMPTROLLER.id]: TX_COMPTROLLER,
};

export const ALL_SOURCE_IDS = Object.keys(SOURCES);

export function getSource(id: string): SourceConfig {
  const s = SOURCES[id];
  if (!s) {
    throw new Error(
      `Unknown source id "${id}". Known: ${ALL_SOURCE_IDS.join(", ")}`,
    );
  }
  return s;
}
