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
          <p className="mt-1 text-sm text-muted-foreground">
            All your clients&apos; deadlines at a glance.
          </p>
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
  const rows = await listDashboardDeadlines({
    orgId: ctx.organization.id,
    daysAhead: 60,
    limit: 500,
  });
  // All grouping / filtering / selection is interactive — delegate to the
  // client component. Empty state also lives there for a single source of truth.
  return (
    <DashboardClient deadlines={rows as unknown as DashboardDeadline[]} />
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
