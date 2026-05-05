/**
 * Pure helpers used across dashboard sub-components. Kept dependency-
 * free (no React, no DB) so they can be unit-tested standalone and
 * imported anywhere without dragging in client-only code.
 */

import type { DashboardDeadline } from "./dashboard-client";

/**
 * Group deadlines by client for the "client-centric" view. Clients with
 * multiple deadlines in the same bucket get a shared header; single-
 * deadline clients render flat (no extra nesting for no reason).
 */
export function groupByClient(
  deadlines: DashboardDeadline[],
): Array<{
  clientId: string;
  clientName: string;
  deadlines: DashboardDeadline[];
}> {
  const map = new Map<
    string,
    { clientId: string; clientName: string; deadlines: DashboardDeadline[] }
  >();
  for (const d of deadlines) {
    const existing = map.get(d.client_id);
    if (existing) {
      existing.deadlines.push(d);
    } else {
      map.set(d.client_id, {
        clientId: d.client_id,
        clientName: d.client_name,
        deadlines: [d],
      });
    }
  }
  // Sort groups by earliest due within group (preserves bucket sort order).
  return Array.from(map.values()).sort((a, b) =>
    a.deadlines[0].effective_due_date.localeCompare(
      b.deadlines[0].effective_due_date,
    ),
  );
}

export function entityTypeLabel(type: string): string {
  const map: Record<string, string> = {
    individual: "Individual",
    c_corp: "C-Corp",
    s_corp: "S-Corp",
    partnership: "Partnership",
    llc: "LLC",
    trust: "Trust",
    estate: "Estate",
    nonprofit: "Nonprofit",
  };
  return map[type] ?? type;
}

/** "Apr 30" — short date format used in subtask hints, headers, etc. */
export function formatStageDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function timeAwareGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
