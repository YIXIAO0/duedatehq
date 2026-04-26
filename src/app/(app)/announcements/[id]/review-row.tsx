"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  Mail,
  ArrowRight,
  CalendarDays,
  ShieldCheck,
  X,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  applyAnnouncementReliefAction,
  skipAnnouncementForDeadlineAction,
  setClientReviewedAction,
} from "../actions";
import type {
  ReviewableClient,
  AffectedDeadline,
} from "@/lib/services/announcements";

/**
 * Per-client review block. Two display modes:
 *
 *   "deadline" — AI extracted enough scope to point at specific
 *     deadlines. Render the client header + per-deadline rows with
 *     Apply/Skip buttons.
 *
 *   "client" — AI couldn't extract scope. We show the client + open
 *     deadline count + a per-client "Mark reviewed" checkbox. The
 *     CPA opens the client page to figure out which deadlines apply.
 *     We don't fake a deadline list we don't have.
 */
export function ReviewRow({
  announcementId,
  client,
  reliefDeadline,
  requiresVerify,
  affectedCounties,
}: {
  announcementId: string;
  client: ReviewableClient;
  /** Used by Apply buttons to surface "Apply Feb 3" instead of generic. */
  reliefDeadline: string | null;
  /** When true (disaster_relief), Apply opens a confirmation dialog
   *  asking the CPA to verify the client's county is in scope. */
  requiresVerify: boolean;
  /** County list shown inside the verify dialog. */
  affectedCounties: string[];
}) {
  // Mode flips on whether the service was able to scope to specific
  // deadlines. When affectedDeadlines is empty, we don't pretend.
  const mode: "deadline" | "client" =
    client.affectedDeadlines.length > 0 ? "deadline" : "client";

  if (mode === "client") {
    return (
      <ClientLevelRow
        announcementId={announcementId}
        client={client}
      />
    );
  }

  const total = client.affectedDeadlines.length;
  const actioned = client.affectedDeadlines.filter(
    (d) => d.appliedAt != null || d.alreadyCovered,
  ).length;
  const allDone = actioned === total;

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

      <ul className="divide-y divide-border border-t border-border">
        {client.affectedDeadlines.map((d) => (
          <DeadlineRow
            key={d.deadlineId}
            announcementId={announcementId}
            clientName={client.clientName}
            deadline={d}
            reliefDeadline={reliefDeadline}
            requiresVerify={requiresVerify}
            affectedCounties={affectedCounties}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * Fallback row when AI couldn't scope to specific deadlines. We can't
 * honestly say "X deadlines affected" so we don't — just show the
 * client, their open-deadline count for context, and a per-client
 * "Mark reviewed" checkbox using the legacy ack mechanism. Same
 * compact shape as the original (pre-Round-C) review row.
 */
function ClientLevelRow({
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
          ? "border-[var(--color-priority-done)]/30 bg-[var(--color-priority-done-bg)]/20"
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

function DeadlineRow({
  announcementId,
  clientName,
  deadline,
  reliefDeadline,
  requiresVerify,
  affectedCounties,
}: {
  announcementId: string;
  clientName: string;
  deadline: AffectedDeadline;
  reliefDeadline: string | null;
  requiresVerify: boolean;
  affectedCounties: string[];
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
            {requiresVerify ? (
              // Disaster relief: confirmation dialog ensures the CPA
              // has actually checked the client's geography against
              // the FEMA-declared county list. One-click extension
              // would risk wrongly extending deadlines for clients
              // who happen to live in the right state but not the
              // right county.
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" size="sm" disabled={pending}>
                    {pending ? (
                      <>
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                        Applying…
                      </>
                    ) : (
                      <>Apply {humanShort(reliefDeadline)}</>
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Verify {clientName} qualifies for relief
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-3 text-sm">
                        <div>
                          You&apos;re about to extend{" "}
                          <span className="font-mono font-semibold text-foreground">
                            {deadline.formCode}
                          </span>{" "}
                          for{" "}
                          <span className="font-semibold text-foreground">
                            {clientName}
                          </span>{" "}
                          from{" "}
                          <span className="font-medium text-foreground">
                            {humanDate(deadline.currentEffectiveDate)}
                          </span>{" "}
                          to{" "}
                          <span className="font-medium text-foreground">
                            {humanDate(reliefDeadline)}
                          </span>
                          .
                        </div>
                        {affectedCounties.length > 0 ? (
                          <div className="rounded-md border border-[var(--color-priority-medium)]/30 bg-[var(--color-priority-medium-bg)]/30 p-2.5 text-xs">
                            <div className="flex items-center gap-1.5 font-semibold text-[var(--color-priority-medium)]">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Relief is county-specific
                            </div>
                            <p className="mt-1 text-foreground/80">
                              IRS relief applies only to taxpayers in
                              these declared counties:
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {affectedCounties.map((c) => (
                                <Badge
                                  key={c}
                                  variant="outline"
                                  className="bg-background text-[10px]"
                                >
                                  {c}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-md border border-[var(--color-priority-medium)]/30 bg-[var(--color-priority-medium-bg)]/30 p-2.5 text-xs">
                            <div className="flex items-center gap-1.5 font-semibold text-[var(--color-priority-medium)]">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Relief is county-specific
                            </div>
                            <p className="mt-1 text-foreground/80">
                              We couldn&apos;t extract specific counties
                              from the IRS text. Verify against the
                              official release before applying.
                            </p>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Confirm only if {clientName} is located in a
                          declared county.
                        </p>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={apply}>
                      Confirmed — apply
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
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
            )}
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
