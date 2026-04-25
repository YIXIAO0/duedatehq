"use client";

import Link from "next/link";
import { useTransition, useState } from "react";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { setClientReviewedAction } from "../actions";
import type { ReviewableClient } from "@/lib/services/announcements";

/**
 * Single row in the announcement-detail checklist. The checkbox toggles
 * the per-user "I've reviewed this client for this announcement" state.
 *
 * Optimistic update: we flip the visual state immediately on click so
 * the CPA can plow through 10 clients without waiting for round-trips.
 * The server action revalidates afterward; if the action fails we'd see
 * the value snap back on the next render.
 */
export function ReviewRow({
  announcementId,
  client,
}: {
  announcementId: string;
  client: ReviewableClient;
}) {
  const [optimisticAcked, setOptimisticAcked] = useState(client.acked);
  const [pending, start] = useTransition();

  const toggle = () => {
    const next = !optimisticAcked;
    setOptimisticAcked(next);
    start(async () => {
      await setClientReviewedAction({
        announcementId,
        clientId: client.clientId,
        acked: next,
      });
    });
  };

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        optimisticAcked
          ? "border-[var(--color-priority-done)]/30 bg-[var(--color-priority-done-bg)]/30"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-label={optimisticAcked ? "Mark as not reviewed" : "Mark as reviewed"}
          className="mt-0.5 shrink-0 cursor-pointer"
        >
          {pending ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : optimisticAcked ? (
            <CheckCircle2 className="h-5 w-5 text-[var(--color-priority-done)]" />
          ) : (
            <Circle className="h-5 w-5 text-muted-foreground/60 hover:text-foreground" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/clients/${client.clientId}`}
              className={`text-sm font-semibold hover:underline ${
                optimisticAcked ? "text-foreground/80" : ""
              }`}
            >
              {client.clientName}
            </Link>
            {client.matchedStates.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {client.matchedStates.map((s) => (
                  <Badge key={s} variant="outline" className="text-[10px]">
                    {s}
                  </Badge>
                ))}
              </div>
            ) : null}
            {client.primaryContactEmail ? (
              <span className="ml-auto text-[11px] text-muted-foreground">
                {client.primaryContactEmail}
              </span>
            ) : null}
          </div>

          {/* Open deadlines for this client that match the announcement's
              jurisdictions. This is the actual work surface — the CPA sees
              "1040 due Apr 15" and clicks through to update / extend. */}
          {client.openDeadlines.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {client.openDeadlines.slice(0, 8).map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono font-semibold">
                      {d.formCode}
                    </span>
                    <span className="text-muted-foreground">
                      {d.jurisdictionCode === "federal"
                        ? "US Federal"
                        : d.jurisdictionCode}
                    </span>
                    <span className="hidden truncate text-muted-foreground sm:inline">
                      · {d.ruleTitle}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-medium">
                      {formatDate(d.effectiveDueDate)}
                    </span>
                    <Link
                      href={`/deadlines/${d.id}`}
                      className="text-primary hover:underline"
                    >
                      Open →
                    </Link>
                  </div>
                </li>
              ))}
              {client.openDeadlines.length > 8 ? (
                <li className="text-[11px] text-muted-foreground">
                  + {client.openDeadlines.length - 8} more open deadlines
                </li>
              ) : null}
            </ul>
          ) : (
            <div className="mt-2 text-xs italic text-muted-foreground">
              No open deadlines for this client right now.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
