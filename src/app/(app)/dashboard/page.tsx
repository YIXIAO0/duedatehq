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
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  FileSpreadsheet,
  Bell,
} from "lucide-react";
import { getCurrentContext } from "@/lib/auth/current-org";
import {
  getDashboardStats,
  listDashboardDeadlines,
} from "@/lib/services/deadline-engine";
import { listAnnouncementsWithImpact } from "@/lib/services/announcements";
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

// Single-line "you have N IRS updates affecting your clients" strip
// at the top of the dashboard. Deliberately calm — slate-blue tone,
// not the previous red. Announcements aren't urgent ("call 911")
// events; they're informational ("FYI, here are some changes that
// touch your book"). The deadline list below it remains the focal
// point of the dashboard.
//
// Click → /announcements where the CPA can drill into specifics,
// review per-client, mark applied, etc. We deliberately don't
// surface the per-announcement cards / summaries / dismiss buttons
// inline here — that page is where the actual work happens.
async function DashboardAnnouncements() {
  // Mark this Suspense boundary as dynamic before listAnnouncementsWithImpact
  // hits `new Date()`. Cache Components requires this read of auth /
  // request data first.
  const ctx = await getCurrentContext();
  const allItems = await listAnnouncementsWithImpact(ctx.organization.id, {
    sinceDays: 30,
    minScore: 4,
    limit: 20,
    userId: ctx.user.id,
  });

  // Same gating as before: only count items where we have specific
  // affected clients AND not every client is already reviewed. The
  // strip should mean "there's actual review work waiting".
  const pending = allItems.filter((a) => {
    if (a.affectedClients.length === 0) return false;
    return a.ackedClientCount < a.affectedClients.length;
  });
  if (pending.length === 0) return null;

  // How many distinct clients across all unreviewed announcements
  // still need attention? More useful than "3 announcements" — the
  // CPA cares about people, not press releases.
  const pendingClientIds = new Set<string>();
  for (const a of pending) {
    const acked = new Set<string>(); // we don't track per-client ack here, so approximate
    void acked;
    // acked set isn't surfaced on the listing query; fall back to "any client
    // in an unreviewed announcement is potentially pending". Slight over-count
    // is fine for the headline strip — exact numbers live on /announcements.
    for (const c of a.affectedClients) pendingClientIds.add(c.id);
  }

  const announcementWord = pending.length === 1 ? "update" : "updates";
  const clientPhrase =
    pendingClientIds.size === 1
      ? "1 client"
      : `${pendingClientIds.size} clients`;

  return (
    <Link
      href="/announcements"
      className="mb-5 flex items-center gap-3 rounded-md border border-sky-200 bg-sky-50/60 px-4 py-2.5 transition-colors hover:bg-sky-50 dark:border-sky-900/50 dark:bg-sky-950/30 dark:hover:bg-sky-950/50"
    >
      <Bell className="h-4 w-4 shrink-0 text-sky-700 dark:text-sky-400" />
      <span className="flex-1 text-sm">
        <span className="font-semibold text-sky-900 dark:text-sky-100">
          {pending.length} IRS {announcementWord}
        </span>
        <span className="ml-1 text-sky-800/80 dark:text-sky-200/80">
          may affect {clientPhrase} on your list.
        </span>
      </span>
      <span className="text-xs font-medium text-sky-700 dark:text-sky-400">
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
