/**
 * Deadline service — query and mutate deadline instances.
 *
 * The "auto-generate year calendar from entity" engine lives here (V2 will
 * materialize rules into instances when entities are added).
 *
 * For MVP Day 1, the mutation surface is:
 *   - listUpcoming(orgId, window)
 *   - markCompleted(id, actor)
 *   - fileExtension(id, newDueDate, actor)
 */

import "server-only";
import { z } from "zod";
import { and, asc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  clients,
  deadlineInstances,
  deadlineRules,
  entities,
} from "@/lib/db/schema";
import { recordAudit } from "./audit";

// ---------------------------------------------------------------------------
// Zod schemas (MCP-reusable)
// ---------------------------------------------------------------------------

export const ListUpcomingInputSchema = z.object({
  orgId: z.string(),
  fromDate: z.string().optional(), // ISO date; defaults to today
  toDate: z.string().optional(), // ISO date; defaults to +30d
  limit: z.number().int().positive().max(500).default(100),
});
export type ListUpcomingInput = z.input<typeof ListUpcomingInputSchema>;

export const MarkCompletedInputSchema = z.object({
  deadlineInstanceId: z.string(),
  orgId: z.string(),
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
  notes: z.string().max(2000).optional(),
});
export type MarkCompletedInput = z.input<typeof MarkCompletedInputSchema>;

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function listUpcoming(input: ListUpcomingInput) {
  const parsed = ListUpcomingInputSchema.parse(input);
  const db = getDb();

  const today = new Date().toISOString().slice(0, 10);
  const defaultTo = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  })();

  const from = parsed.fromDate ?? today;
  const to = parsed.toDate ?? defaultTo;

  return db
    .select()
    .from(deadlineInstances)
    .where(
      and(
        eq(deadlineInstances.orgId, parsed.orgId),
        gte(deadlineInstances.dueDate, from),
        lte(deadlineInstances.dueDate, to),
        ne(deadlineInstances.status, "completed"),
        ne(deadlineInstances.status, "not_applicable"),
      ),
    )
    .orderBy(asc(deadlineInstances.dueDate))
    .limit(parsed.limit);
}

export async function markCompleted(input: MarkCompletedInput) {
  const parsed = MarkCompletedInputSchema.parse(input);
  const db = getDb();

  // Read pre-state so the audit payload knows what we transitioned FROM.
  // Cheap (one indexed read) + makes the history timeline properly
  // narratable: "Filed (was extended, due Oct 15)".
  const [pre] = await db
    .select()
    .from(deadlineInstances)
    .where(
      and(
        eq(deadlineInstances.id, parsed.deadlineInstanceId),
        eq(deadlineInstances.orgId, parsed.orgId),
      ),
    )
    .limit(1);

  if (!pre) {
    throw new Error(
      `Deadline ${parsed.deadlineInstanceId} not found in org ${parsed.orgId}`,
    );
  }

  const [row] = await db
    .update(deadlineInstances)
    .set({
      status: "completed",
      completedAt: new Date(),
      completedByUserId: parsed.actorType === "user" ? parsed.actorId : null,
      completedByActorType: parsed.actorType,
      notes: parsed.notes,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(deadlineInstances.id, parsed.deadlineInstanceId),
        eq(deadlineInstances.orgId, parsed.orgId),
      ),
    )
    .returning();

  if (!row) {
    throw new Error(`Deadline ${parsed.deadlineInstanceId} not found in org ${parsed.orgId}`);
  }

  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "deadline.completed",
    targetType: "deadline_instance",
    targetId: row.id,
    payload: {
      taxYear: row.taxYear,
      originalDueDate: row.dueDate,
      effectiveDueDate: row.extensionDueDate ?? row.dueDate,
      previousStatus: pre.status,
      wasExtended: pre.status === "extended",
      completedAt: row.completedAt?.toISOString(),
    },
  });

  return row;
}

// ---------------------------------------------------------------------------
// File extension — marks original as "extended" with a new effective due date
// ---------------------------------------------------------------------------

export const FileExtensionInputSchema = z.object({
  deadlineInstanceId: z.string(),
  orgId: z.string(),
  newDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
  notes: z.string().max(2000).optional(),
});
export type FileExtensionInput = z.input<typeof FileExtensionInputSchema>;

export async function fileExtension(input: FileExtensionInput) {
  const parsed = FileExtensionInputSchema.parse(input);
  const db = getDb();

  // Capture pre-state — critical here. If this is the SECOND extension
  // (e.g., disaster relief stacking on top of Form 4868), the previous
  // extension_due_date is about to be overwritten and we need to log it
  // in the audit chain so the timeline can read "Apr 15 → Oct 15 → Jan 15".
  const [pre] = await db
    .select()
    .from(deadlineInstances)
    .where(
      and(
        eq(deadlineInstances.id, parsed.deadlineInstanceId),
        eq(deadlineInstances.orgId, parsed.orgId),
      ),
    )
    .limit(1);

  if (!pre) {
    throw new Error(
      `Deadline ${parsed.deadlineInstanceId} not found in org ${parsed.orgId}`,
    );
  }

  const [row] = await db
    .update(deadlineInstances)
    .set({
      status: "extended",
      extensionFiledAt: new Date(),
      extensionDueDate: parsed.newDueDate,
      notes: parsed.notes,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(deadlineInstances.id, parsed.deadlineInstanceId),
        eq(deadlineInstances.orgId, parsed.orgId),
      ),
    )
    .returning();

  if (!row) {
    throw new Error(
      `Deadline ${parsed.deadlineInstanceId} not found in org ${parsed.orgId}`,
    );
  }

  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "deadline.extension_filed",
    targetType: "deadline_instance",
    targetId: row.id,
    payload: {
      originalDueDate: row.dueDate,
      previousExtensionDueDate: pre.extensionDueDate, // null on first extension
      previousStatus: pre.status, // "pending" first time, "extended" if stacking
      newDueDate: parsed.newDueDate,
      extensionFiledAt: row.extensionFiledAt?.toISOString(),
      isReExtension: pre.status === "extended",
    },
  });

  return row;
}

// ---------------------------------------------------------------------------
// Update notes only — separate from completion/extension
// ---------------------------------------------------------------------------

export const UpdateNotesInputSchema = z.object({
  deadlineInstanceId: z.string(),
  orgId: z.string(),
  notes: z.string().max(2000),
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
});
export type UpdateNotesInput = z.input<typeof UpdateNotesInputSchema>;

export async function updateDeadlineNotes(input: UpdateNotesInput) {
  const parsed = UpdateNotesInputSchema.parse(input);
  const db = getDb();

  // Pre-state for the audit; we deliberately do NOT log the notes
  // content (could contain SSNs, PII, client gossip) — just the
  // boolean had/has so the timeline can say "notes updated".
  const [pre] = await db
    .select({ notes: deadlineInstances.notes })
    .from(deadlineInstances)
    .where(
      and(
        eq(deadlineInstances.id, parsed.deadlineInstanceId),
        eq(deadlineInstances.orgId, parsed.orgId),
      ),
    )
    .limit(1);

  if (!pre) {
    throw new Error(`Deadline ${parsed.deadlineInstanceId} not found`);
  }

  const [row] = await db
    .update(deadlineInstances)
    .set({ notes: parsed.notes, updatedAt: new Date() })
    .where(
      and(
        eq(deadlineInstances.id, parsed.deadlineInstanceId),
        eq(deadlineInstances.orgId, parsed.orgId),
      ),
    )
    .returning();

  if (!row) {
    throw new Error(`Deadline ${parsed.deadlineInstanceId} not found`);
  }

  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "deadline.notes_updated",
    targetType: "deadline_instance",
    targetId: row.id,
    payload: {
      hadNotes: !!(pre.notes && pre.notes.length > 0),
      hasNotes: !!(parsed.notes && parsed.notes.length > 0),
      // Content deliberately omitted — too easy to leak PII into logs.
    },
  });

  return row;
}

// ---------------------------------------------------------------------------
// Re-open a completed deadline (in case CPA mis-clicked)
// ---------------------------------------------------------------------------

export async function reopenDeadline(input: MarkCompletedInput) {
  const parsed = MarkCompletedInputSchema.parse(input);
  const db = getDb();

  // Capture pre-state. A "reopened" event without context is hard to
  // read on the timeline — we want "Reopened from Filed (was due Apr 15)".
  const [pre] = await db
    .select()
    .from(deadlineInstances)
    .where(
      and(
        eq(deadlineInstances.id, parsed.deadlineInstanceId),
        eq(deadlineInstances.orgId, parsed.orgId),
      ),
    )
    .limit(1);

  if (!pre) throw new Error(`Deadline ${parsed.deadlineInstanceId} not found`);

  const [row] = await db
    .update(deadlineInstances)
    .set({
      status: "pending",
      completedAt: null,
      completedByUserId: null,
      completedByActorType: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(deadlineInstances.id, parsed.deadlineInstanceId),
        eq(deadlineInstances.orgId, parsed.orgId),
      ),
    )
    .returning();

  if (!row) throw new Error(`Deadline ${parsed.deadlineInstanceId} not found`);

  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "deadline.reopened",
    targetType: "deadline_instance",
    targetId: row.id,
    payload: {
      previousStatus: pre.status,
      previousCompletedAt: pre.completedAt?.toISOString() ?? null,
    },
  });

  return row;
}

// ---------------------------------------------------------------------------
// Fetch a single deadline with its joined context (rule + entity + client)
// ---------------------------------------------------------------------------

export async function getDeadlineDetail(
  deadlineInstanceId: string,
  orgId: string,
) {
  const db = getDb();

  const rows = await db.execute<{
    id: string;
    org_id: string;
    entity_id: string;
    rule_id: string;
    tax_year: number;
    due_date: string;
    status: string;
    completed_at: string | null;
    completed_by_user_id: string | null;
    completed_by_actor_type: string | null;
    extension_filed_at: string | null;
    extension_due_date: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
    rule_title: string;
    rule_form_code: string;
    rule_description: string | null;
    rule_jurisdiction_type: string;
    rule_jurisdiction_code: string;
    rule_source_url: string;
    rule_extension_form_code: string | null;
    rule_penalty_summary: string | null;
    rule_irrevocable: boolean;
    entity_name: string;
    entity_type: string;
    entity_home_state: string | null;
    client_id: string;
    client_name: string;
  }>(sql`
    SELECT
      di.id,
      di.org_id,
      di.entity_id,
      di.rule_id,
      di.tax_year,
      di.due_date,
      di.status,
      di.completed_at,
      di.completed_by_user_id,
      di.completed_by_actor_type,
      di.extension_filed_at,
      di.extension_due_date,
      di.notes,
      di.created_at,
      di.updated_at,
      r.title AS rule_title,
      r.form_code AS rule_form_code,
      r.description AS rule_description,
      r.jurisdiction_type AS rule_jurisdiction_type,
      r.jurisdiction_code AS rule_jurisdiction_code,
      r.source_url AS rule_source_url,
      r.extension_form_code AS rule_extension_form_code,
      r.penalty_summary AS rule_penalty_summary,
      r.irrevocable AS rule_irrevocable,
      e.name AS entity_name,
      e.entity_type,
      e.home_state AS entity_home_state,
      c.id AS client_id,
      c.name AS client_name
    FROM deadline_instances di
    INNER JOIN deadline_rules r ON r.id = di.rule_id
    INNER JOIN entities e ON e.id = di.entity_id
    INNER JOIN clients c ON c.id = e.client_id
    WHERE di.id = ${deadlineInstanceId}
      AND di.org_id = ${orgId}
    LIMIT 1
  `);

  return rows.rows[0] ?? null;
}

export type DeadlineDetail = NonNullable<
  Awaited<ReturnType<typeof getDeadlineDetail>>
>;

// ---------------------------------------------------------------------------
// Deadlines for a single client — used by the /clients/[id] page so the
// CPA can see the full work surface for one client without bouncing to
// the dashboard. Returns open + extended (NOT completed/missed); the
// caller can opt-in to completed via includeFiled if we add that toggle.
// Sorted by effective due date so the next thing to do is at the top.
//
// Window: by default we cap at +365 days into the future. The deadline
// engine generates two tax years' worth of instances on entity creation,
// so without a cap the list shows things 500+ days out — pure noise for
// a CPA whose working horizon is the next filing season + estimates.
// Overdue (past) items always show because they're real outstanding work.
// ---------------------------------------------------------------------------

export type ClientDeadlineRow = {
  id: string;
  taxYear: number;
  dueDate: string;
  effectiveDueDate: string;
  status: string;
  notes: string | null;
  formCode: string;
  ruleTitle: string;
  jurisdictionCode: string;
  irrevocable: boolean;
  entityId: string;
  entityName: string;
  entityType: string;
};

export async function listDeadlinesForClient(args: {
  orgId: string;
  clientId: string;
  /** Default false — only show work-still-to-do. Set true for full history. */
  includeFiled?: boolean;
  /** Default 365 — cap how far into the future we show. Overdue always shown. */
  withinDays?: number;
}): Promise<ClientDeadlineRow[]> {
  const db = getDb();
  const includeFiled = args.includeFiled ?? false;
  const withinDays = args.withinDays ?? 365;

  const statusFilter = includeFiled
    ? sql``
    : sql`AND di.status IN ('pending', 'in_progress', 'extended')`;

  // future-window cap. Past items pass through unconditionally (overdue
  // work is real work), only future deadlines get the +N days lid.
  const windowFilter = sql`AND (
    COALESCE(di.extension_due_date, di.due_date) <= CURRENT_DATE
    OR COALESCE(di.extension_due_date, di.due_date)
       <= (CURRENT_DATE + (${withinDays}::int * INTERVAL '1 day'))
  )`;

  const rows = await db.execute<{
    id: string;
    tax_year: number;
    due_date: string;
    effective_due_date: string;
    status: string;
    notes: string | null;
    form_code: string;
    rule_title: string;
    jurisdiction_code: string;
    irrevocable: boolean;
    entity_id: string;
    entity_name: string;
    entity_type: string;
  }>(sql`
    SELECT
      di.id,
      di.tax_year,
      di.due_date::text AS due_date,
      COALESCE(di.extension_due_date, di.due_date)::text AS effective_due_date,
      di.status::text AS status,
      di.notes,
      r.form_code,
      r.title AS rule_title,
      r.jurisdiction_code,
      r.irrevocable,
      e.id AS entity_id,
      e.name AS entity_name,
      e.entity_type::text AS entity_type
    FROM deadline_instances di
    INNER JOIN deadline_rules r ON r.id = di.rule_id
    INNER JOIN entities e ON e.id = di.entity_id
    INNER JOIN clients c ON c.id = e.client_id
    WHERE c.id = ${args.clientId}
      AND c.org_id = ${args.orgId}
      AND e.archived_at IS NULL
      ${statusFilter}
      ${windowFilter}
    ORDER BY effective_due_date ASC, e.name ASC, r.form_code ASC
  `);

  return rows.rows.map((r) => ({
    id: r.id,
    taxYear: r.tax_year,
    dueDate: r.due_date,
    effectiveDueDate: r.effective_due_date,
    status: r.status,
    notes: r.notes,
    formCode: r.form_code,
    ruleTitle: r.rule_title,
    jurisdictionCode: r.jurisdiction_code,
    irrevocable: r.irrevocable,
    entityId: r.entity_id,
    entityName: r.entity_name,
    entityType: r.entity_type,
  }));
}

// ---------------------------------------------------------------------------
// Deadline history — reads audit_events for one deadline and joins the
// actor (user) so we can render "Sarah filed extension on Apr 25".
//
// Org-scoped via the deadline existence check (caller passes orgId).
// Sorted oldest → newest because timelines read top-to-bottom that way.
// ---------------------------------------------------------------------------

export type DeadlineHistoryEntry = {
  id: string;
  action: string;
  occurredAt: Date;
  actorType: "user" | "agent" | "cron" | "system";
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  payload: Record<string, unknown> | null;
};

export async function getDeadlineHistory(
  deadlineInstanceId: string,
  orgId: string,
): Promise<DeadlineHistoryEntry[]> {
  const db = getDb();
  const rows = await db.execute<{
    id: string;
    action: string;
    occurred_at: Date;
    actor_type: "user" | "agent" | "cron" | "system";
    actor_id: string | null;
    actor_name: string | null;
    actor_email: string | null;
    payload: Record<string, unknown> | null;
  }>(sql`
    SELECT
      ae.id,
      ae.action,
      ae.occurred_at,
      ae.actor_type,
      ae.actor_id,
      u.full_name AS actor_name,
      u.email AS actor_email,
      ae.payload
    FROM audit_events ae
    LEFT JOIN users u
      ON ae.actor_type = 'user' AND u.id = ae.actor_id
    WHERE ae.org_id = ${orgId}
      AND ae.target_type = 'deadline_instance'
      AND ae.target_id = ${deadlineInstanceId}
    ORDER BY ae.occurred_at ASC
  `);

  return rows.rows.map((r) => ({
    id: r.id,
    action: r.action,
    occurredAt: new Date(r.occurred_at),
    actorType: r.actor_type,
    actorId: r.actor_id,
    actorName: r.actor_name,
    actorEmail: r.actor_email,
    payload: r.payload,
  }));
}
