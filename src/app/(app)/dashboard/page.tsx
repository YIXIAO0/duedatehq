import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Calendar, AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  // Day 1 stub: real data fetch wires up once DB is provisioned.
  const stats = {
    thisWeek: 0,
    thisMonth: 0,
    overdue: 0,
    completed: 0,
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All your clients&apos; deadlines at a glance.
          </p>
        </div>
        <Button asChild>
          <Link href="/clients/new">
            <Plus className="mr-2 h-4 w-4" /> Add client
          </Link>
        </Button>
      </div>

      {/* Stat cards */}
      <div className="mb-8 grid gap-4 md:grid-cols-4">
        <StatCard
          title="Due this week"
          value={stats.thisWeek}
          icon={<AlertTriangle className="h-5 w-5 text-[var(--color-priority-urgent)]" />}
          highlight={stats.thisWeek > 0}
        />
        <StatCard
          title="Due this month"
          value={stats.thisMonth}
          icon={<Calendar className="h-5 w-5 text-[var(--color-priority-high)]" />}
        />
        <StatCard
          title="Overdue"
          value={stats.overdue}
          icon={<AlertTriangle className="h-5 w-5 text-[var(--color-priority-urgent)]" />}
          highlight={stats.overdue > 0}
        />
        <StatCard
          title="Completed (30d)"
          value={stats.completed}
          icon={<CheckCircle2 className="h-5 w-5 text-[var(--color-priority-done)]" />}
        />
      </div>

      {/* Empty state — shown until first client is added */}
      <Card>
        <CardHeader>
          <CardTitle>Welcome to DueDateHQ</CardTitle>
          <CardDescription>
            You don&apos;t have any clients yet. Let&apos;s get your first one set up so we
            can start generating their deadlines.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 rounded-md border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Add a client and tell us their entity type + operating states.
              We&apos;ll auto-generate their full-year deadline calendar.
            </p>
            <div className="flex justify-center">
              <Button asChild size="lg">
                <Link href="/clients/new">
                  <Plus className="mr-2 h-4 w-4" /> Add your first client
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
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
    <Card className={highlight ? "border-[var(--color-priority-urgent)]/40" : undefined}>
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
