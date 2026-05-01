"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Collapses the trailing block of far-future deadlines behind a single
 * "Show N more" button. The page leads with the immediately relevant
 * stuff (anything within ~90 days) and lets the CPA decide when they
 * want to look further out.
 *
 * Renders as a node on the timeline rail (small muted dot + inline
 * button), so the rail layout stays continuous through the toggle.
 * Children are split server-side based on a date threshold; this
 * component just toggles the trailing block visible.
 */
export function DeadlinesCollapse({
  trailingCount,
  trailingLabel,
  children,
}: {
  /** Total number of trailing deadline rows behind the toggle. */
  trailingCount: number;
  /** "in 6mo+" / "after Sep 2026" — describes what's hidden. */
  trailingLabel: string;
  /** The collapsed block of streaks/rows. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="group/rn relative pb-4 pl-10">
        {/* No dot here — this toggle is a UI control, not a date
            event. A node on the rail would suggest "another deadline"
            and read as misleading. Instead the rail just passes
            continuously through this row. group-last hides it when
            the collapse is the very last child (collapsed state with
            nothing after) so we don't dangle a tail past the button. */}
        <span
          className="absolute left-[7px] top-0 bottom-0 w-px bg-border group-last/rn:hidden"
          aria-hidden
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {open ? "Hide" : "Show"} {trailingCount} more deadline
          {trailingCount === 1 ? "" : "s"} ({trailingLabel})
        </button>
      </div>
      {open ? children : null}
    </>
  );
}
