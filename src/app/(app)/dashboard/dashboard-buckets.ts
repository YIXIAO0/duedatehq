/**
 * Time-bucketing for the dashboard agenda.
 *
 * Splits the loaded deadline window into 8 chronological buckets
 * (Overdue → Today → Tomorrow → Rest of week → Next week → Later
 * this month → Next month → Beyond) with urgency tones and default
 * collapsed states. Pure: depends only on the deadline set + `new
 * Date()`, no React.
 */

import type { DashboardDeadline } from "./dashboard-client";
import { US_STATE_CODES } from "@/lib/constants/us-states";

export type UrgencyFilter = "all" | "urgent" | "irrevocable";
export type StatusFilter = "active" | "extended_only" | "all";

export interface FilterState {
  urgency: UrgencyFilter;
  status: StatusFilter;
  state: string; // state code or "all"
  entityType: string; // entity_type or "all"
}

export type Bucket = {
  id: string;
  label: string;
  description: string;
  deadlines: DashboardDeadline[];
  urgency: "urgent" | "high" | "medium" | "low";
  defaultCollapsed: boolean;
};

// Filter dropdown options — "federal" is virtual (no entity has it as
// home_state, but federal-level deadlines are tagged that way) followed
// by the canonical 50 states + DC. The API still supports filtering by
// any value the data carries; this list just drives the UI.
export const STATE_OPTIONS = ["federal", ...US_STATE_CODES];
export const TYPE_OPTIONS = [
  "individual",
  "c_corp",
  "s_corp",
  "partnership",
  "llc",
  "trust",
  "estate",
  "nonprofit",
];
export const PAGE_SIZE = 100;

export function bucketByTime(deadlines: DashboardDeadline[]): Bucket[] {
  // Anchor to local-midnight today so date-only comparisons stay clean.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Week boundary: Sunday-start week. End-of-this-week = upcoming Saturday.
  const dayOfWeek = today.getDay(); // Sun=0..Sat=6
  const endOfThisWeek = new Date(today);
  endOfThisWeek.setDate(endOfThisWeek.getDate() + (6 - dayOfWeek));
  const endOfNextWeek = new Date(endOfThisWeek);
  endOfNextWeek.setDate(endOfNextWeek.getDate() + 7);

  // Month boundary: end-of-month is "last day at 00:00", inclusive.
  const endOfThisMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  );
  const endOfNextMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 2,
    0,
  );

  const monthName = today.toLocaleDateString("en-US", { month: "long" });
  const nextMonthName = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    1,
  ).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const dateRangeLabel = (from: Date, to: Date) => {
    const opts = { month: "short", day: "numeric" } as const;
    return `${from.toLocaleDateString("en-US", opts)} – ${to.toLocaleDateString("en-US", opts)}`;
  };

  const buckets: Bucket[] = [
    {
      id: "overdue",
      label: "Overdue",
      description: "Past the effective due date — triage first",
      deadlines: [],
      urgency: "urgent",
      defaultCollapsed: false,
    },
    {
      id: "today",
      label: "Today",
      description: today.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
      deadlines: [],
      urgency: "urgent",
      defaultCollapsed: false,
    },
    {
      id: "tomorrow",
      label: "Tomorrow",
      description: tomorrow.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
      deadlines: [],
      urgency: "urgent",
      defaultCollapsed: false,
    },
    {
      id: "rest-of-week",
      label: "Rest of this week",
      description: dateRangeLabel(
        new Date(tomorrow.getTime() + 86400000),
        endOfThisWeek,
      ),
      deadlines: [],
      urgency: "high",
      defaultCollapsed: false,
    },
    {
      id: "next-week",
      label: "Next week",
      description: dateRangeLabel(
        new Date(endOfThisWeek.getTime() + 86400000),
        endOfNextWeek,
      ),
      deadlines: [],
      urgency: "high",
      defaultCollapsed: false,
    },
    {
      id: "later-this-month",
      label: `Later in ${monthName}`,
      description: dateRangeLabel(
        new Date(endOfNextWeek.getTime() + 86400000),
        endOfThisMonth,
      ),
      deadlines: [],
      urgency: "medium",
      defaultCollapsed: true,
    },
    {
      id: "next-month",
      label: nextMonthName,
      description: "Plan ahead",
      deadlines: [],
      urgency: "medium",
      defaultCollapsed: true,
    },
    {
      id: "beyond",
      label: "Beyond",
      description: "Further out",
      deadlines: [],
      urgency: "low",
      defaultCollapsed: true,
    },
  ];

  const tMs = today.getTime();
  for (const d of deadlines) {
    const due = new Date(d.effective_due_date + "T00:00:00").getTime();
    if (due < tMs) buckets[0].deadlines.push(d);
    else if (due === tMs) buckets[1].deadlines.push(d);
    else if (due === tomorrow.getTime()) buckets[2].deadlines.push(d);
    else if (due <= endOfThisWeek.getTime()) buckets[3].deadlines.push(d);
    else if (due <= endOfNextWeek.getTime()) buckets[4].deadlines.push(d);
    else if (due <= endOfThisMonth.getTime()) buckets[5].deadlines.push(d);
    else if (due <= endOfNextMonth.getTime()) buckets[6].deadlines.push(d);
    else buckets[7].deadlines.push(d);
  }

  for (const b of buckets) {
    b.deadlines.sort((a, b) => {
      if (a.effective_due_date !== b.effective_due_date) {
        return a.effective_due_date.localeCompare(b.effective_due_date);
      }
      return Number(b.irrevocable) - Number(a.irrevocable);
    });
  }

  return buckets;
}
