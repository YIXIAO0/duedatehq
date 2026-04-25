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
import { listAnnouncements } from "@/lib/services/announcements";
import type { Announcement } from "@/lib/db/schema";

export const metadata = {
  title: "IRS Updates · DueDateHQ",
};

export default function AnnouncementsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-3">
        <Link href="/dashboard">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to dashboard
        </Link>
      </Button>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">IRS updates</h1>
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
        <Feed />
      </Suspense>
    </div>
  );
}

async function Feed() {
  // getCurrentContext() reads auth headers, which marks this page as
  // dynamic — required by Cache Components before we touch `new Date()`
  // inside listAnnouncements. Also serves as the auth gate (redirects
  // anon users to sign-in).
  await getCurrentContext();
  // minScore: 3 — hide pure PR (1) and "vaguely tax-adjacent" (2) so
  // the page is useful signal, not IRS newsroom mirror. Deadline moves
  // / form changes are 4-5; routine useful reminders are 3.
  const items = await listAnnouncements({ sinceDays: 30, minScore: 3 });

  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nothing yet</CardTitle>
          <CardDescription>
            The scraper runs daily at 4am ET. New items will appear here when
            the IRS posts them. If this stays empty for more than 24 hours,
            something&apos;s wrong with the cron — let us know.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Sort high-relevance to the top so eyes land on what matters.
  const high = items.filter((i) => i.relevanceScore >= 4);
  const rest = items.filter((i) => i.relevanceScore < 4);

  return (
    <div className="space-y-6">
      {high.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            High priority — last 30 days
          </h2>
          <div className="space-y-2">
            {high.map((a) => (
              <AnnouncementRow key={a.id} a={a} highlight />
            ))}
          </div>
        </section>
      ) : null}

      {rest.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Other recent
          </h2>
          <div className="space-y-2">
            {rest.map((a) => (
              <AnnouncementRow key={a.id} a={a} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function AnnouncementRow({
  a,
  highlight = false,
}: {
  a: Announcement;
  highlight?: boolean;
}) {
  return (
    <article
      className={`rounded-lg border p-4 transition-colors ${
        highlight
          ? "border-[var(--color-priority-urgent)]/30 bg-[var(--color-priority-urgent-bg)]/40"
          : "border-border bg-card hover:bg-muted/30"
      }`}
    >
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
          <div className="mt-2">
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Read on IRS.gov <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

function CategoryIcon({ category }: { category: string }) {
  const map: Record<string, { icon: React.ReactNode; bg: string; fg: string }> =
    {
      disaster_relief: {
        icon: <Flame className="h-4 w-4" />,
        bg: "bg-[var(--color-priority-urgent-bg)]",
        fg: "text-[var(--color-priority-urgent)]",
      },
      form_change: {
        icon: <FileWarning className="h-4 w-4" />,
        bg: "bg-[var(--color-priority-high-bg)]",
        fg: "text-[var(--color-priority-high)]",
      },
      procedural: {
        icon: <ShieldCheck className="h-4 w-4" />,
        bg: "bg-[var(--color-priority-medium-bg)]",
        fg: "text-[var(--color-priority-medium)]",
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
