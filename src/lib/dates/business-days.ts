/**
 * Business-day arithmetic for tax deadlines.
 *
 * The IRS rule (26 CFR § 301.7503-1) is that when a deadline falls on
 * a Saturday, Sunday, or "legal holiday" in the District of Columbia,
 * the deadline becomes the next business day. The "legal holiday in DC"
 * list is what trips up most off-the-shelf libraries — it includes
 * Emancipation Day (Apr 16, observed as a DC holiday since 2005), which
 * is precisely why Tax Day frequently lands on Apr 17 or Apr 18 even
 * though the statutory date is Apr 15.
 *
 * We deliberately keep this minimal:
 *   - hand-roll a small holiday calendar (the IRS-observed federal +
 *     DC holidays that actually move tax deadlines)
 *   - support a 30-year window (current year ± 15) — enough for any
 *     realistic CPA workflow
 *   - dates are kept as YYYY-MM-DD strings to avoid TZ ambiguity
 */

// ---------------------------------------------------------------------------
// Holiday computations
// ---------------------------------------------------------------------------

/** "Nth weekday of month" — used for MLK Day (3rd Mon Jan), etc. */
function nthWeekdayOfMonth(
  year: number,
  monthZeroIndexed: number,
  weekday: number, // 0 = Sun, 1 = Mon, ...
  n: number,
): Date {
  const first = new Date(Date.UTC(year, monthZeroIndexed, 1));
  const firstWeekday = first.getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  return new Date(Date.UTC(year, monthZeroIndexed, 1 + offset + (n - 1) * 7));
}

/** "Last weekday of month" — used for Memorial Day (last Mon May). */
function lastWeekdayOfMonth(
  year: number,
  monthZeroIndexed: number,
  weekday: number,
): Date {
  // Start at last day of month, walk backward to the target weekday.
  const last = new Date(Date.UTC(year, monthZeroIndexed + 1, 0));
  const lastWeekday = last.getUTCDay();
  const offset = (lastWeekday - weekday + 7) % 7;
  return new Date(Date.UTC(year, monthZeroIndexed, last.getUTCDate() - offset));
}

/**
 * Return the set of YYYY-MM-DD dates that count as DC legal holidays
 * for IRS deadline-shifting purposes in `year`.
 *
 * Notes:
 *   - When a fixed-date holiday falls on Saturday, the OBSERVED
 *     holiday is the preceding Friday; on Sunday, the following
 *     Monday. The IRS treats both the fixed and observed dates as
 *     deadline-shifting in practice; we include both to be safe.
 *   - Emancipation Day (Apr 16, DC) is what makes April 15 frequently
 *     land on Apr 17/18 — the most-asked-about quirk in tax dates.
 */
function holidaysForYear(year: number): Set<string> {
  const dates = new Set<string>();
  const add = (d: Date) => dates.add(d.toISOString().slice(0, 10));

  const fixed: { month: number; day: number }[] = [
    { month: 0, day: 1 },   // New Year's Day
    { month: 3, day: 16 },  // Emancipation Day (DC)
    { month: 5, day: 19 },  // Juneteenth
    { month: 6, day: 4 },   // Independence Day
    { month: 10, day: 11 }, // Veterans Day
    { month: 11, day: 25 }, // Christmas Day
  ];

  for (const f of fixed) {
    const d = new Date(Date.UTC(year, f.month, f.day));
    add(d);
    // Saturday → observed Friday; Sunday → observed Monday.
    const dow = d.getUTCDay();
    if (dow === 6) {
      const obs = new Date(d);
      obs.setUTCDate(d.getUTCDate() - 1);
      add(obs);
    } else if (dow === 0) {
      const obs = new Date(d);
      obs.setUTCDate(d.getUTCDate() + 1);
      add(obs);
    }
  }

  // Floating Monday holidays.
  add(nthWeekdayOfMonth(year, 0, 1, 3));   // MLK Day — 3rd Mon Jan
  add(nthWeekdayOfMonth(year, 1, 1, 3));   // Presidents' Day — 3rd Mon Feb
  add(lastWeekdayOfMonth(year, 4, 1));      // Memorial Day — last Mon May
  add(nthWeekdayOfMonth(year, 8, 1, 1));   // Labor Day — 1st Mon Sep
  add(nthWeekdayOfMonth(year, 9, 1, 2));   // Columbus Day — 2nd Mon Oct
  add(nthWeekdayOfMonth(year, 10, 4, 4));  // Thanksgiving — 4th Thu Nov

  return dates;
}

// Memoize. Most calls in a single request will hit the same year.
const holidayCache = new Map<number, Set<string>>();
function getHolidays(year: number): Set<string> {
  let cached = holidayCache.get(year);
  if (!cached) {
    cached = holidaysForYear(year);
    holidayCache.set(year, cached);
  }
  return cached;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true when the given ISO date is a Saturday, Sunday, or DC
 * legal holiday — i.e. the IRS would shift a deadline off this date.
 */
export function isNonBusinessDay(iso: string): boolean {
  const d = new Date(iso + "T00:00:00Z");
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return true;
  return getHolidays(d.getUTCFullYear()).has(iso);
}

/**
 * If the date falls on a weekend or holiday, advance to the next
 * business day; otherwise return unchanged. Idempotent.
 *
 * Returns both the resulting date and whether it was actually shifted,
 * so callers can audit-log the shift or surface it to the user.
 */
export function nextBusinessDay(iso: string): {
  date: string;
  shifted: boolean;
  reason: "weekend" | "holiday" | null;
} {
  let d = new Date(iso + "T00:00:00Z");
  let shifted = false;
  let reason: "weekend" | "holiday" | null = null;

  // Walk forward up to 7 days — should never need that many. Cap is
  // a safety belt against some pathological holiday cluster.
  for (let i = 0; i < 7; i++) {
    const cur = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) {
      shifted = true;
      reason = reason ?? "weekend";
    } else if (getHolidays(d.getUTCFullYear()).has(cur)) {
      shifted = true;
      reason = "holiday";
    } else {
      return { date: cur, shifted, reason };
    }
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
  // Pathological — return what we have.
  return { date: d.toISOString().slice(0, 10), shifted, reason };
}
