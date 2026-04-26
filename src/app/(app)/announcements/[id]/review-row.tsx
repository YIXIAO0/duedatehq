"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  CheckCircle2,
  Loader2,
  Mail,
  ArrowRight,
  CalendarDays,
  ShieldCheck,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  applyAnnouncementReliefAction,
  skipAnnouncementForDeadlineAction,
} from "../actions";
import type {
  ReviewableClient,
  AffectedDeadline,
} from "@/lib/services/announcements";

/**
 * Per-client review block. The previous version was per-client with a
 * "X affected · Y total" stat and a click-through to the client page,
 * which forced the CPA to leave the review flow to actually do
 * anything. This version drills into the actual affected deadlines
 * inline, with a one-click "Apply relief" button that files an
 * extension to the announcement's relief date — the meat of the
 * announcement workflow happens here, not somewhere else.
 *
 * Acked state is computed from the deadlines: when every affected
 * deadline has been actioned (applied or skipped) or already covered
 * by a longer extension, the client is "done" for this announcement.
 */
export function ReviewRow({
  announcementId,
  client,
  reliefDeadline,
}: {
  announcementId: string;
  client: ReviewableClient;
  /** Used by Apply buttons to surface "Apply Feb 3" instead of generic. */
  reliefDeadline: string | null;
}) {
  const total = client.affectedDeadlines.length;
  const actioned = client.affectedDeadlines.filter(
    (d) => d.appliedAt != null || d.alreadyCovered,
  ).length;
  const allDone = total > 0 && actioned === total;

  return (
    <div
      className={`rounded-lg border transition-colors ${
        allDone
          ? "border-[var(--color-priority-done)]/30 bg-[var(--color-priority-done-bg)]/20"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-start gap-3 px-3 py-2.5">
        <div className="mt-0.5 shrink-0">
          {allDone ? (
            <CheckCircle2 className="h-5 w-5 text-[var(--color-priority-done)]" />
          ) : (
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-foreground/30 text-[10px] font-semibold tabular-nums">
              {actioned}/{total}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/clients/${client.clientId}?fromAnnouncement=${announcementId}`}
              className="text-sm font-semibold hover:underline"
            >
              {client.clientName}
            </Link>
            {client.matchedStates.map((s) => (
              <Badge key={s} variant="outline" className="text-[10px]">
                {s}
              </Badge>
            ))}
            {client.primaryContactEmail ? (
              <a
                href={`mailto:${client.primaryContactEmail}`}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                <Mail className="h-3 w-3" />
                {client.primaryContactEmail}
              </a>
            ) : null}
          </div>
        </div>

        <Link
          href={`/clients/${client.clientId}?fromAnnouncement=${announcementId}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Open client page"
        >
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* One row per affected deadline. This is where the actual work
          happens — the CPA can apply or skip per deadline without
          leaving the page. */}
      {client.affectedDeadlines.length > 0 ? (
        <ul className="divide-y divide-border border-t border-border">
          {client.affectedDeadlines.map((d) => (
            <DeadlineRow
              key={d.deadlineId}
              announcementId={announcementId}
              deadline={d}
              reliefDeadline={reliefDeadline}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function DeadlineRow({
  announcementId,
  deadline,
  reliefDeadline,
}: {
  announcementId: string;
  deadline: AffectedDeadline;
  reliefDeadline: string | null;
}) {
  const [pending, start] = useTransition();
  // Optimistic: flip immediately so the row dims while the server
  // catches up. We don't bother undoing on failure here — the
  // server action would surface its own error and the user would
  // refresh; soft-failure on a benign action is fine.
  const [optimisticAction, setOptimisticAction] = useState<
    "applied" | "skipped" | null
  >(deadline.appliedAt ? "applied" : null);

  const acted = optimisticAction != null || deadline.alreadyCovered;

  const apply = () => {
    setOptimisticAction("applied");
    start(async () => {
      await applyAnnouncementReliefAction({
        announcementId,
        deadlineId: deadline.deadlineId,
      });
    });
  };
  const skip = () => {
    setOptimisticAction("skipped");
    start(async () => {
      await skipAnnouncementForDeadlineAction({
        announcementId,
        deadlineId: deadline.deadlineId,
      });
    });
  };

  return (
    <li
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${
        acted ? "opacity-60" : ""
      }`}
    >
      <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-sm font-semibold">
          {deadline.formCode}
        </span>
        <span className="text-xs text-muted-foreground">
          {humanDate(deadline.currentEffectiveDate)}
          {reliefDeadline ? (
            <>
              {" "}
              <span className="text-muted-foreground/60">→</span>{" "}
              <span className="font-medium text-foreground">
                {humanDate(reliefDeadline)}
              </span>
            </>
          ) : null}
        </span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {deadline.alreadyCovered ? (
          // Existing extension is already at-or-past the relief date —
          // no action needed. Prevents over-extending or accidentally
          // shortening a longer extension already on file.
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-priority-done-bg)] px-2 py-1 text-[11px] font-medium text-[var(--color-priority-done)]">
            <ShieldCheck className="h-3 w-3" /> Already covered
          </span>
        ) : optimisticAction === "applied" ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-priority-done-bg)] px-2 py-1 text-[11px] font-medium text-[var(--color-priority-done)]">
            <CheckCircle2 className="h-3 w-3" /> Applied
          </span>
        ) : optimisticAction === "skipped" ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
            <X className="h-3 w-3" /> Skipped
          </span>
        ) : reliefDeadline ? (
          <>
            <Button
              type="button"
              size="sm"
              onClick={apply}
              disabled={pending}
            >
              {pending ? (
                <>
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  Applying…
                </>
              ) : (
                <>Apply {humanShort(reliefDeadline)}</>
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={skip}
              disabled={pending}
            >
              Skip
            </Button>
          </>
        ) : (
          // No relief date in the announcement — the CPA still wants
          // to track that they reviewed this deadline.
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={skip}
            disabled={pending}
          >
            Mark reviewed
          </Button>
        )}
      </div>
    </li>
  );
}

function humanDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// "Apr 15" — used inside button labels where year is implied.
function humanShort(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
