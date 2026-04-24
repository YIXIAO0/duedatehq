import Link from "next/link";
import { Suspense } from "react";
import {
  Card,
  CardContent,
  CardDescription,
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
} from "lucide-react";
import { getCurrentContext } from "@/lib/auth/current-org";
import {
  getDashboardStats,
  listDashboardDeadlines,
} from "@/lib/services/deadline-engine";

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
    limit: 100,
  });

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Welcome to DueDateHQ</CardTitle>
          <CardDescription>
            Get set up in 2 minutes. Pick the path that fits:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Path 1: Import (recommended for existing CPAs) */}
            <Link
              href="/clients/import"
              className="group flex flex-col rounded-lg border-2 border-primary/30 bg-primary/5 p-6 transition-all hover:border-primary hover:bg-primary/10"
            >
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">
                Import from spreadsheet
                <span className="ml-2 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                  Recommended
                </span>
              </h3>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Bring in your existing client list from Excel, File In Time,
                ProConnect, or any CSV. AI maps the columns for you.
              </p>
              <p className="mt-auto pt-3 text-sm font-medium text-primary group-hover:underline">
                Start import →
              </p>
            </Link>

            {/* Path 2: Manual (for first-time solo practitioners) */}
            <Link
              href="/clients/new"
              className="group flex flex-col rounded-lg border-2 border-border bg-card p-6 transition-all hover:border-slate-400 hover:bg-muted/30"
            >
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-muted text-foreground">
                <Plus className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">Add one client manually</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Starting fresh or testing the tool? Add a single client,
                pick their entity type + states, see deadlines appear.
              </p>
              <p className="mt-auto pt-3 text-sm font-medium group-hover:underline">
                Add client →
              </p>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming deadlines</CardTitle>
        <CardDescription>
          Next 60 days — most urgent first. Irrevocable deadlines show a red
          badge.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border rounded-md border border-border">
          {rows.map((row) => (
            <DeadlineRow key={row.id} row={row} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type DeadlineRow = Awaited<ReturnType<typeof listDashboardDeadlines>>[number];

function DeadlineRow({ row }: { row: DeadlineRow }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(row.due_date + "T00:00:00");
  const daysUntil = Math.round(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  const urgency =
    daysUntil < 0
      ? "urgent" // overdue
      : daysUntil <= 3
      ? "urgent"
      : daysUntil <= 14
      ? "high"
      : daysUntil <= 30
      ? "medium"
      : "done";

  const urgencyColor = {
    urgent: "text-[var(--color-priority-urgent)]",
    high: "text-[var(--color-priority-high)]",
    medium: "text-[var(--color-priority-medium)]",
    done: "text-muted-foreground",
  }[urgency];

  const daysLabel =
    daysUntil < 0
      ? `${Math.abs(daysUntil)}d overdue`
      : daysUntil === 0
      ? "Today"
      : daysUntil === 1
      ? "Tomorrow"
      : `${daysUntil} days`;

  return (
    <Link
      href={`/clients/${row.client_id}`}
      className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/40 transition-colors"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="w-20 shrink-0 text-sm">
          <div className="font-medium">
            {new Date(row.due_date + "T00:00:00").toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </div>
          <div className={`text-xs ${urgencyColor}`}>{daysLabel}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{row.rule_title}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{row.client_name}</span>
            <span>·</span>
            <span className="truncate">{row.entity_name}</span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {row.irrevocable ? (
          <Badge className="bg-[var(--color-priority-urgent-bg)] text-[var(--color-priority-urgent)] hover:bg-[var(--color-priority-urgent-bg)]">
            Irrevocable
          </Badge>
        ) : null}
        <Badge variant="outline" className="font-mono text-xs">
          {row.jurisdiction_code === "federal" ? "US" : row.jurisdiction_code}
        </Badge>
      </div>
    </Link>
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
