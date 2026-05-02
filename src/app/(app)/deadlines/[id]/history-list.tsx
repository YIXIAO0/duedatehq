"use client";

import { Children, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

const VISIBLE_THRESHOLD = 5;

/**
 * Renders the audit-trail list with the trailing (older) entries
 * collapsed behind a toggle once the timeline grows past
 * VISIBLE_THRESHOLD entries. Entries are pre-rendered server-side and
 * passed in as children; this component only owns the show/hide state.
 *
 * Order is newest-first (the SQL query returns DESC), so "show N earlier
 * events" reveals the older tail — the part a CPA rarely scrolls into
 * unless they're reconstructing a timeline for an audit.
 */
export function HistoryList({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const items = Children.toArray(children);
  const total = items.length;
  const needsToggle = total > VISIBLE_THRESHOLD;
  const visibleItems =
    needsToggle && !expanded ? items.slice(0, VISIBLE_THRESHOLD) : items;
  const hiddenCount = total - VISIBLE_THRESHOLD;

  return (
    <>
      <ol className="space-y-3">{visibleItems}</ol>
      {needsToggle ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 inline-flex items-center gap-1.5 rounded text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {expanded
            ? `Hide ${hiddenCount} earlier event${hiddenCount === 1 ? "" : "s"}`
            : `Show ${hiddenCount} earlier event${hiddenCount === 1 ? "" : "s"}`}
        </button>
      ) : null}
    </>
  );
}
