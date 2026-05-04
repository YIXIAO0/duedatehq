"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Collapsible audit-trail card. The whole block folds — chevron in the
 * header toggles the entry list. Default expanded so the timeline is
 * visible on first load; collapsed state still shows the header so the
 * section never disappears entirely.
 *
 * Order is newest-first (the SQL query returns DESC), so the first entry
 * is always the most recent change to this deadline.
 */
export function HistoryList({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse history" : "Expand history"}
          className="group flex w-full items-center justify-between gap-2 text-left"
        >
          <CardTitle className="text-base">History</CardTitle>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
          )}
        </button>
      </CardHeader>
      {expanded ? (
        <CardContent>
          <ol className="space-y-3">{children}</ol>
        </CardContent>
      ) : null}
    </Card>
  );
}
