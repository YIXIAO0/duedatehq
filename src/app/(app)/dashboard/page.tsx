import Link from "next/link";
import { Suspense } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  ExternalLink,
  Flame,
  FileWarning,
  ShieldCheck,
} from "lucide-react";
import { getCurrentContext } from "@/lib/auth/current-org";
import {
  getDashboardStats,
  listDashboardDeadlines,
} from "@/lib/services/deadline-engine";
import { listAnnouncements } from "@/lib/services/announcements";
import type { Announcement } from "@/lib/db/schema";
import {
  DashboardClient,
  type DashboardDeadline,
} from "./dashboard-client";

export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/clients/import">
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Import
            </Link>
          </Button>
          <Button asChild>
            <Link href="/clients/new">
              <Plus className="mr-2 h-4 w-4" /> Add client
            </Link>
          </Button>
        </div>
      </div>

      {/* IRS-update inline card — only renders when there's actual signal
          (score ≥4 in the last 7 days). Suspense lets the page paint
          without waiting for the announcements query.
          Sits above stats because "what changed" beats "what's coming up"
          for the first read of the morning. */}
      <Suspense fallback={null}>
        <DashboardAnnouncements />
      </Suspense>

      <Suspense fallback={<StatsSkeleton />}>
        <DashboardStats />
      </Suspense>

      <div className="mt-8">
        <Suspense fallback={<DeadlinesSkeleton />}>
          <UpcomingDeadlines />
        </Suspense>
      </div>
    </div>
  );
}

// Renders the top 1-3 high-relevance (score≥4) IRS announcements from
// the last 7 days as a proper inline card on the dashboard. This is the
// moat feature — a CPA opens the app and immediately sees "deadline
// extended in FL" / "1099-K threshold changed", with the AI summary
// readable inline. No render at all when there's nothing high-signal,
// so the dashboard stays focused on deadlines on quiet days.
async function DashboardAnnouncements() {
  // Mark this Suspense boundary as dynamic before listAnnouncements
  // hits `new Date()`. Cache Components requires this read of auth /
  // request data first; the parent page is dynamic via DashboardStats
  // but each Suspense boundary needs to qualify on its own.
  await getCurrentContext();
  // 30-day window — high-impact IRS regs (tip-income final regs,
  // remittance tax regs, disaster-relief postponements) stay relevant
  // for weeks, not days. The header "Updates" badge intentionally
  // uses the tighter 7-day window so it can return to zero and
  // signal "new alerts this week" — the card is stable display of
  // "what's worth knowing right now", which is a different question.
  const items = await listAnnouncements({
    sinceDays: 30,
    minScore: 4,
    limit: 3,
  });
  if (items.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-[var(--color-priority-urgent)]/30 bg-[var(--color-priority-urgent-bg)]/30">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-priority-urgent)]/20 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[var(--color-priority-urgent)]" />
          <span className="text-sm font-semibold text-[var(--color-priority-urgent)]">
            IRS updates worth reviewing
          </span>
          <span className="text-xs text-muted-foreground">
            · last 30 days
          </span>
        </div>
        <Link
          href="/announcements"
          className="text-xs font-medium text-[var(--color-priority-urgent)] hover:underline"
        >
          View all →
        </Link>
      </div>
      <div className="divide-y divide-[var(--color-priority-urgent)]/15">
        {items.map((a) => (
          <DashboardAnnouncementRow key={a.id} a={a} />
        ))}
      </div>
    </div>
  );
}

function DashboardAnnouncementRow({ a }: { a: Announcement }) {
  // Use the AI-rewritten summary when available — that's the value-add.
  // Fall back to title only when AI hasn't run yet (e.g. AI Gateway
  // outage day; the row will still appear, just without the summary).
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <CategoryGlyph category={a.category} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryPill category={a.category} />
          {a.affectedJurisdictions.slice(0, 4).map((j) => (
            <Badge key={j} variant="outline" className="text-[10px]">
              {j === "federal" ? "US Federal" : j}
            </Badge>
          ))}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {new Date(a.publishedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
        <div className="mt-1 text-sm font-medium leading-snug">
          {a.title}
        </div>
        {a.aiSummary ? (
          <div className="mt-0.5 text-xs leading-snug text-foreground/75">
            {a.aiSummary}
          </div>
        ) : null}
        <div className="mt-1.5">
          <a
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-priority-urgent)] hover:underline"
          >
            Read on IRS.gov <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

function CategoryGlyph({ category }: { category: string }) {
  const map: Record<string, React.ReactNode> = {
    disaster_relief: <Flame className="h-4 w-4 text-[var(--color-priority-urgent)]" />,
    form_change: <FileWarning className="h-4 w-4 text-[var(--color-priority-high)]" />,
    procedural: <ShieldCheck className="h-4 w-4 text-[var(--color-priority-medium)]" />,
  };
  return (
    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
      {map[category] ?? <AlertCircle className="h-4 w-4 text-muted-foreground" />}
    </div>
  );
}

function CategoryPill({ category }: { category: string }) {
  const labels: Record<string, string> = {
    disaster_relief: "Disaster relief",
    form_change: "Form change",
    procedural: "Procedural",
    general: "General",
  };
  if (category === "disaster_relief") {
    return (
      <Badge className="bg-[var(--color-priority-urgent)] text-white hover:bg-[var(--color-priority-urgent)] text-[10px]">
        {labels[category]}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      {labels[category] ?? category}
    </Badge>
  );
}

async function DashboardStats() {
  const ctx = await getCurrentContext();
  const stats = await getDashboardStats(ctx.organization.id);

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <StatCard
        title="Due this week"
        value={stats.thisWeek}
        icon={
          <AlertCircle className="h-5 w-5 text-[var(--color-priority-urgent)]" />
        }
        highlight={stats.thisWeek > 0}
      />
      <StatCard
        title="Due this month"
        value={stats.thisMonth}
        icon={
          <Calendar className="h-5 w-5 text-[var(--color-priority-high)]" />
        }
      />
      <StatCard
        title="Overdue"
        value={stats.overdue}
        icon={
          <AlertTriangle className="h-5 w-5 text-[var(--color-priority-urgent)]" />
        }
        highlight={stats.overdue > 0}
      />
      <StatCard
        title="Completed (30d)"
        value={stats.completed}
        icon={
          <CheckCircle2 className="h-5 w-5 text-[var(--color-priority-done)]" />
        }
      />
    </div>
  );
}

async function UpcomingDeadlines() {
  const ctx = await getCurrentContext();
  // Fetch first page (100 rows) server-side for fast initial paint.
  // Filter changes + Load More run via /api/deadlines/list.
  const rows = await listDashboardDeadlines({
    orgId: ctx.organization.id,
    daysAhead: 60,
    limit: 100,
    offset: 0,
  });
  const hasMore = rows.length === 100;
  return (
    <DashboardClient
      initialDeadlines={rows as unknown as DashboardDeadline[]}
      initialHasMore={hasMore}
    />
  );
}


function StatCard({
  title,
  value,
  icon,
  highlight,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card
      className={
        highlight
          ? "border-[var(--color-priority-urgent)]/40"
          : undefined
      }
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-[110px] animate-pulse rounded-lg border border-border bg-muted/40"
        />
      ))}
    </div>
  );
}

function DeadlinesSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-6 w-48 animate-pulse rounded bg-muted" />
      <div className="h-[400px] animate-pulse rounded-lg border border-border bg-muted/40" />
    </div>
  );
}
