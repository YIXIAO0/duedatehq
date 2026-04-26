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
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to dashboard
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
  const total = clients.length;
  const acked = clients.filter((c) => c.acked).length;
  const allDone = total > 0 && acked === total;

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

        {/* AI-extracted scope filters (Round C). When the model
            extracted form codes or a deadline window, surface them
            so the CPA understands why we narrowed the affected list
            — and can spot when the AI got it wrong. Hidden when no
            structured fields, since the row would be confusing. */}
        {a.affectedFormCodes.length > 0 ||
        a.originalDeadlineStart ||
        a.reliefDeadline ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">
              AI scope
            </span>
            {a.affectedFormCodes.length > 0 ? (
              <span className="inline-flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground">Forms:</span>
                {a.affectedFormCodes.map((f) => (
                  <Badge
                    key={f}
                    variant="outline"
                    className="font-mono text-[10px]"
                  >
                    {f}
                  </Badge>
                ))}
              </span>
            ) : null}
            {a.originalDeadlineStart && a.originalDeadlineEnd ? (
              <span className="text-muted-foreground">
                Postponed window:{" "}
                <span className="font-medium text-foreground/80">
                  {formatPlainDate(a.originalDeadlineStart)} →{" "}
                  {formatPlainDate(a.originalDeadlineEnd)}
                </span>
              </span>
            ) : null}
            {a.reliefDeadline ? (
              <span className="text-muted-foreground">
                New deadline:{" "}
                <span className="font-medium text-foreground/80">
                  {formatPlainDate(a.reliefDeadline)}
                </span>
              </span>
            ) : null}
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

      {/* Progress strip */}
      <div
        className={`mb-4 flex items-center justify-between rounded-lg border px-4 py-3 ${
          allDone
            ? "border-[var(--color-priority-done)]/30 bg-[var(--color-priority-done-bg)]/40"
            : "border-border bg-muted/30"
        }`}
      >
        <div className="flex items-center gap-3">
          {allDone ? (
            <CheckCircle2 className="h-5 w-5 text-[var(--color-priority-done)]" />
          ) : (
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-foreground/30 text-[11px] font-semibold">
              {acked}
            </span>
          )}
          <div>
            <div className="text-sm font-semibold">
              {allDone
                ? "All affected clients reviewed"
                : `${acked} of ${total} clients reviewed`}
            </div>
            <div className="text-xs text-muted-foreground">
              {allDone
                ? "Nothing else to do here. This announcement won't appear on your dashboard anymore."
                : "These clients are in the affected jurisdictions. Open each one, decide what to do, then tick them off."}
            </div>
          </div>
        </div>
      </div>

      {/* The actual checklist */}
      {clients.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
          No clients in your book are in the affected jurisdictions
          ({a.affectedJurisdictions.join(", ") || "—"}). Nothing to review.
        </div>
      ) : (
        <div className="space-y-3">
          {clients.map((c) => (
            <ReviewRow
              key={c.clientId}
              announcementId={a.id}
              client={c}
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
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
      <Badge className="bg-[var(--color-priority-urgent-bg)] text-[var(--color-priority-urgent)] hover:bg-[var(--color-priority-urgent-bg)]">
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
