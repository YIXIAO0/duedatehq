"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Collapses the trailing block of far-future deadlines behind a single
 * "Show N more" button. The page leads with the immediately relevant
 * stuff (anything within ~90 days) and lets the CPA decide when they
 * want to look further out.
 *
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-2 bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        {open ? "Hide" : "Show"} {trailingCount} more deadline
        {trailingCount === 1 ? "" : "s"} ({trailingLabel})
      </button>
      {open ? children : null}
    </>
  );
}
