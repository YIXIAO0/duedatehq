/**
 * Source-pluggable scraper architecture.
 *
 * Each source (IRS Newsroom, CA FTB, TX Comptroller, …) is a small
 * module that knows how to fetch its listing payload and parse it into
 * a uniform ParsedItem[]. The shared workflow takes care of dedupe,
 * AI classification, and DB insert — so adding a new source is just:
 *
 *   1. Write a new module under sources/ exporting `fetch` + `parse`
 *   2. Register it below in SOURCES
 *   3. Add the source id to the cron's fan-out list
 *
 * The `id` field is what gets stored in `announcements.source`. Do not
 * rename existing ids — the dedupe predicate `(source, externalId)` is
 * unique-indexed, so a rename would orphan history.
 */

export type ParsedItem = {
  /** Stable per-source id (RSS guid, IR number, slug). The natural-key
   *  half — paired with `source` for dedupe. */
  externalId: string;
  title: string;
  link: string;
  /** ISO 8601 string. Best-effort if the source publishes a sloppy date. */
  pubDate: string;
  /** Plain text excerpt fed to the AI classifier. ≤ ~1500 chars. */
  description: string;
};

export type SourceConfig = {
  id: string;
  displayName: string;
  fetch: () => Promise<string>;
  parse: (raw: string) => Promise<ParsedItem[]>;
};
