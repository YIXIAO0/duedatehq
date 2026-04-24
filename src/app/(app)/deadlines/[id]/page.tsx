import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Calendar,
  ExternalLink,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { getCurrentContext } from "@/lib/auth/current-org";
import { getDeadlineDetail } from "@/lib/services/deadlines";
import { DeadlineActionBar } from "./deadline-action-bar";
import { NotesForm } from "./notes-form";

type Params = Promise<{ id: string }>;

export default function DeadlineDetailPage({ params }: { params: Params }) {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-3">
        <Link href="/dashboard">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to dashboard
        </Link>
      </Button>

      <Suspense fallback={<DetailSkeleton />}>
        <DeadlineDetail params={params} />
      </Suspense>
    </div>
  );
}

async function DeadlineDetail({ params }: { params: Params }) {
  const { id } = await params;
  const ctx = await getCurrentContext();

  const d = await getDeadlineDetail(id, ctx.organization.id);
  if (!d) notFound();

  const effectiveDueDate = d.extension_due_date ?? d.due_date;
  const status = d.status;
  const isCompleted = status === "completed";
  const isExtended = status === "extended";
  const isOverdue =
    !isCompleted && new Date(effectiveDueDate + "T00:00:00") < new Date();

  // Compute a sensible default new due date for the extension dialog.
  // If rule has an extension_form_code, default to 6 months after original
  // (most common). Otherwise default to today + 14 days.
  const defaultNewDueDate = (() => {
    if (d.rule_extension_form_code) {
      const orig = new Date(d.due_date + "T00:00:00Z");
      orig.setUTCMonth(orig.getUTCMonth() + 6);
      return orig.toISOString().slice(0, 10);
    }
    const t = new Date();
    t.setDate(t.getDate() + 14);
    return t.toISOString().slice(0, 10);
  })();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs">
            {d.rule_form_code}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {d.rule_jurisdiction_code === "federal"
              ? "US Federal"
              : d.rule_jurisdiction_code}
          </Badge>
          {d.rule_irrevocable ? (
            <Badge className="bg-[var(--color-priority-urgent-bg)] text-[var(--color-priority-urgent)] hover:bg-[var(--color-priority-urgent-bg)]">
              Irrevocable
            </Badge>
          ) : null}
          <StatusBadge status={status} isOverdue={isOverdue} />
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {d.rule_title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          for{" "}
          <Link
            href={`/clients/${d.client_id}`}
            className="font-medium text-foreground hover:underline"
          >
            {d.client_name}
          </Link>{" "}
          {d.entity_name && d.entity_name !== d.client_name ? (
            <>· {d.entity_name} </>
          ) : null}
          <span className="text-xs text-muted-foreground">
            ({entityLabel(d.entity_type)})
          </span>
        </p>
      </div>

      {/* Due date + actions */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {isExtended ? "New due date (after extension)" : "Due date"}
              </p>
              <div className="mt-1 flex items-baseline gap-3">
                <p className="text-2xl font-semibold">
                  {formatDate(effectiveDueDate)}
                </p>
                {!isCompleted ? (
                  <RelativeDate iso={effectiveDueDate} />
                ) : null}
              </div>
              {isExtended ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Original due {formatDate(d.due_date)} — extension filed{" "}
                  {d.extension_filed_at
                    ? formatDate(d.extension_filed_at.slice(0, 10))
                    : ""}
                </p>
              ) : null}
              {isCompleted && d.completed_at ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Filed on {formatDate(d.completed_at.slice(0, 10))}
                </p>
              ) : null}
            </div>

            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Actions
              </p>
              <div className="mt-2">
                <DeadlineActionBar
                  deadlineId={d.id}
                  status={status}
                  defaultNewDueDate={defaultNewDueDate}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
          <CardDescription>
            Anything you want to remember about this deadline. Shown on the
            dashboard tooltip.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotesForm deadlineId={d.id} initialNotes={d.notes} />
        </CardContent>
      </Card>

      {/* Rule reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rule reference</CardTitle>
          <CardDescription>
            Source information from our deadline catalog.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Form
              </dt>
              <dd className="font-mono">{d.rule_form_code}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Jurisdiction
              </dt>
              <dd>
                {d.rule_jurisdiction_code === "federal"
                  ? "US Federal (IRS)"
                  : d.rule_jurisdiction_code}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Extension form
              </dt>
              <dd>{d.rule_extension_form_code ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Tax year
              </dt>
              <dd>{d.tax_year}</dd>
            </div>
            {d.rule_description ? (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                  Description
                </dt>
                <dd className="mt-0.5">{d.rule_description}</dd>
              </div>
            ) : null}
            {d.rule_penalty_summary ? (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                  Penalty if missed
                </dt>
                <dd className="mt-0.5">{d.rule_penalty_summary}</dd>
              </div>
            ) : null}
          </dl>
          <div className="mt-4">
            <Button asChild variant="outline" size="sm">
              <a href={d.rule_source_url} target="_blank" rel="noopener noreferrer">
                View official source <ExternalLink className="ml-1.5 h-3 w-3" />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({
  status,
  isOverdue,
}: {
  status: string;
  isOverdue: boolean;
}) {
  if (status === "completed") {
    return (
      <Badge className="bg-[var(--color-priority-done-bg)] text-[var(--color-priority-done)] hover:bg-[var(--color-priority-done-bg)]">
        <CheckCircle2 className="mr-1 h-3 w-3" /> Filed
      </Badge>
    );
  }
  if (status === "extended") {
    return (
      <Badge variant="outline">
        <Calendar className="mr-1 h-3 w-3" /> Extension filed
      </Badge>
    );
  }
  if (isOverdue) {
    return (
      <Badge className="bg-[var(--color-priority-urgent-bg)] text-[var(--color-priority-urgent)] hover:bg-[var(--color-priority-urgent-bg)]">
        <AlertTriangle className="mr-1 h-3 w-3" /> Overdue
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <Clock className="mr-1 h-3 w-3" /> Pending
    </Badge>
  );
}

function RelativeDate({ iso }: { iso: string }) {
  const due = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  const label =
    days < 0
      ? `${Math.abs(days)} days overdue`
      : days === 0
      ? "Today"
      : days === 1
      ? "Tomorrow"
      : `In ${days} days`;
  const color =
    days < 0 || days <= 3
      ? "text-[var(--color-priority-urgent)]"
      : days <= 14
      ? "text-[var(--color-priority-high)]"
      : "text-muted-foreground";
  return <span className={`text-sm ${color}`}>{label}</span>;
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function entityLabel(type: string): string {
  const map: Record<string, string> = {
    individual: "Individual",
    c_corp: "C-Corp",
    s_corp: "S-Corp",
    partnership: "Partnership",
    llc: "LLC",
    trust: "Trust",
    estate: "Estate",
    nonprofit: "Nonprofit",
  };
  return map[type] ?? type;
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
      <div className="h-40 animate-pulse rounded-lg border border-border bg-muted/40" />
      <div className="h-40 animate-pulse rounded-lg border border-border bg-muted/40" />
    </div>
  );
}
