import Link from "next/link";
import { Suspense } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
} from "lucide-react";
import { getCurrentContext } from "@/lib/auth/current-org";
import {
  getDashboardStats,
  listDashboardDeadlines,
} from "@/lib/services/deadline-engine";
import { getAnnouncementsSummary } from "@/lib/services/announcements";
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

      {/* IRS update banner — only renders when there's actual signal in
          the past 7 days. Suspense lets the page paint without waiting
          for the announcements query. */}
      <Suspense fallback={null}>
        <AnnouncementsBanner />
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

// Banner only renders when there's "real" signal: ≥1 high-relevance
// (score≥4) IRS announcement in the last 7 days. Otherwise we render
// nothing so the dashboard stays focused on the user's deadlines.
async function AnnouncementsBanner() {
  const summary = await getAnnouncementsSummary();
  if (summary.highRelevance7d === 0) return null;

  return (
    <Link
      href="/announcements"
      className="mb-6 flex items-start gap-3 rounded-lg border border-[var(--color-priority-urgent)]/30 bg-[var(--color-priority-urgent-bg)]/40 p-3 transition-colors hover:bg-[var(--color-priority-urgent-bg)]/70"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-priority-urgent)]" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-[var(--color-priority-urgent)]">
          {summary.highRelevance7d}{" "}
          {summary.highRelevance7d === 1 ? "IRS update" : "IRS updates"} in
          the last 7 days
        </div>
        {summary.topRecent ? (
          <div className="mt-0.5 truncate text-xs text-foreground/80">
            {summary.topRecent.aiSummary ?? summary.topRecent.title}
          </div>
        ) : null}
      </div>
      <span className="self-center text-xs font-medium text-[var(--color-priority-urgent)]">
        Review →
      </span>
    </Link>
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
