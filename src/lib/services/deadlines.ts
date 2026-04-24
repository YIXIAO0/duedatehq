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
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { deadlineInstances } from "@/lib/db/schema";
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
    payload: { taxYear: row.taxYear, dueDate: row.dueDate },
  });

  return row;
}
