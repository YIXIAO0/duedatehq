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
  type DeadlineRule,
  type Entity,
} from "@/lib/db/schema";
import { recordAudit } from "./audit";

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

type RulePayload = {
  month: number;
  day: number;
  yearOffset?: number; // 0 (same as taxYear), 1 (filing year, default), 2 (next filing year for Q4 estimates)
};

/**
 * Compute the actual due date for a rule in a given tax year.
 * Weekend shift: Saturday → Monday (+2 days), Sunday → Monday (+1 day).
 */
export function computeDueDate(
  rulePayload: RulePayload,
  taxYear: number,
): string {
  const offset = rulePayload.yearOffset ?? 1;
  const year = taxYear + offset;
  const month0 = rulePayload.month - 1; // JS months are 0-indexed

  const date = new Date(Date.UTC(year, month0, rulePayload.day));
  const dow = date.getUTCDay();
  if (dow === 6) date.setUTCDate(date.getUTCDate() + 2); // Saturday → Monday
  if (dow === 0) date.setUTCDate(date.getUTCDate() + 1); // Sunday → Monday

  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Pick rules applicable to the entity.
 * Runs as a single DB query using jsonb containment for entity_types.
 */
async function selectApplicableRules(
  entity: Entity,
): Promise<DeadlineRule[]> {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const jurisdictions = new Set<string>(["federal"]);
  if (entity.homeState) jurisdictions.add(entity.homeState);
  for (const state of entity.operatingStates ?? []) jurisdictions.add(state);

  // jsonb ? 'key' checks array element presence. Using sql.raw is fine here
  // because entity.entityType is from a pgEnum (trusted input).
  const rows = await db
    .select()
    .from(deadlineRules)
    .where(
      and(
        inArray(deadlineRules.jurisdictionCode, Array.from(jurisdictions)),
        sql`${deadlineRules.entityTypes} ? ${entity.entityType}`,
        lte(deadlineRules.effectiveFrom, today),
        or(
          isNull(deadlineRules.effectiveTo),
          sql`${deadlineRules.effectiveTo} > ${today}`,
        ),
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
      const dueDate = computeDueDate(payload, parsed.taxYear);
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
  const statusWhere =
    parsed.status === "extended_only"
      ? sql`di.status = 'extended'`
      : sql`di.status IN ('pending', 'waiting_on_client', 'in_progress', 'ready_to_file', 'extended')`;

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

  const rows = await db.execute<{
    id: string;
    due_date: string;
    effective_due_date: string;
    status: string;
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
  }>(sql`
    SELECT
      di.id,
      di.due_date,
      COALESCE(di.extension_due_date, di.due_date) AS effective_due_date,
      di.status,
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
      (di.status = 'extended') AS is_extended
    FROM deadline_instances di
    INNER JOIN entities e ON e.id = di.entity_id
    INNER JOIN clients c ON c.id = e.client_id
    INNER JOIN deadline_rules r ON r.id = di.rule_id
    WHERE di.org_id = ${parsed.orgId}
      AND COALESCE(di.extension_due_date, di.due_date) BETWEEN ${today} AND ${future}
      AND ${statusWhere}
      ${urgencyWhere}
      ${jurisdictionWhere}
      ${entityTypeWhere}
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
        AND status IN ('pending', 'waiting_on_client', 'in_progress', 'ready_to_file', 'extended')
      ) AS this_week,
      COUNT(*) FILTER (
        WHERE COALESCE(extension_due_date, due_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
        AND status IN ('pending', 'waiting_on_client', 'in_progress', 'ready_to_file', 'extended')
      ) AS this_month,
      COUNT(*) FILTER (
        WHERE COALESCE(extension_due_date, due_date) < CURRENT_DATE
        AND status IN ('pending', 'waiting_on_client', 'in_progress', 'ready_to_file', 'extended')
      ) AS overdue,
      COUNT(*) FILTER (
        WHERE status = 'completed'
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
