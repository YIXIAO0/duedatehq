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

  // Skip deadlines whose computed due_date is already in the past.
  // Rationale: on a fresh import, surfacing TY-prior deadlines as "overdue"
  // creates false panic — the user hasn't committed to managing those, and
  // there's no bulk "mark completed" yet. V2: offer "also import historical
  // completed filings" as an explicit opt-in during the import flow.
  const today = new Date().toISOString().slice(0, 10);
  const values = rules
    .map((rule) => {
      const payload = rule.rulePayload as unknown as RulePayload;
      return {
        orgId: parsed.orgId,
        entityId: parsed.entityId,
        ruleId: rule.id,
        taxYear: parsed.taxYear,
        dueDate: computeDueDate(payload, parsed.taxYear),
        status: "pending" as const,
      };
    })
    .filter((row) => row.dueDate >= today);

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

  const rows = await db.execute<{
    id: string;
    due_date: string;
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
  }>(sql`
    SELECT
      di.id,
      di.due_date,
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
      r.irrevocable
    FROM deadline_instances di
    INNER JOIN entities e ON e.id = di.entity_id
    INNER JOIN clients c ON c.id = e.client_id
    INNER JOIN deadline_rules r ON r.id = di.rule_id
    WHERE di.org_id = ${parsed.orgId}
      AND di.due_date BETWEEN ${today} AND ${future}
      AND di.status IN ('pending', 'in_progress', 'extended')
    ORDER BY di.due_date ASC, r.irrevocable DESC
    LIMIT ${parsed.limit}
  `);

  return rows.rows;
}

/**
 * Dashboard counts (this week / this month / overdue / completed-30d).
 */
export async function getDashboardStats(orgId: string) {
  const db = getDb();

  const rows = await db.execute<{
    this_week: number;
    this_month: number;
    overdue: number;
    completed_30d: number;
  }>(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
        AND status IN ('pending', 'in_progress')
      ) AS this_week,
      COUNT(*) FILTER (
        WHERE due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
        AND status IN ('pending', 'in_progress')
      ) AS this_month,
      COUNT(*) FILTER (
        WHERE due_date < CURRENT_DATE
        AND status IN ('pending', 'in_progress')
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
