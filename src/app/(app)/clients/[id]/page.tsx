import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ArrowLeft,
  Building2,
  User as UserIcon,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  ChevronRight,
  StickyNote,
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
import { AddEntityCollapser } from "./add-entity-collapser";
import { ClientActions } from "./client-actions";
import { ContactsSection } from "./contacts-section";
import { EntityActions } from "./entity-actions";
import { DeadlinesCollapse } from "./deadlines-collapse";
import { PteElectionPills } from "./pte-election-pills";
import {
  eligiblePteJurisdictionsForEntity,
  listElectionsForEntity,
} from "@/lib/services/entity-elections";
import {
  paletteForClient,
  clientInitials,
} from "@/lib/utils/client-palette";

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

  // All open + extended deadlines for this client, capped at 18 months
  // out. We materialize 2 tax years upfront (currentYear-1 +
  // currentYear), so the raw data goes ~21 months into the future —
  // for a CPA looking at "what's open for this client", that's too
  // much (a 2026 view shouldn't surface 2028 estimates). 18 months
  // covers the natural CPA horizon: rest of current filing season +
  // next April's 1040 + Q4 estimate after that, without bleeding into
  // a second tax cycle. File In Time uses explicit tax-year tabs to
  // achieve the same scope; until we have those, this is the cleanest
  // default. Overdue items always pass through regardless of the cap.
  const deadlines = await listDeadlinesForClient({
    orgId: ctx.organization.id,
    clientId: id,
    withinDays: 545,
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
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Link>
      </Button>

      {/* Client header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {client.primaryContactEmail ? (
              <span>{client.primaryContactEmail}</span>
            ) : null}
            {client.primaryContactPhone ? (
              <span>{client.primaryContactPhone}</span>
            ) : null}
            <span>Added {new Date(client.createdAt).toLocaleDateString()}</span>
            {client.notes ? (
              // Plain text-link in the metadata row — same visual
              // weight as email / phone, dotted underline signals it
              // resolves more on click. Lucide icon (not emoji) keeps
              // the row consistent with the rest of the app's chrome.
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <StickyNote className="h-3.5 w-3.5" aria-hidden />
                    <span className="underline decoration-dotted underline-offset-4">
                      Note
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {client.notes}
                  </p>
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
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

      <ContactsSection clientId={id} contacts={contacts} />

      {/* Entities — section header carries the "Add" trigger on the
          right so the action is co-located with the thing it modifies.
          Standard pattern (think GitHub's "New issue" or Linear's
          "+ Issue" sitting next to the list header). Beats parking
          the button at the bottom of the page where the user has to
          scroll past everything else to find it. */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            Tax entities{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({entityRows.length})
            </span>
          </h2>
          <AddEntityCollapser clientId={id} services={availableServices} />
        </div>
        {entityRows.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
            No entities.
          </div>
        ) : (
          <div className="rounded-xl border border-border divide-y divide-border bg-card">
            {entityRows.map((e) => (
              <EntityCard
                key={e.id}
                entity={e}
                orgId={ctx.organization.id}
                clientId={id}
                availableServices={availableServices}
              />
            ))}
          </div>
        )}
      </section>

      {/* (The "Add a tax entity" trigger used to live in its own
          section at the bottom — it now lives in the entities-section
          header above, where the action is co-located with the list.) */}
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
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Open deadlines</h2>
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

  // Pure chronological order with date-streak grouping. See history in
  // git for the reasoning (entity-grouping broke time flow; same-date
  // hoisting reduces date-string repetition).
  const streaks: { date: string; rows: ClientDeadlineRow[] }[] = [];
  for (const d of deadlines) {
    const last = streaks[streaks.length - 1];
    if (last && last.date === d.effectiveDueDate) last.rows.push(d);
    else streaks.push({ date: d.effectiveDueDate, rows: [d] });
  }

  // Progressive disclosure: streaks within 90 days of today render
  // immediately; anything beyond goes into a collapsible block. This
  // is the meaningful semantic boundary — "imminent work I'm planning
  // around" vs "future planning bucket I'll glance at occasionally".
  // The CPA still sees the count (16 total) so they know more exists.
  const HORIZON_DAYS = 90;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const nearStreaks: typeof streaks = [];
  const farStreaks: typeof streaks = [];
  for (const s of streaks) {
    if (s.date <= horizon) nearStreaks.push(s);
    else farStreaks.push(s);
  }

  // Edge case: every streak is far-future (e.g. brand-new client with
  // first 1040 due 6 months out). Promote the first 3 streaks into the
  // "near" bucket so the user isn't staring at a single "Show N more"
  // button on an otherwise-empty list.
  if (nearStreaks.length === 0 && farStreaks.length > 0) {
    const promote = farStreaks.splice(0, Math.min(3, farStreaks.length));
    nearStreaks.push(...promote);
  }

  const farRowCount = farStreaks.reduce((sum, s) => sum + s.rows.length, 0);
  const farLabel = farStreaks[0]
    ? `after ${humanDateShort(farStreaks[0].date)}`
    : "";

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">
          Open deadlines{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({deadlines.length})
          </span>
        </h2>
      </div>
      {/* Timeline-rail layout (T4 "floating card stations"): every date
          is a self-contained card hanging off a left-side vertical rail.
          The rail provides time-sequence continuity between dates;
          spacing between cards lets each due date feel like a discrete
          event rather than a row in a table.

          The rail is rendered in two segments per node (above-dot and
          below-dot) instead of a single section-spanning absolute line.
          That keeps the rail terminating exactly at the first and last
          dot centers — no dangling "tail" lines past the outermost
          events — and uses Tailwind's group-first / group-last variants
          to suppress the segments that would otherwise dangle. */}
      <div className="relative">
        {nearStreaks.map((streak) => (
          <DateCard
            key={streak.date}
            date={streak.date}
            rows={streak.rows}
            showEntityCol={showEntityCol}
          />
        ))}
        {farStreaks.length > 0 ? (
          <DeadlinesCollapse
            trailingCount={farRowCount}
            trailingLabel={farLabel}
          >
            {farStreaks.map((streak) => (
              <DateCard
                key={streak.date}
                date={streak.date}
                rows={streak.rows}
                showEntityCol={showEntityCol}
              />
            ))}
          </DeadlinesCollapse>
        ) : null}
      </div>
    </section>
  );
}

/**
 * A single date "station" hanging off the timeline rail.
 *
 *   ●━━━┐
 *       │ APR 30, 2026 THU                Today
 *       │ ─────────────────────────────────
 *       │ 941-Q1  US Federal · ...                ›
 *
 * The colored ribbon at the top of the card carries the date + relative
 * time + (when applicable) deadline count. Solid urgency color when
 * within the alarm window (≤3d / today / overdue), tinted otherwise so
 * the eye still picks up far-future urgency tiers without the entire
 * card screaming.
 */
function DateCard({
  date,
  rows,
  showEntityCol,
}: {
  date: string;
  rows: ClientDeadlineRow[];
  showEntityCol: boolean;
}) {
  const { label, ribbonClass, dotClass } = relativeTimeRibbon(date);
  return (
    <div className="group/rn relative pb-4 pl-10 last:pb-0">
      {/* Rail segment above the dot — covered by the dot's bg-ring
          where they overlap (y=8-12 of this wrapper), visible y=0-8.
          Hidden on the very first node so the rail doesn't dangle
          above the earliest deadline. */}
      <span
        className="absolute left-[7px] top-0 h-3 w-px bg-border group-first/rn:hidden"
        aria-hidden
      />
      <span
        className={`absolute left-0 top-3 size-4 rounded-full ring-4 ring-background ${dotClass}`}
        aria-hidden
      />
      {/* Rail segment below the dot — covered by ring (y=28-32),
          visible y=32 down to wrapper bottom. Hidden on the very
          last node so the rail terminates exactly at the last dot. */}
      <span
        className="absolute left-[7px] top-7 bottom-0 w-px bg-border group-last/rn:hidden"
        aria-hidden
      />
      <div className="overflow-hidden rounded-md border border-border bg-card shadow-xs">
        <div
          className={`flex items-center gap-2 px-4 py-2 text-[11px] font-bold uppercase tracking-wider ${ribbonClass}`}
        >
          <span>{formatShortDate(date)}</span>
          <span className="ml-auto font-semibold">{label}</span>
          {rows.length > 1 ? (
            <span className="font-medium opacity-75">· {rows.length}</span>
          ) : null}
        </div>
        <div className="divide-y divide-border">
          {rows.map((d) => (
            <DeadlineRow
              key={d.id}
              d={d}
              showEntityCol={showEntityCol}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Used by the "Show N more (after Apr 15, 2027)" expander label so we
// don't repeat the date logic.
function humanDateShort(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
  // just shows form code, title, optional entity sub-line, status, and
  // a chevron telegraphing "this is clickable, drills into the deadline".
  // hover:bg-accent uses the SF blue tint that's already in the brand —
  // unlike hover:bg-muted (which collapses into the page background
  // because --muted and --background are the same value).
  return (
    <Link
      href={`/deadlines/${d.id}`}
      className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-mono text-sm font-semibold tracking-tight group-hover:text-accent-foreground">
            {d.formCode}
          </span>
          {d.irrevocable ? (
            <Badge className="bg-[var(--color-priority-urgent-bg)] text-[10px] text-[var(--color-priority-urgent)] hover:bg-[var(--color-priority-urgent-bg)]">
              Irrevocable
            </Badge>
          ) : null}
          <span className="truncate text-xs text-muted-foreground">
            {d.jurisdictionCode === "federal" ? "FED" : d.jurisdictionCode}{" "}
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
      <StatusBadge
        isCompleted={d.completedAt !== null}
        isOverdue={isOverdue}
        isExtended={d.isExtended}
      />
      {/* Chevron is the explicit "this row is a link" affordance.
          Subtle by default (text-muted-foreground/40) so it doesn't
          compete with the status badge; on hover it darkens AND
          translates 2px right — small motion that confirms the click
          target without being a cartoon. */}
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-foreground"
        aria-hidden
      />
    </Link>
  );
}

/**
 * Relative-time label + ribbon/dot styling for the timeline-rail's
 * DateCard.
 *
 * Returns three things:
 *   - `label` — "Today" / "Tomorrow" / "in 7w" / "5d overdue"
 *   - `ribbonClass` — bg + text classes for the date card's top ribbon
 *   - `dotClass` — bg color class for the rail node circle
 *
 * Tier strategy:
 *   - Alarm zone (≤3d / today / overdue): solid urgent fill, white
 *     text — the loudest possible cell so it can't be missed when
 *     scrolling through a long list.
 *   - Soft zones (>3d): tinted background + matched text color.
 *     Reads as "this exists, here's its tier" without screaming.
 *   - Far zones (>30d): emerald → sky → muted as the date drifts
 *     out. Previously >30d was a single muted gray, which collapsed
 *     all future urgency layers into one undifferentiated blob.
 *
 * Day-precision is kept for ≤30d because filing crunch is measured
 * in days. Past that we switch to weeks (31-90), months (91-365),
 * and years (>365) so "in 12mo" reads naturally instead of "in 354d".
 */
function relativeTimeRibbon(iso: string): {
  label: string;
  ribbonClass: string;
  dotClass: string;
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

  let ribbonClass: string;
  let dotClass: string;
  if (days <= 3) {
    // Soft tinted bg + saturated text — same pattern as the other
    // tiers. The earlier solid-red-on-white "alarm fill" overpowered
    // the rest of the page; differentiation now lives in hue (rose
    // vs amber vs sage), not brightness. Dot stays saturated so the
    // rail still reads as urgent at a glance.
    ribbonClass =
      "bg-[var(--color-priority-urgent-bg)] text-[var(--color-priority-urgent)]";
    dotClass = "bg-[var(--color-priority-urgent)]";
  } else if (days <= 14) {
    ribbonClass =
      "bg-[var(--color-priority-high-bg)] text-[var(--color-priority-high)]";
    dotClass = "bg-[var(--color-priority-high)]";
  } else if (days <= 30) {
    ribbonClass =
      "bg-[var(--color-priority-medium-bg)] text-[var(--color-priority-medium)]";
    dotClass = "bg-[var(--color-priority-medium)]";
  } else if (days <= 90) {
    ribbonClass =
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
    dotClass = "bg-emerald-500";
  } else if (days <= 180) {
    ribbonClass =
      "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300";
    dotClass = "bg-sky-500";
  } else {
    ribbonClass = "bg-muted text-muted-foreground";
    dotClass = "bg-muted-foreground/40";
  }

  return { label, ribbonClass, dotClass };
}

// Two-state badge for the dense client-detail rows. Priority: Filed >
// Overdue > Extended > (no badge for Pending). Owner avatar tells you
// "who's on it"; status tells you "what's wrong / urgent". Pending ≈ no
// badge keeps the row chrome quiet so non-default states pop.
function StatusBadge({
  isCompleted,
  isOverdue,
  isExtended,
}: {
  isCompleted: boolean;
  isOverdue: boolean;
  isExtended: boolean;
}) {
  if (isCompleted) {
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
  if (isExtended) {
    return (
      <Badge variant="outline" className="shrink-0 text-[10px]">
        <Calendar className="mr-1 h-2.5 w-2.5" /> Extended
      </Badge>
    );
  }
  return null;
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
  clientId,
  availableServices,
}: {
  entity: typeof entities.$inferSelect;
  orgId: string;
  clientId: string;
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

  // PTE election state. eligibleJurisdictions filters to only PTE
  // states that the entity actually operates in (so a CA-only LLC
  // doesn't see NY/NJ/etc. pills); currentElections is what's already
  // marked. Both are cheap (couple of indexed reads each).
  const [pteEligible, currentElections] = await Promise.all([
    eligiblePteJurisdictionsForEntity(entity.id),
    listElectionsForEntity(entity.id),
  ]);

  const palette = paletteForClient(clientId);
  const initials = clientInitials(entity.name);

  // Inline metadata — entity type, home state, +N states badge, FYE.
  // Composed as a "·" separated string so it sits inline with the
  // entity name rather than wrapping into its own row.
  const metaParts: string[] = [entityTypeLabel(entity.entityType)];
  if (entity.homeState) metaParts.push(entity.homeState);
  if (entity.operatingStates && entity.operatingStates.length > 1) {
    metaParts.push(`+${entity.operatingStates.length - 1} states`);
  }
  if (entity.fiscalYearEnd && entity.fiscalYearEnd !== "12-31") {
    metaParts.push(`FYE ${formatFyeShort(entity.fiscalYearEnd)}`);
  }

  return (
    <div className="flex items-start gap-3 px-3 py-3">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold"
        style={{ background: palette.bg, color: palette.text }}
        aria-hidden
      >
        {initials}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-[14px] font-semibold">
            {entity.name}
          </span>
          <span className="text-[12px] text-muted-foreground">
            {metaParts.join(" · ")}
          </span>
        </div>
        {(activeServices.length > 0 || deadlineCount.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
            <span className="text-[11.5px] text-muted-foreground">
              {deadlineCount.length} deadlines
            </span>
          </div>
        )}
        <PteElectionPills
          entityId={entity.id}
          clientId={clientId}
          eligibleJurisdictions={pteEligible}
          currentElections={currentElections.map((e) => ({
            jurisdictionCode: e.jurisdictionCode,
            kind: e.kind,
          }))}
        />
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
