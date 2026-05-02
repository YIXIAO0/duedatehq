/**
 * Deadline subtask (prep stage) service.
 *
 * Stages are user-defined nodes between "today" and a deadline's due
 * date. CRUD + reorder + a `shiftAfter` helper used by the extension
 * flow when the parent due date moves.
 *
 * Scope is intentionally tight: this layer never touches calendar/ICS
 * exports — sub-stages are internal-only by design (see schema comment
 * on `deadlineSubtasks`). They surface in the dashboard, the deadline
 * detail page, and (later, in C-3) the in-app banner + email digest.
 */

import "server-only";
import { z } from "zod";
import { and, asc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  deadlineInstances,
  deadlineSubtasks,
  memberships,
} from "@/lib/db/schema";
import { recordAudit } from "./audit";

// ---------------------------------------------------------------------------
// Domain type
// ---------------------------------------------------------------------------

export type DeadlineSubtask = {
  id: string;
  deadlineInstanceId: string;
  orgId: string;
  label: string;
  dueDate: string; // YYYY-MM-DD
  sortOrder: number;
  ownerUserId: string | null;
  completedAt: Date | null;
  completedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LABEL_MAX = 120;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * List all stages for a single deadline, ordered by sort_order then due
 * date. Always scoped by orgId so a tampered request can't read another
 * tenant's stages.
 */
export async function listSubtasks(
  deadlineInstanceId: string,
  orgId: string,
): Promise<DeadlineSubtask[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(deadlineSubtasks)
    .where(
      and(
        eq(deadlineSubtasks.deadlineInstanceId, deadlineInstanceId),
        eq(deadlineSubtasks.orgId, orgId),
      ),
    )
    .orderBy(asc(deadlineSubtasks.sortOrder), asc(deadlineSubtasks.dueDate));
  return rows.map(toDomain);
}

/**
 * Compact progress aggregate for the dashboard list row. Single
 * round-trip per deadline batch — see listProgressForDeadlines below
 * for the bulk variant the dashboard query plan should use instead.
 */
export type SubtaskProgress = {
  total: number;
  done: number;
  /** Earliest open stage on/after today (the "next up" hint). null = no open stages. */
  nextOpen: { label: string; dueDate: string } | null;
};

/**
 * Bulk fetch progress summaries for many deadlines in a single query.
 * Used by the dashboard so we don't N+1 across a long open-deadlines
 * list. Returns a Map keyed by deadlineInstanceId; missing entries =
 * no subtasks (callers should treat as empty progress).
 */
export async function listProgressForDeadlines(
  deadlineInstanceIds: string[],
  orgId: string,
): Promise<Map<string, SubtaskProgress>> {
  const map = new Map<string, SubtaskProgress>();
  if (deadlineInstanceIds.length === 0) return map;

  const db = getDb();
  const rows = await db
    .select({
      id: deadlineSubtasks.id,
      deadlineInstanceId: deadlineSubtasks.deadlineInstanceId,
      label: deadlineSubtasks.label,
      dueDate: deadlineSubtasks.dueDate,
      sortOrder: deadlineSubtasks.sortOrder,
      completedAt: deadlineSubtasks.completedAt,
    })
    .from(deadlineSubtasks)
    .where(
      and(
        eq(deadlineSubtasks.orgId, orgId),
        inArray(deadlineSubtasks.deadlineInstanceId, deadlineInstanceIds),
      ),
    )
    .orderBy(
      asc(deadlineSubtasks.deadlineInstanceId),
      asc(deadlineSubtasks.sortOrder),
      asc(deadlineSubtasks.dueDate),
    );

  // Single pass — group by deadline, compute total/done/nextOpen.
  for (const r of rows) {
    let agg = map.get(r.deadlineInstanceId);
    if (!agg) {
      agg = { total: 0, done: 0, nextOpen: null };
      map.set(r.deadlineInstanceId, agg);
    }
    agg.total += 1;
    if (r.completedAt) {
      agg.done += 1;
    } else if (!agg.nextOpen) {
      // First open row in sort-then-date order = "next up".
      agg.nextOpen = { label: r.label, dueDate: r.dueDate };
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const CreateSubtaskInputSchema = z.object({
  deadlineInstanceId: z.string(),
  orgId: z.string(),
  label: z.string().min(1).max(LABEL_MAX),
  dueDate: z.string().regex(ISO_DATE, "Must be YYYY-MM-DD"),
  /** Optional. NULL = inherit from parent deadline owner at display time. */
  ownerUserId: z.string().nullable().default(null),
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
});
export type CreateSubtaskInput = z.input<typeof CreateSubtaskInputSchema>;

export async function createSubtask(
  input: CreateSubtaskInput,
): Promise<DeadlineSubtask> {
  const parsed = CreateSubtaskInputSchema.parse(input);
  const db = getDb();

  const parent = await loadParentOrThrow(
    parsed.deadlineInstanceId,
    parsed.orgId,
  );

  if (parsed.ownerUserId) {
    await assertOrgMember(parsed.orgId, parsed.ownerUserId);
  }

  // sort_order = MAX(existing) + 1, scoped to the parent deadline. The
  // dashboard "next up" depends on stable ordering; this gives newly
  // added stages a slot at the end by default, the user can drag-reorder.
  const [{ next }] = await db
    .select({
      next: sql<number>`COALESCE(MAX(${deadlineSubtasks.sortOrder}) + 1, 0)`,
    })
    .from(deadlineSubtasks)
    .where(eq(deadlineSubtasks.deadlineInstanceId, parsed.deadlineInstanceId));

  const [row] = await db
    .insert(deadlineSubtasks)
    .values({
      deadlineInstanceId: parsed.deadlineInstanceId,
      orgId: parsed.orgId,
      label: parsed.label.trim(),
      dueDate: parsed.dueDate,
      sortOrder: Number(next),
      ownerUserId: parsed.ownerUserId,
    })
    .returning();

  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "subtask.created",
    targetType: "deadline_subtask",
    targetId: row.id,
    payload: {
      deadlineInstanceId: parent.id,
      label: row.label,
      dueDate: row.dueDate,
      ownerUserId: row.ownerUserId,
    },
  });

  return toDomain(row);
}

// ---------------------------------------------------------------------------
// Update (partial)
// ---------------------------------------------------------------------------

export const UpdateSubtaskInputSchema = z.object({
  subtaskId: z.string(),
  orgId: z.string(),
  label: z.string().min(1).max(LABEL_MAX).optional(),
  dueDate: z.string().regex(ISO_DATE).optional(),
  // `ownerUserId: null` is meaningful (= clear assignment), so use
  // a tagged shape rather than `optional` alone — z.union with literal
  // null lets the caller distinguish "don't touch" (omit) from "set to null".
  ownerUserId: z.union([z.string(), z.null()]).optional(),
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
});
export type UpdateSubtaskInput = z.input<typeof UpdateSubtaskInputSchema>;

export async function updateSubtask(
  input: UpdateSubtaskInput,
): Promise<DeadlineSubtask> {
  const parsed = UpdateSubtaskInputSchema.parse(input);
  const db = getDb();

  const pre = await loadSubtaskOrThrow(parsed.subtaskId, parsed.orgId);

  if (parsed.ownerUserId !== undefined && parsed.ownerUserId !== null) {
    await assertOrgMember(parsed.orgId, parsed.ownerUserId);
  }

  // Build patch object — only include keys the caller actually sent.
  const patch: Partial<typeof deadlineSubtasks.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (parsed.label !== undefined) patch.label = parsed.label.trim();
  if (parsed.dueDate !== undefined) patch.dueDate = parsed.dueDate;
  if (parsed.ownerUserId !== undefined) patch.ownerUserId = parsed.ownerUserId;

  // No-op if nothing actually changed (saves an audit row + UPDATE).
  const changed =
    (patch.label !== undefined && patch.label !== pre.label) ||
    (patch.dueDate !== undefined && patch.dueDate !== pre.dueDate) ||
    (patch.ownerUserId !== undefined && patch.ownerUserId !== pre.ownerUserId);
  if (!changed) return toDomain(pre);

  const [row] = await db
    .update(deadlineSubtasks)
    .set(patch)
    .where(eq(deadlineSubtasks.id, parsed.subtaskId))
    .returning();

  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "subtask.updated",
    targetType: "deadline_subtask",
    targetId: row.id,
    payload: {
      deadlineInstanceId: row.deadlineInstanceId,
      changes: diff(pre, row),
    },
  });

  return toDomain(row);
}

// ---------------------------------------------------------------------------
// Mark complete / reopen
// ---------------------------------------------------------------------------

export const MarkSubtaskCompleteInputSchema = z.object({
  subtaskId: z.string(),
  orgId: z.string(),
  completedByUserId: z.string(),
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
});
export type MarkSubtaskCompleteInput = z.input<
  typeof MarkSubtaskCompleteInputSchema
>;

export async function markSubtaskComplete(
  input: MarkSubtaskCompleteInput,
): Promise<DeadlineSubtask> {
  const parsed = MarkSubtaskCompleteInputSchema.parse(input);
  const db = getDb();

  const pre = await loadSubtaskOrThrow(parsed.subtaskId, parsed.orgId);
  if (pre.completedAt) return toDomain(pre); // idempotent

  const [row] = await db
    .update(deadlineSubtasks)
    .set({
      completedAt: new Date(),
      completedByUserId: parsed.completedByUserId,
      updatedAt: new Date(),
    })
    .where(eq(deadlineSubtasks.id, parsed.subtaskId))
    .returning();

  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "subtask.completed",
    targetType: "deadline_subtask",
    targetId: row.id,
    payload: {
      deadlineInstanceId: row.deadlineInstanceId,
      label: row.label,
    },
  });

  return toDomain(row);
}

export async function reopenSubtask(
  input: Omit<MarkSubtaskCompleteInput, "completedByUserId">,
): Promise<DeadlineSubtask> {
  const parsed = MarkSubtaskCompleteInputSchema.omit({
    completedByUserId: true,
  }).parse(input);
  const db = getDb();

  const pre = await loadSubtaskOrThrow(parsed.subtaskId, parsed.orgId);
  if (!pre.completedAt) return toDomain(pre); // idempotent

  const [row] = await db
    .update(deadlineSubtasks)
    .set({
      completedAt: null,
      completedByUserId: null,
      updatedAt: new Date(),
    })
    .where(eq(deadlineSubtasks.id, parsed.subtaskId))
    .returning();

  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "subtask.reopened",
    targetType: "deadline_subtask",
    targetId: row.id,
    payload: {
      deadlineInstanceId: row.deadlineInstanceId,
      label: row.label,
    },
  });

  return toDomain(row);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteSubtask(input: {
  subtaskId: string;
  orgId: string;
  actorType?: "user" | "agent" | "cron" | "system";
  actorId?: string | null;
}): Promise<void> {
  const db = getDb();
  const pre = await loadSubtaskOrThrow(input.subtaskId, input.orgId);

  await db.delete(deadlineSubtasks).where(eq(deadlineSubtasks.id, pre.id));

  await recordAudit({
    orgId: input.orgId,
    actorType: input.actorType ?? "user",
    actorId: input.actorId ?? null,
    action: "subtask.deleted",
    targetType: "deadline_subtask",
    targetId: pre.id,
    payload: {
      deadlineInstanceId: pre.deadlineInstanceId,
      label: pre.label,
      dueDate: pre.dueDate,
    },
  });
}

// ---------------------------------------------------------------------------
// Reorder (drag-to-reorder support — UI may not ship in v1, service is ready)
// ---------------------------------------------------------------------------

export async function reorderSubtasks(input: {
  deadlineInstanceId: string;
  orgId: string;
  orderedIds: string[];
}): Promise<void> {
  const { deadlineInstanceId, orgId, orderedIds } = input;
  if (orderedIds.length === 0) return;
  const db = getDb();

  // Validate every id belongs to this deadline + org. One round-trip.
  const owned = await db
    .select({ id: deadlineSubtasks.id })
    .from(deadlineSubtasks)
    .where(
      and(
        eq(deadlineSubtasks.deadlineInstanceId, deadlineInstanceId),
        eq(deadlineSubtasks.orgId, orgId),
        inArray(deadlineSubtasks.id, orderedIds),
      ),
    );
  if (owned.length !== orderedIds.length) {
    throw new Error("Reorder includes ids outside this deadline / org");
  }

  // Bulk-set sort_order with a single CASE expression so we don't issue
  // N UPDATEs. CASE returns the new ordinal based on the id's index in
  // `orderedIds`. PostgreSQL evaluates this against the matched rows
  // selected by WHERE id = ANY(...).
  const cases = orderedIds
    .map((id, i) => sql`WHEN ${deadlineSubtasks.id} = ${id} THEN ${i}`)
    .reduce((acc, frag) => sql`${acc} ${frag}`, sql``);

  await db
    .update(deadlineSubtasks)
    .set({
      sortOrder: sql`CASE ${cases} END`,
      updatedAt: new Date(),
    })
    .where(inArray(deadlineSubtasks.id, orderedIds));
}

// ---------------------------------------------------------------------------
// Shift after extension
//
// Called from the extension flow when the parent deadline's due date
// moves. Behavior matches the design decision recorded in
// ui-samples/m-subtimeline-variants.html: only OPEN stages with
// dueDate >= the original deadline are shifted; already-completed
// stages and stages dated before the original deadline don't move.
// Returns the count of shifted stages so the UI can show "Shifted N
// stages by +4 months" in the toast.
// ---------------------------------------------------------------------------

/**
 * Count open stages that WOULD be shifted by an extension. Lets the
 * extension dialog ask "you have N stages still pending — shift them?"
 * before actually moving anything. Same predicate as shiftSubtasks
 * below so the count and the eventual UPDATE agree.
 */
export async function countShiftableSubtasks(input: {
  deadlineInstanceId: string;
  orgId: string;
  originalDueDate: string;
}): Promise<number> {
  if (!ISO_DATE.test(input.originalDueDate)) return 0;
  const db = getDb();
  const [row] = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(deadlineSubtasks)
    .where(
      and(
        eq(deadlineSubtasks.deadlineInstanceId, input.deadlineInstanceId),
        eq(deadlineSubtasks.orgId, input.orgId),
        isNull(deadlineSubtasks.completedAt),
        gte(deadlineSubtasks.dueDate, input.originalDueDate),
      ),
    );
  return Number(row?.c ?? 0);
}

export const ShiftSubtasksInputSchema = z.object({
  deadlineInstanceId: z.string(),
  orgId: z.string(),
  /** The deadline's due date BEFORE the extension was filed (YYYY-MM-DD). */
  originalDueDate: z.string().regex(ISO_DATE),
  /** The deadline's NEW due date after the extension (YYYY-MM-DD). */
  newDueDate: z.string().regex(ISO_DATE),
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
});
export type ShiftSubtasksInput = z.input<typeof ShiftSubtasksInputSchema>;

export async function shiftSubtasksAfterExtension(
  input: ShiftSubtasksInput,
): Promise<number> {
  const parsed = ShiftSubtasksInputSchema.parse(input);
  await loadParentOrThrow(parsed.deadlineInstanceId, parsed.orgId);

  const db = getDb();

  // Compute the day delta. Date math in JS is brittle; for "+4 months"
  // we need to preserve calendar-month semantics not raw day arithmetic
  // (Apr 15 → Aug 15, not Apr 15 + 122 days). PostgreSQL's age() and
  // interval math handle this naturally, so we let the DB compute the
  // shift inline rather than serializing per-row in app code.
  //
  // Formula: new_subtask_date = subtask.due_date + (newDueDate - originalDueDate)
  // expressed as: original_date + AGE(newDueDate, originalDueDate)
  const shifted = await db
    .update(deadlineSubtasks)
    .set({
      dueDate: sql`(${deadlineSubtasks.dueDate}::date + AGE(${parsed.newDueDate}::date, ${parsed.originalDueDate}::date))::date`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(deadlineSubtasks.deadlineInstanceId, parsed.deadlineInstanceId),
        eq(deadlineSubtasks.orgId, parsed.orgId),
        isNull(deadlineSubtasks.completedAt),
        gte(deadlineSubtasks.dueDate, parsed.originalDueDate),
      ),
    )
    .returning({ id: deadlineSubtasks.id });

  if (shifted.length > 0) {
    await recordAudit({
      orgId: parsed.orgId,
      actorType: parsed.actorType,
      actorId: parsed.actorId,
      action: "subtask.shifted",
      targetType: "deadline_instance",
      targetId: parsed.deadlineInstanceId,
      payload: {
        originalDueDate: parsed.originalDueDate,
        newDueDate: parsed.newDueDate,
        shiftedCount: shifted.length,
      },
    });
  }

  return shifted.length;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function loadParentOrThrow(
  deadlineInstanceId: string,
  orgId: string,
): Promise<{ id: string; dueDate: string; ownerUserId: string | null }> {
  const db = getDb();
  const [row] = await db
    .select({
      id: deadlineInstances.id,
      dueDate: deadlineInstances.dueDate,
      ownerUserId: deadlineInstances.ownerUserId,
    })
    .from(deadlineInstances)
    .where(
      and(
        eq(deadlineInstances.id, deadlineInstanceId),
        eq(deadlineInstances.orgId, orgId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error(`Deadline ${deadlineInstanceId} not found in org ${orgId}`);
  }
  return row;
}

async function loadSubtaskOrThrow(
  subtaskId: string,
  orgId: string,
): Promise<typeof deadlineSubtasks.$inferSelect> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(deadlineSubtasks)
    .where(
      and(
        eq(deadlineSubtasks.id, subtaskId),
        eq(deadlineSubtasks.orgId, orgId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error(`Subtask ${subtaskId} not found in org ${orgId}`);
  }
  return row;
}

async function assertOrgMember(orgId: string, userId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);
  if (!row) {
    throw new Error(`User ${userId} is not a member of org ${orgId}`);
  }
}

function toDomain(row: typeof deadlineSubtasks.$inferSelect): DeadlineSubtask {
  return {
    id: row.id,
    deadlineInstanceId: row.deadlineInstanceId,
    orgId: row.orgId,
    label: row.label,
    dueDate: row.dueDate,
    sortOrder: row.sortOrder,
    ownerUserId: row.ownerUserId,
    completedAt: row.completedAt,
    completedByUserId: row.completedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function diff(
  pre: typeof deadlineSubtasks.$inferSelect,
  post: typeof deadlineSubtasks.$inferSelect,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  if (pre.label !== post.label) {
    out.label = { from: pre.label, to: post.label };
  }
  if (pre.dueDate !== post.dueDate) {
    out.dueDate = { from: pre.dueDate, to: post.dueDate };
  }
  if (pre.ownerUserId !== post.ownerUserId) {
    out.ownerUserId = { from: pre.ownerUserId, to: post.ownerUserId };
  }
  return out;
}

// `gt` is unused for now but kept so future "list overdue stages"
// queries don't have to re-import.
void gt;
