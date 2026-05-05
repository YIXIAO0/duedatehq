import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCurrentContext } from "@/lib/auth/current-org";
import { getAnnouncementReview } from "@/lib/services/announcements";
import { ReviewRow } from "./review-row";
import { BulkApplyButton, type PendingDeadline } from "./bulk-apply-button";

type Params = Promise<{ id: string }>;

export const metadata = {
  title: "Review affected clients · DueDateHQ",
};

/**
 * The deadline-centric drill-down. An IRS announcement triggered the
 * card on the dashboard; this page is where the CPA actually does the
 * work — walks through each affected client, checks their deadlines,
 * and ticks them off as reviewed. The (announcement, client, user)
 * ack state persists across sessions so the CPA can come back later.
 */
export default function AnnouncementReviewPage({
  params,
}: {
  params: Params;
}) {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-3">
        <Link href="/dashboard">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
      </Button>

      <Suspense fallback={<DetailSkeleton />}>
        <Detail params={params} />
      </Suspense>
    </div>
  );
}

async function Detail({ params }: { params: Params }) {
  const { id } = await params;
  const ctx = await getCurrentContext();
  const review = await getAnnouncementReview(id, ctx.organization.id, ctx.user.id);
  if (!review) notFound();

  const { announcement: a, clients } = review;

  // Two epistemic modes drive the page (see service-layer comment):
  //
  //   "deadline" — AI extracted enough scope to point at specific
  //     deadlines (form codes or a date window). Progress counts
  //     deadlines actioned, not clients ticked.
  //
  //   "client" — AI couldn't extract scope. Per-client checkboxes,
  //     and the page makes that uncertainty explicit so the CPA
  //     knows to drill into each client manually.
  const hasAiScope =
    a.affectedFormCodes.length > 0 ||
    (a.originalDeadlineStart != null && a.originalDeadlineEnd != null);

  const totalDeadlines = clients.reduce(
    (sum, c) => sum + c.affectedDeadlines.length,
    0,
  );
  const doneDeadlines = clients.reduce(
    (sum, c) =>
      sum +
      c.affectedDeadlines.filter(
        (d) => d.appliedAt != null || d.alreadyCovered,
      ).length,
    0,
  );
  // Flat list of deadlines still actionable — not yet applied/skipped
  // and not already covered by a pre-existing extension. Drives the
  // bulk-apply button. Computed here so the button can be a pure
  // presentational client component.
  const pendingDeadlines: PendingDeadline[] = clients.flatMap((c) =>
    c.affectedDeadlines
      .filter((d) => d.appliedAt == null && !d.alreadyCovered)
      .map((d) => ({
        deadlineId: d.deadlineId,
        clientId: c.clientId,
        clientName: c.clientName,
        formCode: d.formCode,
        currentEffectiveDate: d.currentEffectiveDate,
      })),
  );
  const totalClients = clients.length;
  const ackedClients = clients.filter((c) => c.acked).length;
  const allDone = hasAiScope
    ? totalDeadlines > 0 && doneDeadlines === totalDeadlines
    : totalClients > 0 && ackedClients === totalClients;

  return (
    <>
      {/* Header: announcement context */}
      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <CategoryBadge category={a.category} />
          {a.affectedJurisdictions.map((j) => (
            <Badge key={j} variant="outline" className="text-xs">
              {j === "federal" ? "US Federal" : j}
            </Badge>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            Published{" "}
            {new Date(a.publishedAt).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
        <h1 className="text-xl font-semibold leading-snug">{a.title}</h1>
        {a.aiSummary ? (
          <p className="mt-2 text-sm leading-relaxed text-foreground/80">
            {a.aiSummary}
          </p>
        ) : null}

        {/* One-line scope summary. Replaces the previous AI-scope pill
            row that had separate "Forms:" / "Postponed window:" /
            "New deadline:" boxes — visual noise. Inlined into a single
            sentence the CPA can read in one beat. Only shown when AI
            actually extracted at least one structured field. */}
        {(a.affectedFormCodes.length > 0 ||
          a.originalDeadlineStart ||
          a.reliefDeadline) && (
          <p className="mt-2 text-xs text-muted-foreground">
            {a.affectedFormCodes.length > 0 ? (
              <>
                Affects{" "}
                <span className="font-medium text-foreground/80">
                  {a.affectedFormCodes.join(" / ")}
                </span>
                {" "}deadlines{" "}
              </>
            ) : (
              "Affects deadlines "
            )}
            {a.originalDeadlineStart && a.originalDeadlineEnd ? (
              <>
                from{" "}
                <span className="font-medium text-foreground/80">
                  {formatPlainDate(a.originalDeadlineStart)}
                </span>{" "}
                through{" "}
                <span className="font-medium text-foreground/80">
                  {formatPlainDate(a.originalDeadlineEnd)}
                </span>
                {" "}
              </>
            ) : null}
            {a.reliefDeadline ? (
              <>
                — moves to{" "}
                <span className="font-medium text-foreground">
                  {formatPlainDate(a.reliefDeadline)}
                </span>
              </>
            ) : null}
            .
          </p>
        )}

        {/* Disaster-relief county banner. The whole point of disaster
            relief is that it applies to specific FEMA-declared counties,
            not a whole state. A CPA in FL whose clients are nowhere
            near the disaster zone shouldn't auto-apply just because
            "FL" matches. We surface the county list so the CPA can
            verify per-client before applying — and mirror the same
            list inside the per-deadline confirmation dialog. */}
        {a.category === "disaster_relief" && a.affectedCounties.length > 0 ? (
          <div className="mt-3 rounded-md border border-[var(--color-priority-medium)]/30 bg-[var(--color-priority-medium-bg)]/40 p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-priority-medium)]">
              Verify county before applying
            </p>
            <p className="mt-1 text-xs text-foreground/80">
              IRS disaster relief applies only to taxpayers whose
              residence or principal place of business is in one of
              these declared counties:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {a.affectedCounties.map((county) => (
                <Badge
                  key={county}
                  variant="outline"
                  className="bg-background text-[11px]"
                >
                  {county}
                </Badge>
              ))}
            </div>
          </div>
        ) : a.category === "disaster_relief" ? (
          // Disaster relief WITHOUT county list — AI couldn't pull it.
          // Most cautious case: warn loudly so the CPA doesn't assume
          // we narrowed correctly.
          <div className="mt-3 rounded-md border border-[var(--color-priority-medium)]/30 bg-[var(--color-priority-medium-bg)]/40 p-3 text-xs text-foreground/80">
            <span className="font-semibold uppercase tracking-wider text-[var(--color-priority-medium)]">
              Verify location:
            </span>{" "}
            IRS disaster relief is county-specific. The IRS text didn&apos;t
            list specific counties cleanly enough for us to extract — read
            the original release before applying relief to any client.
          </div>
        ) : null}

        <div className="mt-3">
          <a
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Read the full release on IRS.gov
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </header>

      {/* Progress strip — counts deadlines (when scoped) or clients
          (when not). The framing follows what the user actually has
          to action. */}
      {clients.length > 0 ? (
        hasAiScope ? (
          <div
            className={`mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 ${
              allDone
                ? "border-[var(--color-priority-done)]/30 bg-[var(--color-priority-done-bg)]/40"
                : "border-border bg-muted/30"
            }`}
          >
            {allDone ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--color-priority-done)]" />
            ) : (
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-foreground/30 text-[10px] font-semibold tabular-nums">
                {doneDeadlines}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">
                {allDone
                  ? "All affected deadlines handled"
                  : `${doneDeadlines} of ${totalDeadlines} deadlines handled`}
              </div>
              <div className="text-xs text-muted-foreground">
                {allDone
                  ? "Nothing else to do here. This announcement won't reappear on your dashboard."
                  : a.reliefDeadline
                  ? "Apply the relief date or skip per deadline. Already-extended deadlines covering the relief date are marked automatically."
                  : "Mark each deadline reviewed once you've decided what to do."}
              </div>
            </div>
            {/* Bulk-apply CTA — only renders when there's actually a
                relief date to apply AND at least one pending deadline.
                Sits inside the strip so the count summary and the
                action are read together as one band. */}
            {a.reliefDeadline && pendingDeadlines.length > 0 ? (
              <BulkApplyButton
                announcementId={a.id}
                reliefDeadline={a.reliefDeadline}
                pendingDeadlines={pendingDeadlines}
                requiresVerify={a.category === "disaster_relief"}
                affectedCounties={a.affectedCounties}
              />
            ) : null}
          </div>
        ) : (
          // Unscoped path: per-client review, with a clear explanation
          // that the AI didn't manage to narrow the announcement and
          // each client needs manual attention.
          <div
            className={`mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 ${
              allDone
                ? "border-[var(--color-priority-done)]/30 bg-[var(--color-priority-done-bg)]/40"
                : "border-[var(--color-priority-medium)]/30 bg-[var(--color-priority-medium-bg)]/40"
            }`}
          >
            {allDone ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--color-priority-done)]" />
            ) : (
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-foreground/30 text-[10px] font-semibold tabular-nums">
                {ackedClients}
              </span>
            )}
            <div>
              <div className="text-sm font-semibold">
                {allDone
                  ? "All clients reviewed"
                  : `${ackedClients} of ${totalClients} clients reviewed`}
              </div>
              <div className="text-xs text-muted-foreground">
                We couldn&apos;t pin down which specific deadlines this
                announcement affects from the IRS text. Open each
                client and decide what to do, then tick them off.
              </div>
            </div>
          </div>
        )
      ) : null}

      {/* The actual checklist */}
      {clients.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
          No clients in your book have open deadlines that match this
          announcement&apos;s scope ({" "}
          {a.affectedJurisdictions.join(", ") || "—"}
          {a.affectedFormCodes.length > 0
            ? ` · ${a.affectedFormCodes.join(", ")}`
            : ""}
          ). Nothing to review.
        </div>
      ) : (
        <div className="space-y-3">
          {clients.map((c) => (
            <ReviewRow
              key={c.clientId}
              announcementId={a.id}
              client={c}
              reliefDeadline={a.reliefDeadline}
              // For disaster_relief items, Apply requires the CPA to
              // explicitly confirm the client is in a declared county
              // (or that they've verified the geography manually).
              // Other categories — form_change, procedural — are
              // jurisdiction-wide and don't need the gate.
              requiresVerify={a.category === "disaster_relief"}
              affectedCounties={a.affectedCounties}
            />
          ))}
        </div>
      )}
    </>
  );
}

// Format an ISO YYYY-MM-DD into "Apr 15, 2026" — keeps the AI scope
// row compact while still readable. Defensive against malformed input
// from older rows that the AI hadn't extracted yet.
function formatPlainDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const dow = d.toLocaleDateString("en-US", { weekday: "short" });
  return `${date} ${dow}`;
}

function CategoryBadge({ category }: { category: string }) {
  const labels: Record<string, string> = {
    disaster_relief: "Disaster relief",
    form_change: "Form change",
    procedural: "Procedural",
    general: "General",
  };
  if (category === "disaster_relief") {
    return (
      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/40">
        <AlertTriangle className="mr-1 h-3 w-3" />
        {labels[category]}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs">
      {labels[category] ?? category}
    </Badge>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <div className="h-6 w-3/4 animate-pulse rounded bg-muted" />
      <div className="h-4 w-full animate-pulse rounded bg-muted" />
      <div className="h-12 w-full animate-pulse rounded-lg bg-muted/40" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-32 animate-pulse rounded-lg border border-border bg-muted/30"
        />
      ))}
    </div>
  );
}
