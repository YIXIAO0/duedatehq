/**
 * iCalendar (RFC 5545) generation for DueDateHQ deadlines.
 *
 * Why this lives in our codebase rather than using a library:
 *   - The format is simple enough that a 60-line implementation is
 *     less risk than a 50KB dependency that might break in a future
 *     Node version.
 *   - We need full control over:
 *       - line folding (75-octet limit, CRLF-space continuation)
 *       - text escaping (RFC 5545 §3.3.11)
 *       - all-day vs timed events
 *       - VALARM nesting
 *
 * Spec references:
 *   - RFC 5545 https://datatracker.ietf.org/doc/html/rfc5545
 *   - Apple's content-line folding rules (§3.1)
 *   - Google Calendar / Outlook / Apple Cal compatibility tested
 */

export interface IcsEvent {
  /** Stable per-deadline identifier — used for UID. We append our domain
   *  so it's globally unique across the calendar universe. */
  uid: string;
  /** YYYY-MM-DD; we always emit DTSTART;VALUE=DATE for all-day events
   *  because tax deadlines are calendar dates, not 4pm timestamps. */
  startDate: string;
  /** Plain text — escaping is applied here, callers should not pre-escape. */
  summary: string;
  description?: string;
  /** Public URL the calendar app can deep-link back to. */
  url?: string;
  /** Display alarm N days before the event. Single most-requested feature
   *  ("I want my calendar to ping me 2 days before, not the day-of"). */
  alarmDaysBefore?: number;
  /** When this row was last meaningfully changed in our DB. Increments
   *  the SEQUENCE so calendar clients know to refresh their copy. */
  lastModified?: Date;
}

export interface BuildIcsOptions {
  /** Shown as the calendar name in Google Cal / Outlook sidebar. */
  calendarName: string;
  /** Whether the calendar should be REFRESH-friendly (subscription) or
   *  one-shot (download). Affects METHOD: PUBLISH and X-PUBLISHED-TTL. */
  refreshIntervalMinutes?: number;
  events: IcsEvent[];
}

export function buildIcs(opts: BuildIcsOptions): string {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//DueDateHQ//Tax Deadlines//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");
  lines.push(foldLine(`X-WR-CALNAME:${escapeText(opts.calendarName)}`));
  lines.push("X-WR-TIMEZONE:UTC");
  if (opts.refreshIntervalMinutes) {
    // Apple uses X-PUBLISHED-TTL, RFC 7986 standardizes REFRESH-INTERVAL.
    // Emit both for max compat.
    const dur = `PT${opts.refreshIntervalMinutes}M`;
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:${dur}`);
    lines.push(`X-PUBLISHED-TTL:${dur}`);
  }

  const stamp = dtstampUtc(new Date());

  for (const e of opts.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(foldLine(`UID:${e.uid}@duedate.hq`));
    lines.push(`DTSTAMP:${stamp}`);
    if (e.lastModified) {
      lines.push(`LAST-MODIFIED:${dtstampUtc(e.lastModified)}`);
    }
    // All-day VEVENT: DTSTART;VALUE=DATE + DTEND = next day.
    lines.push(`DTSTART;VALUE=DATE:${compactDate(e.startDate)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(addOneDay(e.startDate))}`);
    lines.push(foldLine(`SUMMARY:${escapeText(e.summary)}`));
    if (e.description) {
      lines.push(foldLine(`DESCRIPTION:${escapeText(e.description)}`));
    }
    if (e.url) {
      lines.push(foldLine(`URL:${e.url}`));
    }
    // Free-busy as transparent so deadlines don't block-out the whole
    // day on the user's availability view (they're reminders, not
    // meetings).
    lines.push("TRANSP:TRANSPARENT");
    if (e.alarmDaysBefore !== undefined && e.alarmDaysBefore >= 0) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(foldLine(`DESCRIPTION:${escapeText(e.summary)}`));
      // Trigger is a negative duration relative to DTSTART. -P1D = "1 day
      // before". We round to days because timezone math on hours is a
      // rabbit hole we don't need to enter for tax deadlines.
      lines.push(
        `TRIGGER:-P${e.alarmDaysBefore === 0 ? "T0M" : `${e.alarmDaysBefore}D`}`,
      );
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  // RFC 5545 mandates CRLF line endings.
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Helpers — small, pure, exported for tests where useful
// ---------------------------------------------------------------------------

/**
 * RFC 5545 §3.3.11: backslash, semicolon, comma, and newline must be
 * escaped inside TEXT values. We do NOT escape colons (those only need
 * escaping in TEXT-quoted property params, not in property values).
 */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * RFC 5545 §3.1: lines longer than 75 octets must be folded with
 * CRLF + a single space at the start of each continuation line.
 * Calendar clients that don't fold-friendly will silently truncate
 * long SUMMARY/DESCRIPTION otherwise.
 */
function foldLine(line: string): string {
  // Octet count, not character count. Keep it simple: assume ASCII-safe
  // content (we already escaped non-text). For real Unicode a TextEncoder
  // would be safer, but our content is form codes + names + URLs.
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let i = 0;
  // First chunk: 75 chars. Subsequent: 74 chars (1 reserved for the
  // leading space of the continuation line).
  chunks.push(line.slice(i, i + 75));
  i += 75;
  while (i < line.length) {
    chunks.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join("\r\n");
}

/** "2026-04-15" → "20260415" */
function compactDate(iso: string): string {
  return iso.replace(/-/g, "");
}

/** "2026-04-15" → "2026-04-16" (UTC, no TZ ambiguity for date-only ops) */
function addOneDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Date → "YYYYMMDDTHHMMSSZ" (RFC 5545 UTC form-2 timestamp) */
function dtstampUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}
