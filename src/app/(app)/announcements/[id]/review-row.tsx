"use client";

import Link from "next/link";
import { useTransition, useState } from "react";
import { CheckCircle2, Circle, Loader2, ArrowRight, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { setClientReviewedAction } from "../actions";
import type { ReviewableClient } from "@/lib/services/announcements";

/**
 * One row per affected client. Deliberately compact: name + matched
 * states + email + a count of open deadlines + drill-in to the client.
 *
 * We used to list every open deadline inline, but it was misleading —
 * we can't yet narrow to "deadlines this announcement actually moves"
 * without AI structured date/form extraction (V2). Listing all federal
 * deadlines for a FL hurricane-affected client implied 1099-NEC and
 * 1040-ES Q3 were affected too. They aren't. Drop the noise.
 *
 * The user clicks through to /clients/[id] when they want to see the
 * full deadline calendar. The work on this page is "scan affected
 * clients, contact them, mark reviewed."
 *
 * Optimistic update: tick state flips immediately on click.
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
      className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
        optimisticAcked
          ? "border-[var(--color-priority-done)]/30 bg-[var(--color-priority-done-bg)]/30"
          : "border-border bg-card hover:bg-muted/30"
      }`}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-label={
          optimisticAcked ? "Mark as not reviewed" : "Mark as reviewed"
        }
        className="shrink-0 cursor-pointer disabled:cursor-not-allowed"
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
            href={`/clients/${client.clientId}?fromAnnouncement=${announcementId}`}
            className={`text-sm font-semibold hover:underline ${
              optimisticAcked ? "text-foreground/70" : ""
            }`}
          >
            {client.clientName}
          </Link>
          {client.matchedStates.map((s) => (
            <Badge key={s} variant="outline" className="text-[10px]">
              {s}
            </Badge>
          ))}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            {client.openDeadlineCount}{" "}
            {client.openDeadlineCount === 1
              ? "open deadline"
              : "open deadlines"}
          </span>
          {client.primaryContactEmail ? (
            <a
              href={`mailto:${client.primaryContactEmail}`}
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
            >
              <Mail className="h-3 w-3" />
              {client.primaryContactEmail}
            </a>
          ) : null}
        </div>
      </div>

      <Link
        href={`/clients/${client.clientId}?fromAnnouncement=${announcementId}`}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
      >
        Open client <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
