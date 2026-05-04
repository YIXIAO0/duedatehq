/**
 * Deadline generation engine.
 *
 * Given an entity (type + home state + operating states) and a tax year,
 * materialize the relevant deadline_rules into per-entity deadline_instances.
 *
 * Rules selection:
 *   - Always include `federal` rules that match the entity type.
 *   - Include `state` rules whose jurisdiction_code matches the entity's
 *     home_state OR any operating_state.
 *   - Only include rules effective on or before today, not yet expired.
 *
 * Date math: weekend-aware. If the statutory date falls on Saturday or Sunday,
 * shift to the next Monday. (Federal holidays not handled in MVP — CPAs can
 * override per-instance if needed. V2 adds a holiday calendar.)
 */

import "server-only";
import { z } from "zod";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  deadlineInstances,
  deadlineRules,
  entityElections,
  entityServices,
  serviceGroupRules,
  type DeadlineRule,
  type Entity,
} from "@/lib/db/schema";
import { recordAudit } from "./audit";
import { nextBusinessDay } from "@/lib/dates/business-days";

export const GenerateDeadlinesInputSchema = z.object({
  orgId: z.string(),
  entityId: z.string(),
  taxYear: z.number().int().min(2020).max(2040),
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
  /**
   * When true, past-due deadlines are materialized with status="completed"
   * (assumed filed on the statutory date) instead of being skipped. Used
   * by the import flow when the user opts into "include historical filings"
   * for an audit-trail view.
   */
  includeHistoricalAsCompleted: z.boolean().default(false),
});
export type GenerateDeadlinesInput = z.input<typeof GenerateDeadlinesInputSchema>;

/**
 * Two flavors of date logic share this payload type:
 *
 *   ABSOLUTE — fixed calendar date, optionally offset by N years.
 *     { month: 4, day: 15, yearOffset: 1 }  // Apr 15 of taxYear+1
 *   Used for individual returns (1040), quarterly estimates, payroll
 *   forms, and anything else tied to the calendar year regardless of
 *   the entity's fiscal year.
 *
 *   FYE-RELATIVE — Nth month after the entity's fiscal year end.
 *     { fyeMonthOffset: 4, fyeDayOfMonth: 15 }  // 15th day of 4th
 *                                                 month after FYE end
 *   Used for corporate / partnership / trust / nonprofit returns.
 *   For a Dec 31 FYE entity this matches the calendar-year deadlines
 *   (1120 → Apr 15); for a Jun 30 FYE entity it correctly computes
 *   Oct 15. fyeDayOfMonth = -1 means "last day of that month" (used
 *   for Form 5500's "last day of 7th month" rule).
 *
 * Discriminator: presence of `fyeMonthOffset` means FYE-relative.
 * Using a flag rather than a tagged union so JSON-parsing seed data
 * stays simple.
 */
type RulePayload = {
  // Absolute mode
  month?: number;
  day?: number;
  yearOffset?: number; // 0 (same as taxYear), 1 (filing year, default), 2 (next filing year for Q4 estimates)
  // FYE-relative mode
  fyeMonthOffset?: number;
  fyeDayOfMonth?: number;
};

/**
 * Compute the actual due date for a rule in a given tax year.
 *
 * Applies the IRS business-day shift: weekends and DC-observed legal
 * holidays push the date to the next business day. The Emancipation
 * Day (Apr 16, DC) rule is what frequently makes Tax Day land on
 * Apr 17 or 18 — handled here by `nextBusinessDay`.
 *
 * For FYE-relative rules, the entity's fiscalYearEnd (MM-DD) drives
 * the math. Without an entity (e.g. legacy callers), we fall back to
 * Dec 31 — matches calendar-year behavior so existing tests still
 * pass.
 */
export function computeDueDate(
  rulePayload: RulePayload,
  taxYear: number,
  entity?: Pick<Entity, "fiscalYearEnd">,
): string {
  // FYE-relative branch.
  if (rulePayload.fyeMonthOffset !== undefined) {
    const fyeStr = entity?.fiscalYearEnd ?? "12-31";
    const [fyeMonthStr, fyeDayStr] = fyeStr.split("-");
    const fyeMonth = parseInt(fyeMonthStr, 10); // 1-12
    const fyeDay = parseInt(fyeDayStr, 10); // 1-31

    // The FYE that closes within `taxYear` is the one whose return
    // is filed for tax year N. For Dec 31 FYE: FYE end = Dec 31, N.
    // For Jun 30 FYE: FYE end = Jun 30, N.
    const fyeEnd = new Date(Date.UTC(taxYear, fyeMonth - 1, fyeDay));

    // Add monthOffset months. UTCMonth handles wrap-around (e.g.
    // Dec + 4 = next April).
    const dueMonth = fyeEnd.getUTCMonth() + rulePayload.fyeMonthOffset;
    const dueYear = fyeEnd.getUTCFullYear() + Math.floor(dueMonth / 12);
    const dueMonthMod = ((dueMonth % 12) + 12) % 12;

    let dueDay: number;
    if (rulePayload.fyeDayOfMonth === -1) {
      // Last day of that month. Use day=0 of the next month.
      dueDay = new Date(Date.UTC(dueYear, dueMonthMod + 1, 0)).getUTCDate();
    } else {
      dueDay = rulePayload.fyeDayOfMonth ?? 15;
    }

    const iso = new Date(Date.UTC(dueYear, dueMonthMod, dueDay))
      .toISOString()
      .slice(0, 10);
    return nextBusinessDay(iso).date;
  }

  // Absolute branch (existing behavior).
  const offset = rulePayload.yearOffset ?? 1;
  const year = taxYear + offset;
  const month0 = (rulePayload.month ?? 1) - 1; // JS months are 0-indexed
  const day = rulePayload.day ?? 1;

  const iso = new Date(Date.UTC(year, month0, day)).toISOString().slice(0, 10);
  return nextBusinessDay(iso).date;
}

/**
 * Pick rules applicable to the entity.
 * Runs as a single DB query using jsonb containment for entity_types.
 */
/**
 * Pick the rules whose deadlines this entity will materialize.
 *
 * Two paths, in order of preference:
 *
 *   1. SERVICE-DRIVEN — when the entity has at least one active row in
 *      `entity_services`, the rule set is the union of rules attached
 *      to those services (via `service_group_rules`). This is the
 *      canonical model going forward: "Acme is on Personal Tax Filing
 *      + Annual Payroll, so they get exactly those rules."
 *
 *   2. ENTITY-TYPE FALLBACK — when no services are assigned (newly-
 *      created entities mid-migration, legacy data), fall back to the
 *      old `deadline_rules.entity_types ? entityType` match. Keeps
 *      pre-services behavior intact until the backfill finishes.
 *
 * Both paths layer on the jurisdiction filter (federal + entity's
 * home_state + operating_states) and the effective-date window.
 */
async function selectApplicableRules(
  entity: Entity,
): Promise<DeadlineRule[]> {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const jurisdictions = new Set<string>(["federal"]);
  if (entity.homeState) jurisdictions.add(entity.homeState);
  for (const state of entity.operatingStates ?? []) jurisdictions.add(state);
  const jurisdictionList = Array.from(jurisdictions);

  // Election gate — rules with requires_election set (e.g. "pte") only
  // surface when the entity has a matching opt-in row in entity_elections
  // for the same kind + jurisdiction. NULL requires_election → always
  // surface. Used so PTE deadlines don't clutter every CA LLC's list
  // until the CPA explicitly marks the election.
  const electionFilter = or(
    isNull(deadlineRules.requiresElection),
    sql`EXISTS (
      SELECT 1 FROM ${entityElections} ee
      WHERE ee.entity_id = ${entity.id}
        AND ee.kind = ${deadlineRules.requiresElection}
        AND ee.jurisdiction_code = ${deadlineRules.jurisdictionCode}
    )`,
  );

  // Look up active services for this entity. We do this first so we
  // can decide which path to take.
  const activeServices = await db
    .select({ serviceGroupId: entityServices.serviceGroupId })
    .from(entityServices)
    .where(
      and(
        eq(entityServices.entityId, entity.id),
        isNull(entityServices.removedAt),
      ),
    );

  if (activeServices.length > 0) {
    // SERVICE-DRIVEN PATH. The rule list = rules attached to any of
    // the entity's active services, intersected with jurisdiction
    // and effective-date filters.
    const serviceIds = activeServices.map((s) => s.serviceGroupId);
    const rows = await db
      .selectDistinct({
        id: deadlineRules.id,
        jurisdictionType: deadlineRules.jurisdictionType,
        jurisdictionCode: deadlineRules.jurisdictionCode,
        formCode: deadlineRules.formCode,
        title: deadlineRules.title,
        description: deadlineRules.description,
        entityTypes: deadlineRules.entityTypes,
        ruleType: deadlineRules.ruleType,
        rulePayload: deadlineRules.rulePayload,
        extensionFormCode: deadlineRules.extensionFormCode,
        extensionPayload: deadlineRules.extensionPayload,
        penaltySummary: deadlineRules.penaltySummary,
        sourceUrl: deadlineRules.sourceUrl,
        version: deadlineRules.version,
        effectiveFrom: deadlineRules.effectiveFrom,
        effectiveTo: deadlineRules.effectiveTo,
        irrevocable: deadlineRules.irrevocable,
        createdAt: deadlineRules.createdAt,
      })
      .from(deadlineRules)
      .innerJoin(
        serviceGroupRules,
        eq(serviceGroupRules.ruleId, deadlineRules.id),
      )
      .where(
        and(
          inArray(serviceGroupRules.serviceGroupId, serviceIds),
          inArray(deadlineRules.jurisdictionCode, jurisdictionList),
          lte(deadlineRules.effectiveFrom, today),
          or(
            isNull(deadlineRules.effectiveTo),
            sql`${deadlineRules.effectiveTo} > ${today}`,
          ),
          electionFilter,
        ),
      );
    return rows as DeadlineRule[];
  }

  // ENTITY-TYPE FALLBACK PATH (pre-services entities or anything that
  // was never assigned services). jsonb ? 'key' checks array
  // membership; entity.entityType comes from the pgEnum so safe.
  const rows = await db
    .select()
    .from(deadlineRules)
    .where(
      and(
        inArray(deadlineRules.jurisdictionCode, jurisdictionList),
        sql`${deadlineRules.entityTypes} ? ${entity.entityType}`,
        lte(deadlineRules.effectiveFrom, today),
        or(
          isNull(deadlineRules.effectiveTo),
          sql`${deadlineRules.effectiveTo} > ${today}`,
        ),
        electionFilter,
      ),
    );

  return rows;
}

/**
 * Materialize deadline_instances for an entity for a given tax year.
 * Uses the unique (entity_id, rule_id, tax_year) index — re-runs are no-ops.
 */
export async function generateDeadlinesForEntity(
  input: GenerateDeadlinesInput,
  entity: Entity,
): Promise<{ created: number; skipped: number }> {
  const parsed = GenerateDeadlinesInputSchema.parse(input);
  const db = getDb();

  const rules = await selectApplicableRules(entity);
  if (rules.length === 0) {
    return { created: 0, skipped: 0 };
  }

  // Two modes:
  // - default (forward-looking): skip deadlines whose due_date is in the past
  // - includeHistoricalAsCompleted: keep the past ones but mark them as
  //   "completed" so they don't pollute the Overdue stat — used by import
  //   opt-in to give CPAs a historical audit trail.
  const today = new Date().toISOString().slice(0, 10);
  const includeHistorical = parsed.includeHistoricalAsCompleted;

  const values = rules
    .map((rule) => {
      const payload = rule.rulePayload as unknown as RulePayload;
      // Pass entity so FYE-relative rules use the entity's actual
      // fiscal year end. Calendar-year entities (Dec 31 default)
      // fall through to the same dates as before.
      const dueDate = computeDueDate(payload, parsed.taxYear, entity);
      const isPast = dueDate < today;

      if (isPast && !includeHistorical) return null;

      return {
        orgId: parsed.orgId,
        entityId: parsed.entityId,
        ruleId: rule.id,
        taxYear: parsed.taxYear,
        dueDate,
        status: isPast ? ("completed" as const) : ("pending" as const),
        completedAt: isPast ? new Date(dueDate + "T23:59:59Z") : null,
        completedByActorType: isPast ? ("system" as const) : null,
        notes: isPast
          ? "Imported as historical — verify actual filing date"
          : null,
      };
    })
    .filter(
      (row): row is NonNullable<typeof row> => row !== null,
    );

  // Guard: if all rules filter out (e.g. single-rule entity type like
  // trust, where only federal 1041 applies and its due date is past
  // without `includeHistoricalAsCompleted`), Drizzle's .values([]) throws.
  // Silently succeed with 0 created — the entity still exists and will
  // pick up deadlines in future tax years via a later generation run.
  if (values.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const result = await db
    .insert(deadlineInstances)
    .values(values)
    .onConflictDoNothing({
      target: [
        deadlineInstances.entityId,
        deadlineInstances.ruleId,
        deadlineInstances.taxYear,
      ],
    })
    .returning({ id: deadlineInstances.id });

  const created = result.length;
  const skipped = values.length - created;

  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "deadlines.generated",
    targetType: "entity",
    targetId: parsed.entityId,
    payload: { taxYear: parsed.taxYear, created, skipped },
  });

  return { created, skipped };
}

/**
 * List upcoming deadlines for an org with joined context (entity, client, rule).
 * Used by the dashboard.
 */
export const ListDashboardInputSchema = z.object({
  orgId: z.string(),
  daysAhead: z.number().int().positive().max(365).default(60),
  limit: z.number().int().positive().max(200).default(100),
  offset: z.number().int().nonnegative().default(0),
  // Server-side filters so we don't ship 500+ rows on every filter change.
  urgency: z.enum(["all", "urgent", "irrevocable"]).default("all"),
  jurisdictionCode: z.string().default("all"),
  entityType: z.string().default("all"),
  status: z.enum(["active", "extended_only"]).default("active"),
  // Free-text narrow — case-insensitive contains-match against client name,
  // entity name, form code, and rule title. Undefined / empty means no
  // search applied.
  search: z.string().min(1).max(200).optional(),
  /**
   * Scope to deadlines owned by a specific user. Special value
   * "unassigned" maps to NULL owner. Undefined means no owner filter
   * (all deadlines visible regardless of assignment).
   */
  ownerFilter: z.string().min(1).optional(),
});
export type ListDashboardInput = z.input<typeof ListDashboardInputSchema>;

export async function listDashboardDeadlines(input: ListDashboardInput) {
  const parsed = ListDashboardInputSchema.parse(input);
  const db = getDb();

  const today = new Date().toISOString().slice(0, 10);
  const future = (() => {
    const d = new Date();
    d.setDate(d.getDate() + parsed.daysAhead);
    return d.toISOString().slice(0, 10);
  })();
  // For "urgent" filter: today + 7 days
  const urgentCutoff = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  })();

  // Build WHERE clause dynamically using conditional fragments.
  // After the 2026-05-01 status collapse, "open" is just
  // `completed_at IS NULL`. "extended_only" further narrows to rows
  // that also have the extension flag set.
  const statusWhere =
    parsed.status === "extended_only"
      ? sql`di.is_extended = true AND di.completed_at IS NULL`
      : sql`di.completed_at IS NULL`;

  const urgencyWhere =
    parsed.urgency === "urgent"
      ? sql`AND COALESCE(di.extension_due_date, di.due_date) <= ${urgentCutoff}`
      : parsed.urgency === "irrevocable"
      ? sql`AND r.irrevocable = true`
      : sql``;

  const jurisdictionWhere =
    parsed.jurisdictionCode === "all"
      ? sql``
      : sql`AND r.jurisdiction_code = ${parsed.jurisdictionCode}`;

  const entityTypeWhere =
    parsed.entityType === "all"
      ? sql``
      : sql`AND e.entity_type::text = ${parsed.entityType}`;

  // Owner narrow — "unassigned" maps to IS NULL; an actual user id
  // filters to deadlines owned by that user. Undefined skips the filter.
  const ownerWhere = parsed.ownerFilter
    ? parsed.ownerFilter === "unassigned"
      ? sql`AND di.owner_user_id IS NULL`
      : sql`AND di.owner_user_id = ${parsed.ownerFilter}`
    : sql``;

  // Free-text search — escape SQL LIKE wildcards so a CPA pasting
  // "Tan_Fund%" treats those as literal characters, not LIKE patterns.
  // The pattern is built once and reused across 4 ILIKE branches.
  const searchWhere = parsed.search
    ? (() => {
        const escaped = parsed.search!.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
        const pattern = `%${escaped}%`;
        return sql`AND (
          c.name ILIKE ${pattern}
          OR e.name ILIKE ${pattern}
          OR r.form_code ILIKE ${pattern}
          OR r.title ILIKE ${pattern}
        )`;
      })()
    : sql``;

  const rows = await db.execute<{
    id: string;
    due_date: string;
    effective_due_date: string;
    completed_at: string | null;
    tax_year: number;
    client_id: string;
    client_name: string;
    entity_id: string;
    entity_name: string;
    entity_type: string;
    rule_id: string;
    form_code: string;
    rule_title: string;
    jurisdiction_code: string;
    irrevocable: boolean;
    is_extended: boolean;
    owner_user_id: string | null;
    owner_full_name: string | null;
    owner_email: string | null;
  }>(sql`
    SELECT
      di.id,
      di.due_date,
      COALESCE(di.extension_due_date, di.due_date) AS effective_due_date,
      di.completed_at::text AS completed_at,
      di.tax_year,
      e.id AS entity_id,
      e.name AS entity_name,
      e.entity_type,
      c.id AS client_id,
      c.name AS client_name,
      r.id AS rule_id,
      r.form_code,
      r.title AS rule_title,
      r.jurisdiction_code,
      r.irrevocable,
      di.is_extended,
      di.owner_user_id,
      ow.full_name AS owner_full_name,
      ow.email AS owner_email
    FROM deadline_instances di
    INNER JOIN entities e ON e.id = di.entity_id
    INNER JOIN clients c ON c.id = e.client_id
    INNER JOIN deadline_rules r ON r.id = di.rule_id
    LEFT JOIN users ow ON ow.id = di.owner_user_id
    WHERE di.org_id = ${parsed.orgId}
      AND COALESCE(di.extension_due_date, di.due_date) BETWEEN ${today} AND ${future}
      AND ${statusWhere}
      ${urgencyWhere}
      ${jurisdictionWhere}
      ${entityTypeWhere}
      ${ownerWhere}
      ${searchWhere}
    ORDER BY effective_due_date ASC, r.irrevocable DESC, di.id ASC
    LIMIT ${parsed.limit}
    OFFSET ${parsed.offset}
  `);

  return rows.rows;
}

/**
 * Dashboard counts (this week / this month / overdue / completed-30d).
 */
export async function getDashboardStats(orgId: string) {
  const db = getDb();

  // All counts use the effective due date (extension_due_date when present,
  // otherwise due_date) so extended deadlines surface at their NEW date.
  const rows = await db.execute<{
    this_week: number;
    this_month: number;
    overdue: number;
    completed_30d: number;
  }>(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE COALESCE(extension_due_date, due_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
        AND completed_at IS NULL
      ) AS this_week,
      COUNT(*) FILTER (
        WHERE COALESCE(extension_due_date, due_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
        AND completed_at IS NULL
      ) AS this_month,
      COUNT(*) FILTER (
        WHERE COALESCE(extension_due_date, due_date) < CURRENT_DATE
        AND completed_at IS NULL
      ) AS overdue,
      COUNT(*) FILTER (
        WHERE completed_at IS NOT NULL
        AND completed_at >= CURRENT_DATE - INTERVAL '30 days'
      ) AS completed_30d
    FROM deadline_instances
    WHERE org_id = ${orgId}
  `);

  const r = rows.rows[0];
  return {
    thisWeek: Number(r?.this_week ?? 0),
    thisMonth: Number(r?.this_month ?? 0),
    overdue: Number(r?.overdue ?? 0),
    completed: Number(r?.completed_30d ?? 0),
  };
}
