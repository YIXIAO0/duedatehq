import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Flame,
  FileWarning,
  ShieldCheck,
  Newspaper,
} from "lucide-react";
import { getCurrentContext } from "@/lib/auth/current-org";
import {
  countDismissedAnnouncements,
  listAnnouncementsWithImpact,
  type AnnouncementWithImpact,
} from "@/lib/services/announcements";
import { AnnouncementDismissButton } from "@/components/announcement-dismiss-button";

export const metadata = {
  title: "Tax updates · DueDateHQ",
};

type SearchParams = Promise<{ view?: string }>;

export default function AnnouncementsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-3">
        <Link href="/dashboard">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to dashboard
        </Link>
      </Button>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tax updates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pulled daily from the IRS Newsroom feed. Each item is classified by
          AI for relevance — score 5 means a real deadline or filing
          requirement just changed.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-lg border border-border bg-muted/40"
              />
            ))}
          </div>
        }
      >
        <Feed searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Feed({ searchParams }: { searchParams: SearchParams }) {
  // getCurrentContext() reads auth headers, which marks this page as
  // dynamic — required by Cache Components before we touch `new Date()`
  // inside the listing call. Also serves as the auth gate (redirects
  // anon users to sign-in) and gives us the org id for client matching.
  const ctx = await getCurrentContext();
  const { view } = await searchParams;
  const showDismissed = view === "dismissed";

  // minScore: 3 — hide pure PR (1) and "vaguely tax-adjacent" (2) so
  // the page is useful signal, not IRS newsroom mirror. Deadline moves
  // / form changes are 4-5; routine useful reminders are 3.
  // …WithImpact intersects each item's affected_jurisdictions with the
  // org's clients' home_state so we can show "Affects N of your clients".
  const rawItems = await listAnnouncementsWithImpact(ctx.organization.id, {
    sinceDays: 30,
    minScore: 3,
    userId: ctx.user.id,
    showDismissed,
  });
  const dismissedCount = await countDismissedAnnouncements(ctx.user.id);

  // Relevance gate — DueDateHQ is a deadline product, so federal-level
  // policy news that doesn't impact any client AND isn't a real
  // deadline change is just newsroom noise. Two ways to qualify:
  //   1. At least one of the org's clients matches the announcement's
  //      jurisdiction + form-code + date scope (affectedClients.length).
  //   2. Score 5 — the AI flagged this as a real deadline / filing
  //      requirement change. Even with no current client match the
  //      CPA may want to know (e.g. a brand-new federal deadline that
  //      they'll need next quarter).
  // Items satisfying neither (e.g. "Treasury issues proposed
  // regulations on remittance transfer tax") are dropped.
  const items = rawItems.filter(
    (i) => i.affectedClients.length > 0 || i.relevanceScore >= 5,
  );

  // Sort high-relevance to the top so eyes land on what matters. Only
  // applies to the active view; dismissed view shows whatever's there.
  const high = items.filter((i) => i.relevanceScore >= 4);
  const rest = items.filter((i) => i.relevanceScore < 4);

  return (
    <div className="space-y-6">
      {/* View toggle — only renders when there's actually something
          dismissed to recover. Hiding it on a fresh org keeps the page
          quiet. */}
      {dismissedCount > 0 || showDismissed ? (
        <div className="flex items-center gap-2">
          <ViewToggleLink
            href="/announcements"
            label="Active"
            active={!showDismissed}
          />
          <ViewToggleLink
            href="/announcements?view=dismissed"
            label={`Dismissed (${dismissedCount})`}
            active={showDismissed}
          />
        </div>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {showDismissed ? "Nothing dismissed" : "Nothing yet"}
            </CardTitle>
            <CardDescription>
              {showDismissed
                ? "Items you dismiss from the dashboard will show up here so you can restore them."
                : "The scraper runs daily at 4am ET. New items will appear here when the IRS posts them. If this stays empty for more than 24 hours, something's wrong with the cron — let us know."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {high.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {showDismissed ? "Dismissed — high priority" : "High priority — last 30 days"}
          </h2>
          <div className="space-y-2">
            {high.map((a) => (
              <AnnouncementRow
                key={a.id}
                a={a}
                highlight={!showDismissed}
                showDismissed={showDismissed}
              />
            ))}
          </div>
        </section>
      ) : null}

      {rest.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {showDismissed ? "Dismissed — other" : "Other recent"}
          </h2>
          <div className="space-y-2">
            {rest.map((a) => (
              <AnnouncementRow
                key={a.id}
                a={a}
                showDismissed={showDismissed}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ViewToggleLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-foreground text-background"
          : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}

function AnnouncementRow({
  a,
  highlight = false,
  showDismissed = false,
}: {
  a: AnnouncementWithImpact;
  highlight?: boolean;
  /** When true, this row IS dismissed — show "Restore" instead of X. */
  showDismissed?: boolean;
}) {
  // Same per-client review state used by the dashboard CTA: drives the
  // "Review N more" / "All N reviewed" copy. Items with affectedClients
  // get a clickable CTA into the per-announcement detail page; items
  // with zero affected clients (federal-only news) only show the
  // "Read on IRS.gov" link, no CTA.
  const matchCount = a.affectedClients.length;
  const ackedCount = a.ackedClientCount;
  const pendingCount = matchCount - ackedCount;
  const allReviewed = matchCount > 0 && pendingCount === 0;

  return (
    <article
      className="relative overflow-hidden rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/30"
    >
      {/* High-priority items get a 3px colored left stripe instead of
          flooding the card with a tint. Color matches the category's
          icon chip so the stripe + chip + section header read as one
          coordinated signal. Cuts the page's overall blue saturation
          without losing the "this one matters more" cue. */}
      {highlight ? (
        <span
          className={`absolute inset-y-0 left-0 w-1 ${categoryStripeClass(a.category)}`}
          aria-hidden
        />
      ) : null}
      <div className="flex items-start gap-3">
        <CategoryIcon category={a.category} />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <CategoryBadge category={a.category} />
            {a.affectedJurisdictions.length > 0
              ? a.affectedJurisdictions.slice(0, 6).map((j) => (
                  <Badge key={j} variant="outline" className="text-[10px]">
                    {j === "federal" ? "US Federal" : j}
                  </Badge>
                ))
              : null}
            <span className="ml-auto text-[11px] text-muted-foreground">
              {new Date(a.publishedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
          <h3 className="text-sm font-semibold leading-snug">{a.title}</h3>
          {a.aiSummary ? (
            <p className="mt-1 text-sm leading-snug text-foreground/80">
              {a.aiSummary}
            </p>
          ) : null}

          {/* Client-impact CTA — clickable Link to the per-client review
              page. Mirrors the dashboard "Heads up" pattern so both
              surfaces feel like the same affordance. Federal-only items
              (no client matches) skip this block entirely. */}
          {matchCount > 0 ? (
            <Link
              href={`/announcements/${a.id}`}
              className={`mt-2 flex items-center gap-3 rounded-md border px-3 py-2 transition-colors ${
                allReviewed
                  ? "border-[var(--color-priority-done)]/40 bg-[var(--color-priority-done-bg)]/40 hover:bg-[var(--color-priority-done-bg)]/70"
                  : "border-border bg-muted/30 hover:bg-muted/60"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div
                  className={`text-[12px] font-semibold ${
                    allReviewed
                      ? "text-[var(--color-priority-done)]"
                      : "text-foreground"
                  }`}
                >
                  {allReviewed
                    ? `All ${matchCount} clients reviewed`
                    : ackedCount === 0
                    ? `Review ${matchCount} affected ${
                        matchCount === 1 ? "client" : "clients"
                      }`
                    : `${pendingCount} more to review (${ackedCount}/${matchCount} done)`}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {a.affectedClients
                    .slice(0, 6)
                    .map((c) => c.name)
                    .join(" · ")}
                  {matchCount > 6 ? ` · +${matchCount - 6} more` : ""}
                </div>
              </div>
              <span
                className={`text-sm font-semibold ${
                  allReviewed
                    ? "text-[var(--color-priority-done)]"
                    : "text-primary"
                }`}
              >
                →
              </span>
            </Link>
          ) : null}

          <div className="mt-2 flex items-center justify-between gap-3">
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Read on IRS.gov <ExternalLink className="h-3 w-3" />
            </a>
            {/* Dismiss / Restore — left of the read link to balance the row.
                In active view we show a small X; in dismissed view we show
                a "Restore" pill so the recovery action is obvious. */}
            <AnnouncementDismissButton
              announcementId={a.id}
              variant={showDismissed ? "undismiss" : "dismiss"}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function CategoryIcon({ category }: { category: string }) {
  // Category palette dialed back. Disaster relief used to be urgent-red
  // — but for a CPA this is "FYI clients in declared counties qualify
  // for relief", not a fire alarm. Amber (caution) reads as "pay
  // attention" without the panic of red. Form change → sky blue
  // (informational), procedural → slate (administrative), general →
  // muted. None of these warrant red.
  const map: Record<string, { icon: React.ReactNode; bg: string; fg: string }> =
    {
      disaster_relief: {
        icon: <Flame className="h-4 w-4" />,
        bg: "bg-amber-100 dark:bg-amber-950/40",
        fg: "text-amber-700 dark:text-amber-400",
      },
      form_change: {
        icon: <FileWarning className="h-4 w-4" />,
        bg: "bg-sky-100 dark:bg-sky-950/40",
        fg: "text-sky-700 dark:text-sky-400",
      },
      procedural: {
        icon: <ShieldCheck className="h-4 w-4" />,
        bg: "bg-slate-100 dark:bg-slate-800/60",
        fg: "text-slate-700 dark:text-slate-300",
      },
      general: {
        icon: <Newspaper className="h-4 w-4" />,
        bg: "bg-muted",
        fg: "text-muted-foreground",
      },
    };
  const cfg = map[category] ?? map.general;
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${cfg.bg} ${cfg.fg}`}
    >
      {cfg.icon}
    </div>
  );
}

/**
 * The 3px left-stripe color for a high-priority card. Matches the
 * category icon's tone so the stripe + icon read as one signal rather
 * than two disconnected color choices. Kept slightly desaturated (the
 * 500-weight Tailwind color) so cards stacked together don't look
 * stripey-circus.
 */
function categoryStripeClass(category: string): string {
  switch (category) {
    case "disaster_relief":
      return "bg-amber-500";
    case "form_change":
      return "bg-sky-500";
    case "procedural":
      return "bg-slate-400";
    default:
      return "bg-muted-foreground/40";
  }
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
        <AlertTriangle className="mr-1 h-3 w-3" /> {labels[category]}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs">
      {labels[category] ?? category}
    </Badge>
  );
}
