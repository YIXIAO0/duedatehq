import Link from "next/link";
import { Fragment, Suspense } from "react";
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
import {
  clients,
  entities,
  deadlineInstances,
  deadlineRules,
  type ServiceGroup,
} from "@/lib/db/schema";
import { isNull } from "drizzle-orm";
import {
  listDeadlinesForClient,
  type ClientDeadlineRow,
} from "@/lib/services/deadlines";
import { listContactsForClient } from "@/lib/services/client-contacts";
import {
  listAvailableServices,
  listActiveServicesForEntity,
} from "@/lib/services/entity-services";
import { AddEntityForm } from "./add-entity-form";
import { ClientActions } from "./client-actions";
import { ContactsSection } from "./contacts-section";
import { EntityActions } from "./entity-actions";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ fromAnnouncement?: string }>;

// Outer page stays sync so Cache Components can prerender the static
// shell. Reading searchParams (which are dynamic) has to happen inside
// the Suspense boundary — putting it on the outer component blocks
// the entire route from prerendering. The back-link target is computed
// inside the async child below.
export default function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <Suspense fallback={<DetailSkeleton />}>
        <ClientDetail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ClientDetail({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { fromAnnouncement } = await searchParams;
  const ctx = await getCurrentContext();
  const db = getDb();

  // Smart back-link: when the CPA arrives from "Open client" inside an
  // announcement review, return them there — not to the global /clients
  // list. Eliminates the "I lost my place in the checklist" frustration
  // when walking through 7 affected clients one by one.
  const backHref = fromAnnouncement
    ? `/announcements/${fromAnnouncement}`
    : "/clients";
  const backLabel = fromAnnouncement
    ? "Back to announcement review"
    : "Back to clients";

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

  // Active contacts for this client, primary first.
  const contacts = await listContactsForClient({
    orgId: ctx.organization.id,
    clientId: id,
  });

  // Available service groups for the add-entity form picker.
  const availableServices = await listAvailableServices();

  return (
    <div className="space-y-8">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link href={backHref}>
          <ArrowLeft className="mr-2 h-4 w-4" /> {backLabel}
        </Link>
      </Button>

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

      {/* Contacts — below deadlines because deadlines are primary work,
          contacts are "who do I email when working on those deadlines".
          The Round-B email cron will only reach contacts with
          receivesReminders=true. */}
      <ContactsSection clientId={id} contacts={contacts} />

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
              <EntityCard
                key={e.id}
                entity={e}
                orgId={ctx.organization.id}
                availableServices={availableServices}
              />
            ))}
          </div>
        )}
      </section>

      {/* Add entity form */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Add a tax entity</h2>
        <AddEntityForm clientId={id} services={availableServices} />
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
  //
  // Date streaks: deadlines that share the same effective_due_date
  // (very common when state + federal forms collide on Apr 15) are
  // hoisted under a single date subheader. The rows below drop their
  // date column entirely so the form-code + title gets the visual
  // weight, instead of a wall of repeating dates.
  const streaks: { date: string; rows: ClientDeadlineRow[] }[] = [];
  for (const d of deadlines) {
    const last = streaks[streaks.length - 1];
    if (last && last.date === d.effectiveDueDate) last.rows.push(d);
    else streaks.push({ date: d.effectiveDueDate, rows: [d] });
  }

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
          {streaks.map((streak) => (
            <Fragment key={streak.date}>
              <DateSubheader
                date={streak.date}
                count={streak.rows.length}
              />
              {streak.rows.map((d) => (
                <DeadlineRow
                  key={d.id}
                  d={d}
                  showEntityCol={showEntityCol}
                />
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Subheader rendered once per unique effective_due_date in the open
 * deadlines list. Carries the date, the relative-time chip (which is
 * the same for every row beneath it — that's why it's hoisted), and a
 * count when the streak has more than one row.
 *
 * Visual hierarchy notes:
 *   - bg-muted (full, not /30) so the band reads as a header strip
 *     rather than "another row that happens to be slightly tinted"
 *   - colored urgency dot at the start so distant dates still show a
 *     visible signal — the previous design rendered all >30d as muted
 *     gray and the urgency layers were invisible
 *   - uppercase + tracking-wider date so the typography contrasts
 *     with the title-case form codes in the rows below
 */
function DateSubheader({ date, count }: { date: string; count: number }) {
  const { label, text, dot } = relativeTime(date);
  return (
    // `relative` + absolutely-positioned dot is intentional: keeping the
    // dot inline (with gap-x) shifts the date text ~18px to the right,
    // so JUN 15, 2026 in the subheader no longer aligns with the form
    // codes in the rows below. Pulling the dot into the left padding
    // zone restores a clean vertical column down the table.
    <div className="relative flex items-center gap-2 bg-muted px-4 py-1.5">
      <span
        className={`absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full ${dot}`}
        aria-hidden
      />
      <span className="text-[11px] font-bold uppercase tracking-wider">
        {formatShortDate(date)}
      </span>
      <span className={`text-[11px] font-medium ${text}`}>{label}</span>
      {count > 1 ? (
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
          {count} deadlines
        </span>
      ) : null}
    </div>
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

  // No more dedicated date column — the DateSubheader carries it. Row
  // just shows form code, title, optional entity sub-line, and status.
  return (
    <Link
      href={`/deadlines/${d.id}`}
      className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/40"
    >
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
          // Entity sub-line with a tiny icon — CPA can tell at a glance
          // "this 1040 is for Acme Corp, not the spouse's individual
          // 1040". Building2 vs UserIcon mirrors the entity card icons
          // upstream so the visual language is consistent.
          <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            {d.entityType === "individual" ? (
              <UserIcon className="h-3 w-3 shrink-0" />
            ) : (
              <Building2 className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">
              <span className="font-medium text-foreground/80">
                {d.entityName}
              </span>
              <span className="ml-1">{entityTypeLabel(d.entityType)}</span>
            </span>
          </div>
        ) : null}
      </div>
      <StatusBadge status={d.status} isOverdue={isOverdue} />
    </Link>
  );
}

/**
 * Relative-time label + urgency colors for a future or past date.
 *
 * Returns three things so callers can pick where they want color to
 * land: `text` for the relative chip, `dot` for an indicator dot.
 *
 * Two tier groups:
 *   - Urgent zone (≤30d): uses the existing priority tokens — these
 *     are the ones the CPA reacts to.
 *   - Calm zone (>30d): emerald → sky → muted as the date drifts
 *     into the future. The previous palette was muted-gray for
 *     everything past 30 days, which made urgency layers invisible
 *     when looking at a long-horizon list (e.g. all of 2027).
 *
 * Day-precision is kept for ≤30d because filing crunch is measured
 * in days. Past that we switch to weeks (31-90), months (91-365),
 * and years (>365) so "in 12mo" reads naturally instead of "in 354d".
 */
function relativeTime(iso: string): {
  label: string;
  text: string;
  dot: string;
} {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(iso + "T00:00:00");
  const days = Math.round(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  let label: string;
  if (days < 0) label = `${Math.abs(days)}d overdue`;
  else if (days === 0) label = "Today";
  else if (days === 1) label = "Tomorrow";
  else if (days <= 30) label = `in ${days}d`;
  else if (days <= 90) label = `in ${Math.round(days / 7)}w`;
  else if (days <= 365) label = `in ${Math.round(days / 30)}mo`;
  else label = `in ${Math.round(days / 365)}y`;

  let text: string;
  let dot: string;
  if (days <= 3) {
    text = "text-[var(--color-priority-urgent)]";
    dot = "bg-[var(--color-priority-urgent)]";
  } else if (days <= 14) {
    text = "text-[var(--color-priority-high)]";
    dot = "bg-[var(--color-priority-high)]";
  } else if (days <= 30) {
    text = "text-[var(--color-priority-medium)]";
    dot = "bg-[var(--color-priority-medium)]";
  } else if (days <= 90) {
    // Calm green = "you have runway, don't panic"
    text = "text-emerald-600 dark:text-emerald-400";
    dot = "bg-emerald-500";
  } else if (days <= 180) {
    // Sky blue = "future planning bucket"
    text = "text-sky-600 dark:text-sky-400";
    dot = "bg-sky-500";
  } else {
    text = "text-muted-foreground";
    dot = "bg-muted-foreground/40";
  }

  return { label, text, dot };
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
  if (status === "waiting_on_client") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 text-[10px] text-[var(--color-priority-high)]"
      >
        <Clock className="mr-1 h-2.5 w-2.5" /> Waiting on client
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
  if (status === "ready_to_file") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 text-[10px] text-[var(--color-priority-done)]"
      >
        <CheckCircle2 className="mr-1 h-2.5 w-2.5" /> Ready to file
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
  // FIT-style: weekday after the date so the CPA can scan-plan their
  // week ("is this a Friday or a Saturday?") without doing the
  // mental conversion. "Apr 15, 2026 Wed" reads naturally.
  const d = new Date(iso + "T00:00:00");
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const dow = d.toLocaleDateString("en-US", { weekday: "short" });
  return `${date} ${dow}`;
}

// "06-30" → "Jun 30". Simple month-day formatter for the FYE badge.
// We construct the date in a non-leap year (2025) to avoid Feb 29
// edge cases — FYEs of Feb 29 are unheard of anyway.
function formatFyeShort(mmdd: string): string {
  const [m, d] = mmdd.split("-").map((s) => parseInt(s, 10));
  if (!m || !d) return mmdd;
  return new Date(Date.UTC(2025, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

async function EntityCard({
  entity,
  orgId,
  availableServices,
}: {
  entity: typeof entities.$inferSelect;
  orgId: string;
  availableServices: ServiceGroup[];
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

  // The services this entity is currently assigned to. Surfaces as
  // small badges so the CPA sees at a glance "this client is on
  // Personal Tax + Quarterly Payroll" without opening the edit
  // dialog. One query per entity card is fine — entities are
  // typically <10 per client and N+1 here is dwarfed by the deadline
  // count query above.
  const activeServices = await listActiveServicesForEntity(entity.id);

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
            <div className="mt-1 flex flex-wrap items-center gap-2">
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
              {/* Surface non-default FYE so the CPA can spot at a glance
                  why this entity's 1120 / 1120-S / 1065 etc. dates differ
                  from the calendar-year norm. Calendar year (Dec 31)
                  stays unmarked — that's the boring default. */}
              {entity.fiscalYearEnd && entity.fiscalYearEnd !== "12-31" ? (
                <Badge variant="outline" className="text-xs">
                  FYE {formatFyeShort(entity.fiscalYearEnd)}
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
              fiscalYearEnd: entity.fiscalYearEnd,
              activeServiceIds: activeServices.map((s) => s.id),
            }}
            availableServices={availableServices}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {activeServices.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {activeServices.map((s) => (
              <Badge
                key={s.id}
                variant="outline"
                className="text-[10px]"
                title={s.description ?? undefined}
              >
                {s.name}
              </Badge>
            ))}
          </div>
        ) : null}
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
      {/* Reserve the back-link slot so layout doesn't shift after hydrate. */}
      <div className="h-7 w-40 animate-pulse rounded bg-muted" />
      <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      <div className="h-4 w-96 animate-pulse rounded bg-muted" />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/40" />
        <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/40" />
      </div>
    </div>
  );
}
