import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
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
  Building2,
  User as UserIcon,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Clock,
} from "lucide-react";
import { getCurrentContext } from "@/lib/auth/current-org";
import { getDb } from "@/lib/db";
import { clients, entities, deadlineInstances, deadlineRules } from "@/lib/db/schema";
import { isNull } from "drizzle-orm";
import {
  listDeadlinesForClient,
  type ClientDeadlineRow,
} from "@/lib/services/deadlines";
import { AddEntityForm } from "./add-entity-form";
import { ClientActions } from "./client-actions";
import { EntityActions } from "./entity-actions";

type Params = Promise<{ id: string }>;

// Outer component stays synchronous so PPR can prerender the static shell
// (back button). The async data-fetching child lives inside <Suspense>.
export default function ClientDetailPage({ params }: { params: Params }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-3">
        <Link href="/clients">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to clients
        </Link>
      </Button>

      <Suspense fallback={<DetailSkeleton />}>
        <ClientDetail params={params} />
      </Suspense>
    </div>
  );
}

async function ClientDetail({ params }: { params: Params }) {
  const { id } = await params;
  const ctx = await getCurrentContext();
  const db = getDb();

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.orgId, ctx.organization.id)))
    .limit(1);

  if (!client) notFound();

  const entityRows = await db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.clientId, id),
        eq(entities.orgId, ctx.organization.id),
        isNull(entities.archivedAt),
      ),
    );

  // All open + extended deadlines for this client, sorted by effective
  // due date. We don't include filed/missed in the main view — there's
  // a "Show filed" toggle for that on V2.
  const deadlines = await listDeadlinesForClient({
    orgId: ctx.organization.id,
    clientId: id,
  });

  return (
    <div className="space-y-8">
      {/* Client header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {client.primaryContactEmail ? (
              <span>{client.primaryContactEmail}</span>
            ) : null}
            {client.primaryContactPhone ? (
              <span>{client.primaryContactPhone}</span>
            ) : null}
            <span>Added {new Date(client.createdAt).toLocaleDateString()}</span>
          </div>
          {client.notes ? (
            <p className="mt-3 max-w-2xl rounded border border-border bg-muted/30 p-3 text-sm">
              {client.notes}
            </p>
          ) : null}
        </div>
        {/* Single ⋯ menu — Edit / Calendar PDF / Archive all live in there.
            Cleaner header now that deadlines are the prominent section. */}
        <ClientActions client={client} />
      </div>

      {/* Deadlines — the headline section. Sits above entities because
          "what's due for this client" is the primary CPA question on
          this page. Hidden when the client has no entities yet (no
          deadlines materialized). */}
      {entityRows.length > 0 ? (
        <DeadlinesSection
          deadlines={deadlines}
          showEntityCol={entityRows.length > 1}
        />
      ) : null}

      {/* Entities */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Tax entities ({entityRows.length})
          </h2>
        </div>
        {entityRows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No entities yet</CardTitle>
              <CardDescription>
                Add an entity below. When you do, DueDateHQ generates the full
                deadline calendar for the current and next tax year
                automatically.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {entityRows.map((e) => (
              <EntityCard key={e.id} entity={e} orgId={ctx.organization.id} />
            ))}
          </div>
        )}
      </section>

      {/* Add entity form */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Add a tax entity</h2>
        <AddEntityForm clientId={id} />
      </section>
    </div>
  );
}

function DeadlinesSection({
  deadlines,
  showEntityCol,
}: {
  deadlines: ClientDeadlineRow[];
  showEntityCol: boolean;
}) {
  if (deadlines.length === 0) {
    return (
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Open deadlines</h2>
          <span className="text-xs text-muted-foreground">
            Filed history not shown
          </span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Nothing open</CardTitle>
            <CardDescription>
              All deadlines for this client are filed (or none have been
              materialized yet — try adding an entity below).
            </CardDescription>
          </CardHeader>
        </Card>
      </section>
    );
  }

  // Pure chronological order. Earlier I grouped by entity which broke
  // the time flow (Mar 15 from entity A above Jun 15 from entity A
  // above Apr 15 from entity B). For a CPA scanning "what's coming
  // next?" the date axis must dominate. When the client has multiple
  // entities, we show a small entity column so the row still answers
  // "for which sub-business?".
  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">
          Open deadlines{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({deadlines.length})
          </span>
        </h2>
        <span className="text-xs text-muted-foreground">
          Earliest first · filed history not shown
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="divide-y divide-border">
          {deadlines.map((d) => (
            <DeadlineRow
              key={d.id}
              d={d}
              showEntityCol={showEntityCol}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function DeadlineRow({
  d,
  showEntityCol,
}: {
  d: ClientDeadlineRow;
  showEntityCol: boolean;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(d.effectiveDueDate + "T00:00:00");
  const days = Math.round(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  const isOverdue = days < 0;
  const isUrgent = days >= 0 && days <= 7;
  const dateColor = isOverdue
    ? "text-[var(--color-priority-urgent)]"
    : isUrgent
    ? "text-[var(--color-priority-high)]"
    : "text-foreground";

  const relLabel = isOverdue
    ? `${Math.abs(days)}d overdue`
    : days === 0
    ? "Today"
    : days === 1
    ? "Tomorrow"
    : `In ${days}d`;

  return (
    <Link
      href={`/deadlines/${d.id}`}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
    >
      {/* w-28 (112px) is just enough for "Jun 15, 2026" on a single line.
          w-20 was clipping it onto two lines and breaking visual rhythm. */}
      <div className="w-28 shrink-0">
        <div className={`text-sm font-semibold ${dateColor}`}>
          {formatShortDate(d.effectiveDueDate)}
        </div>
        <div className="text-[11px] text-muted-foreground">{relLabel}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-mono text-sm font-semibold">{d.formCode}</span>
          {d.irrevocable ? (
            <Badge className="bg-[var(--color-priority-urgent-bg)] text-[10px] text-[var(--color-priority-urgent)] hover:bg-[var(--color-priority-urgent-bg)]">
              Irrevocable
            </Badge>
          ) : null}
          <span className="truncate text-xs text-muted-foreground">
            {d.jurisdictionCode === "federal" ? "US Federal" : d.jurisdictionCode}{" "}
            · {d.ruleTitle}
          </span>
        </div>
        {showEntityCol ? (
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {d.entityName} · {entityTypeLabel(d.entityType)}
          </div>
        ) : null}
      </div>
      <StatusBadge status={d.status} isOverdue={isOverdue} />
    </Link>
  );
}

function StatusBadge({
  status,
  isOverdue,
}: {
  status: string;
  isOverdue: boolean;
}) {
  if (status === "extended") {
    return (
      <Badge variant="outline" className="shrink-0 text-[10px]">
        <Calendar className="mr-1 h-2.5 w-2.5" /> Extended
      </Badge>
    );
  }
  if (status === "in_progress") {
    return (
      <Badge variant="outline" className="shrink-0 text-[10px]">
        <Clock className="mr-1 h-2.5 w-2.5" /> In progress
      </Badge>
    );
  }
  if (status === "completed") {
    return (
      <Badge className="shrink-0 bg-[var(--color-priority-done-bg)] text-[10px] text-[var(--color-priority-done)] hover:bg-[var(--color-priority-done-bg)]">
        <CheckCircle2 className="mr-1 h-2.5 w-2.5" /> Filed
      </Badge>
    );
  }
  if (isOverdue) {
    return (
      <Badge className="shrink-0 bg-[var(--color-priority-urgent-bg)] text-[10px] text-[var(--color-priority-urgent)] hover:bg-[var(--color-priority-urgent-bg)]">
        <AlertTriangle className="mr-1 h-2.5 w-2.5" /> Overdue
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 text-[10px]">
      Pending
    </Badge>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function EntityCard({
  entity,
  orgId,
}: {
  entity: typeof entities.$inferSelect;
  orgId: string;
}) {
  const db = getDb();
  const deadlineCount = await db
    .select({ id: deadlineInstances.id })
    .from(deadlineInstances)
    .innerJoin(deadlineRules, eq(deadlineRules.id, deadlineInstances.ruleId))
    .where(
      and(
        eq(deadlineInstances.entityId, entity.id),
        eq(deadlineInstances.orgId, orgId),
      ),
    );

  const icon =
    entity.entityType === "individual" ? (
      <UserIcon className="h-4 w-4" />
    ) : (
      <Building2 className="h-4 w-4" />
    );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">{entity.name}</CardTitle>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant="secondary" className="font-mono text-xs">
                {entityTypeLabel(entity.entityType)}
              </Badge>
              {entity.homeState ? (
                <Badge variant="outline" className="text-xs">
                  {entity.homeState}
                </Badge>
              ) : null}
              {entity.operatingStates && entity.operatingStates.length > 1 ? (
                <Badge variant="outline" className="text-xs">
                  +{entity.operatingStates.length - 1} states
                </Badge>
              ) : null}
            </div>
          </div>
          <EntityActions
            entity={{
              id: entity.id,
              name: entity.name,
              entityType: entity.entityType,
              homeState: entity.homeState,
              operatingStates: entity.operatingStates ?? [],
              ein: entity.ein,
            }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {deadlineCount.length} deadlines generated
        </p>
      </CardContent>
    </Card>
  );
}

function entityTypeLabel(type: string): string {
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
      <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      <div className="h-4 w-96 animate-pulse rounded bg-muted" />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/40" />
        <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/40" />
      </div>
    </div>
  );
}
