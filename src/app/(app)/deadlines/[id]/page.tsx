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
import {
  getDeadlineDetail,
  getDeadlineHistory,
  type DeadlineHistoryEntry,
} from "@/lib/services/deadlines";
import { DeadlineActionBar } from "./deadline-action-bar";
import { NotesForm } from "./notes-form";
import { OwnerPicker } from "./owner-picker";
import { listMembers } from "@/lib/services/team";

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

  // History timeline pulled from audit_events. Cheap query (indexed),
  // and rendered below Notes so the primary actions stay above the fold.
  const [history, members] = await Promise.all([
    getDeadlineHistory(d.id, ctx.organization.id),
    listMembers(ctx.organization.id),
  ]);
  const isMultiUser = members.length > 1;
  const ownerOptions = members.map((m) => ({
    userId: m.user.id,
    fullName: m.user.fullName,
    email: m.user.email,
  }));

  const effectiveDueDate = d.extension_due_date ?? d.due_date;
  const status = d.status;
  const isCompleted = status === "completed";
  const isExtended = d.is_extended === true;
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
          {isExtended ? (
            <Badge variant="outline" className="ml-2">
              <Calendar className="mr-1 h-3 w-3" /> Extension filed
            </Badge>
          ) : null}
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

      {/* Due date + actions. Stacked vertically rather than 2-column
          because the action bar (status dropdown + Mark as filed +
          File extension) needs the full card width to fit cleanly on
          one row without wrapping. The horizontal divider keeps the
          two zones visually separated. */}
      <Card>
        <CardContent className="space-y-5 pt-6">
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

          {isMultiUser ? (
            <div className="border-t border-border pt-5">
              <OwnerPicker
                deadlineId={d.id}
                currentOwnerUserId={d.owner_user_id}
                members={ownerOptions}
              />
            </div>
          ) : null}

          <div className="border-t border-border pt-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Actions
            </p>
            <div className="mt-2">
              <DeadlineActionBar
                deadlineId={d.id}
                status={status}
                defaultNewDueDate={defaultNewDueDate}
                currentExtensionDueDate={d.extension_due_date}
              />
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

      {/* History — chronological audit trail of every change to this
          deadline. Reads from audit_events. Lets a CPA prove "we filed
          extension on Apr 25 to Oct 15, then disaster relief moved it
          to Jan 15" without digging through DB rows. */}
      {history.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">History</CardTitle>
            <CardDescription>
              Every change to this deadline. Useful when a client (or the
              IRS) asks &ldquo;when did this extension get filed?&rdquo;
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {history.map((h) => (
                <HistoryEntry key={h.id} entry={h} />
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

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

// ---------------------------------------------------------------------------
// History timeline rendering
//
// Each audit_events action gets a tailored one-liner that reads the
// payload fields we ship from the service layer. This is intentionally
// dumb — no AI, no rephrasing — because audit timelines need to be
// reproducible and exact for IRS / client disputes.
// ---------------------------------------------------------------------------

function HistoryEntry({ entry }: { entry: DeadlineHistoryEntry }) {
  const { label, body, accent } = describeHistory(entry);
  const actorLabel =
    entry.actorType === "cron"
      ? "Automated"
      : entry.actorType === "agent"
      ? "AI agent"
      : entry.actorType === "system"
      ? "System"
      : entry.actorName ?? entry.actorEmail ?? "User";
  return (
    <li className="flex gap-3">
      <div
        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${accent}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <span className="font-medium">{label}</span>
          {body ? (
            <span className="ml-1 text-muted-foreground">{body}</span>
          ) : null}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {actorLabel} ·{" "}
          {entry.occurredAt.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
      </div>
    </li>
  );
}

function describeHistory(entry: DeadlineHistoryEntry): {
  label: string;
  body: string;
  accent: string;
} {
  const p = entry.payload ?? {};
  switch (entry.action) {
    case "deadline.extension_filed": {
      const isReExtension = Boolean(p.isReExtension);
      const prevExt = (p.previousExtensionDueDate ?? null) as string | null;
      const orig = (p.originalDueDate ?? null) as string | null;
      const newDate = (p.newDueDate ?? null) as string | null;
      const requested = (p.requestedDueDate ?? null) as string | null;
      const shift = (p.businessDayShift ?? null) as
        | "weekend"
        | "holiday"
        | null;
      // For re-extensions, show "From the prior extension date → new"
      // so a CPA reading the timeline can reconstruct the chain:
      // Apr 15 → Oct 15 (1st extension), Oct 15 → Jan 15 (disaster).
      const fromDate = isReExtension && prevExt ? prevExt : orig;
      // Annotate when the IRS business-day shift kicked in (e.g. CPA
      // typed Oct 15 but it was Sat → moved to Mon Oct 17). Keeps
      // the timeline truthful — the displayed final date isn't quite
      // what the human entered.
      const shiftNote =
        shift && requested && requested !== newDate
          ? ` (auto-shifted from ${humanDate(requested)} — fell on a ${shift})`
          : "";
      return {
        label: isReExtension
          ? "Extension re-filed (replaces prior extension)"
          : "Extension filed",
        body:
          fromDate && newDate
            ? `from ${humanDate(fromDate)} → ${humanDate(newDate)}${shiftNote}`
            : "",
        accent: "bg-[var(--color-priority-high)]",
      };
    }
    case "deadline.completed": {
      const wasExtended = Boolean(p.wasExtended);
      const eff = (p.effectiveDueDate ?? p.originalDueDate ?? null) as
        | string
        | null;
      return {
        label: "Marked as filed",
        body: eff
          ? wasExtended
            ? `(was extended, due ${humanDate(eff)})`
            : `(due ${humanDate(eff)})`
          : "",
        accent: "bg-[var(--color-priority-done)]",
      };
    }
    case "deadline.reopened": {
      const prev = (p.previousStatus ?? null) as string | null;
      return {
        label: "Reopened",
        body: prev ? `from ${prev}` : "",
        accent: "bg-muted-foreground",
      };
    }
    case "deadline.notes_updated": {
      const had = Boolean(p.hadNotes);
      const has = Boolean(p.hasNotes);
      return {
        label:
          !had && has ? "Notes added" : had && !has ? "Notes cleared" : "Notes updated",
        body: "",
        accent: "bg-muted-foreground",
      };
    }
    case "deadline.status_changed": {
      // Workflow-stage transitions: pending → waiting_on_client →
      // in_progress (in any direction). Show the human labels so the
      // timeline reads "Status: Waiting on client → In progress" rather
      // than raw enum values.
      const prev = (p.previousStatus ?? null) as string | null;
      const next = (p.newStatus ?? null) as string | null;
      const fmt = (s: string | null) => (s ? statusLabel(s) : "—");
      // Color the dot to match the destination state so a quick scan of
      // the timeline communicates progress visually.
      const accent =
        next === "in_progress"
          ? "bg-[var(--color-priority-medium)]"
          : next === "waiting_on_client"
          ? "bg-[var(--color-priority-high)]"
          : "bg-muted-foreground";
      return {
        label: "Status changed",
        body: prev && next ? `${fmt(prev)} → ${fmt(next)}` : fmt(next),
        accent,
      };
    }
    default:
      // Unknown action — surface raw to be safe rather than hide.
      return {
        label: entry.action,
        body: "",
        accent: "bg-muted-foreground",
      };
  }
}

function humanDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const dow = d.toLocaleDateString("en-US", { weekday: "short" });
  return `${date} ${dow}`;
}

// Map raw enum values from audit_events.payload to the same display
// strings the dropdown trigger uses. Kept in this file (not the action
// bar) because the timeline reads from history server-side.
function statusLabel(s: string): string {
  const map: Record<string, string> = {
    pending: "Pending",
    waiting_on_client: "Waiting on client",
    in_progress: "In progress",
    completed: "Filed",
  };
  return map[s] ?? s;
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
  // Surface workflow states explicitly so the CPA can scan the page
  // header and know "where in the process" each deadline is. Overdue
  // still wins visually (urgent red) — being late beats stage info.
  // The "Extension filed" indicator is rendered separately by the
  // caller (it's a flag, not a workflow status).
  if (isOverdue) {
    return (
      <Badge className="bg-[var(--color-priority-urgent-bg)] text-[var(--color-priority-urgent)] hover:bg-[var(--color-priority-urgent-bg)]">
        <AlertTriangle className="mr-1 h-3 w-3" /> Overdue
      </Badge>
    );
  }
  if (status === "waiting_on_client") {
    return (
      <Badge variant="outline" className="text-[var(--color-priority-high)]">
        <Clock className="mr-1 h-3 w-3" /> Waiting on client
      </Badge>
    );
  }
  if (status === "in_progress") {
    return (
      <Badge variant="outline">
        <Clock className="mr-1 h-3 w-3" /> In progress
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
  // Long form for the prominent due-date display, with weekday
  // appended in FIT style. "April 15, 2026 Wed" lets the CPA know
  // immediately whether the deadline is a working day.
  const d = new Date(iso + "T00:00:00");
  const date = d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const dow = d.toLocaleDateString("en-US", { weekday: "short" });
  return `${date} · ${dow}`;
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
