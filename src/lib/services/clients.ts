/**
 * Client service — CRUD operations for CPA clients (a client = the CPA's customer).
 *
 * All inputs/outputs use Zod schemas so agent tool-calls can reuse them.
 * Follows the "no direct DB from UI" rule: UI and MCP both call these fns.
 */

import "server-only";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { clients, entities } from "@/lib/db/schema";
import { recordAudit } from "./audit";

// ---------------------------------------------------------------------------
// Zod schemas (exported for MCP tool-call reuse)
// ---------------------------------------------------------------------------

export const CreateClientInputSchema = z.object({
  orgId: z.string(),
  name: z.string().min(1).max(200),
  primaryContactEmail: z.string().email().optional(),
  primaryContactPhone: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
});
export type CreateClientInput = z.input<typeof CreateClientInputSchema>;

export const ListClientsInputSchema = z.object({
  orgId: z.string(),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().positive().max(500).default(100),
  offset: z.number().int().nonnegative().default(0),
});
export type ListClientsInput = z.input<typeof ListClientsInputSchema>;

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function createClient(input: CreateClientInput) {
  const parsed = CreateClientInputSchema.parse(input);
  const db = getDb();

  const [row] = await db
    .insert(clients)
    .values({
      orgId: parsed.orgId,
      name: parsed.name,
      primaryContactEmail: parsed.primaryContactEmail,
      primaryContactPhone: parsed.primaryContactPhone,
      notes: parsed.notes,
    })
    .returning();

  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "client.created",
    targetType: "client",
    targetId: row.id,
    payload: { name: parsed.name },
  });

  return row;
}

// ---------------------------------------------------------------------------
// Update / Archive
// ---------------------------------------------------------------------------

export const UpdateClientInputSchema = z.object({
  id: z.string().min(1),
  orgId: z.string(),
  name: z.string().min(1).max(200),
  primaryContactEmail: z.string().email().optional().or(z.literal("")),
  primaryContactPhone: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
});
export type UpdateClientInput = z.input<typeof UpdateClientInputSchema>;

export async function updateClient(input: UpdateClientInput) {
  const parsed = UpdateClientInputSchema.parse(input);
  const db = getDb();

  const [row] = await db
    .update(clients)
    .set({
      name: parsed.name,
      primaryContactEmail: parsed.primaryContactEmail || null,
      primaryContactPhone: parsed.primaryContactPhone || null,
      notes: parsed.notes || null,
      updatedAt: new Date(),
    })
    .where(and(eq(clients.id, parsed.id), eq(clients.orgId, parsed.orgId)))
    .returning();

  if (!row) throw new Error(`Client ${parsed.id} not found`);

  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "client.updated",
    targetType: "client",
    targetId: row.id,
    payload: { name: parsed.name },
  });

  return row;
}

export const ArchiveClientInputSchema = z.object({
  id: z.string().min(1),
  orgId: z.string(),
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
});
export type ArchiveClientInput = z.input<typeof ArchiveClientInputSchema>;

export async function archiveClient(input: ArchiveClientInput) {
  const parsed = ArchiveClientInputSchema.parse(input);
  const db = getDb();

  const [row] = await db
    .update(clients)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(clients.id, parsed.id), eq(clients.orgId, parsed.orgId)))
    .returning();

  if (!row) throw new Error(`Client ${parsed.id} not found`);

  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "client.archived",
    targetType: "client",
    targetId: row.id,
  });

  return row;
}

export async function listClients(input: ListClientsInput) {
  const parsed = ListClientsInputSchema.parse(input);
  const db = getDb();

  const whereClause = parsed.includeArchived
    ? eq(clients.orgId, parsed.orgId)
    : and(eq(clients.orgId, parsed.orgId), isNull(clients.archivedAt));

  return db
    .select()
    .from(clients)
    .where(whereClause)
    .orderBy(desc(clients.createdAt))
    .limit(parsed.limit)
    .offset(parsed.offset);
}

// ---------------------------------------------------------------------------
// Merge clients
//
// Imports often come in as 1-row-per-entity — a CPA's book has "Sarah Johnson"
// (individual 1040) and "Sarah Johnson LLC" (1065 partnership) as separate
// rows, but they're really ONE client with TWO entities. Merging lets the
// user consolidate them after the fact.
//
// Mechanics:
//   1. Reassign all entities from `mergeIds` → `primaryId`  (UPDATE)
//   2. Delete the merged client rows (DELETE)
//
// Order matters: entities.client_id references clients.id with ON DELETE
// CASCADE, so we MUST reassign entities FIRST. If we deleted clients first,
// all their entities would be cascade-deleted too. Neon HTTP driver doesn't
// support interactive transactions, so we run sequentially and accept that
// a failure between step 1 and step 2 leaves "empty-shell" merged clients
// the user can manually archive. No data loss, worst-case cosmetic.
//
// Deadline instances reference entity_id (not client_id), so deadlines
// automatically follow their entity to the primary client — nothing to fix
// up there.
// ---------------------------------------------------------------------------

export const MergeClientsInputSchema = z.object({
  orgId: z.string(),
  /** Client that stays — its name, email, notes win. */
  primaryId: z.string().min(1),
  /** Clients whose entities move into `primaryId`, then get deleted. */
  mergeIds: z.array(z.string().min(1)).min(1).max(20),
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
});
export type MergeClientsInput = z.input<typeof MergeClientsInputSchema>;

export type MergeClientsResult = {
  primaryId: string;
  primaryName: string;
  entitiesMoved: number;
  clientsDeleted: number;
  deletedClientNames: string[];
};

export async function mergeClients(
  input: MergeClientsInput,
): Promise<MergeClientsResult> {
  const parsed = MergeClientsInputSchema.parse(input);
  const db = getDb();

  if (parsed.mergeIds.includes(parsed.primaryId)) {
    throw new Error("Primary client cannot also be in the merge list.");
  }
  const uniqueMergeIds = Array.from(new Set(parsed.mergeIds));
  if (uniqueMergeIds.length !== parsed.mergeIds.length) {
    throw new Error("Duplicate clients in merge list.");
  }

  // 1. Fetch every client by id within the org — ensures scoping and rejects
  //    cross-tenant IDs even if a client crafts a malicious form submission.
  const allIds = [parsed.primaryId, ...uniqueMergeIds];
  const foundClients = await db
    .select()
    .from(clients)
    .where(and(eq(clients.orgId, parsed.orgId), inArray(clients.id, allIds)));

  if (foundClients.length !== allIds.length) {
    throw new Error(
      "One or more selected clients were not found in your organization.",
    );
  }

  const primary = foundClients.find((c) => c.id === parsed.primaryId);
  if (!primary) {
    throw new Error(`Primary client ${parsed.primaryId} not found.`);
  }
  const toMerge = foundClients.filter((c) => c.id !== parsed.primaryId);
  const deletedClientNames = toMerge.map((c) => c.name);

  // 2. Count (and capture) entities on the merged clients — needed for audit
  //    payload and for the return value. We fetch the minimum fields to keep
  //    payload small.
  const entityRows = await db
    .select({
      id: entities.id,
      name: entities.name,
      entityType: entities.entityType,
      clientId: entities.clientId,
    })
    .from(entities)
    .where(
      and(
        eq(entities.orgId, parsed.orgId),
        inArray(entities.clientId, uniqueMergeIds),
      ),
    );

  // 3. Reassign entities FIRST (before we delete the old clients, otherwise
  //    the FK cascade would take the entities with them).
  if (entityRows.length > 0) {
    await db
      .update(entities)
      .set({ clientId: parsed.primaryId, updatedAt: new Date() })
      .where(
        and(
          eq(entities.orgId, parsed.orgId),
          inArray(entities.clientId, uniqueMergeIds),
        ),
      );
  }

  // 4. Delete the merged clients. Safe now — they have zero entities.
  const deletedRows = await db
    .delete(clients)
    .where(
      and(eq(clients.orgId, parsed.orgId), inArray(clients.id, uniqueMergeIds)),
    )
    .returning({ id: clients.id });

  // 5. Audit — one entry that captures the whole transformation. The payload
  //    is intentionally dense so we can reconstruct the merge from the log
  //    if a user regrets it.
  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "client.merged",
    targetType: "client",
    targetId: parsed.primaryId,
    payload: {
      primaryName: primary.name,
      mergedClients: toMerge.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.primaryContactEmail,
      })),
      movedEntities: entityRows.map((e) => ({
        id: e.id,
        name: e.name,
        entityType: e.entityType,
        fromClientId: e.clientId,
      })),
    },
  });

  return {
    primaryId: parsed.primaryId,
    primaryName: primary.name,
    entitiesMoved: entityRows.length,
    clientsDeleted: deletedRows.length,
    deletedClientNames,
  };
}

// ---------------------------------------------------------------------------
// Client list WITH per-client entity + active-deadline counts — used by the
// /clients page so the CPA can scan "who's structurally complex" (entities)
// vs "who has the most work left" (active deadlines) in one pass. Active =
// pending / in_progress / extended (the engine treats extended as still
// open work because the filing hasn't actually happened yet).
// ---------------------------------------------------------------------------

export type ClientWithEntityCount = {
  id: string;
  name: string;
  primaryContactEmail: string | null;
  createdAt: Date;
  entityCount: number;
  /** Open deadlines: pending + in_progress + extended (not completed/missed). */
  activeDeadlineCount: number;
  /**
   * Earliest effective due date among open deadlines (YYYY-MM-DD).
   * null when the client has no open work — used by the list UI to
   * decide between rendering the urgency block or a calm "all clear".
   */
  nextDueDate: string | null;
  /**
   * Open deadlines whose effective due date is within 3 days
   * (overdue / today / next 3 days). The threshold matches the
   * "urgent" tier used everywhere else in the UI.
   */
  urgentCount: number;
  /**
   * The first (oldest by created_at) entity's type / home_state. Used
   * as a quick visual marker on the row — for clients with multiple
   * entities the UI also shows a "+N more" pill so we don't pretend
   * one type/state covers a multi-entity client.
   */
  primaryEntityType: string | null;
  primaryHomeState: string | null;
};

export async function listClientsWithEntityCount(
  input: ListClientsInput,
): Promise<ClientWithEntityCount[]> {
  const parsed = ListClientsInputSchema.parse(input);
  const db = getDb();

  const archivedFilter = parsed.includeArchived
    ? sql``
    : sql`AND c.archived_at IS NULL`;

  // Scalar subqueries (not LEFT JOINs) for every metric — avoids the
  // Cartesian-product bug you'd get from joining clients × entities ×
  // deadline_instances and then needing COUNT(DISTINCT ...) gymnastics.
  // All subqueries hit existing indexes:
  //   - entity count / primary entity:  entities_client_idx
  //   - deadline counts / next due:     deadline_instances_org_status_idx
  //                                     + join via entities.client_id
  // At <100 clients the per-row subquery cost is negligible; if book
  // size grows we can switch to a single CTE with GROUP BY.
  const rows = await db.execute<{
    id: string;
    name: string;
    primary_contact_email: string | null;
    created_at: Date;
    entity_count: number;
    active_deadline_count: number;
    next_due_date: string | null;
    urgent_count: number;
    primary_entity_type: string | null;
    primary_home_state: string | null;
  }>(sql`
    SELECT c.id,
           c.name,
           c.primary_contact_email,
           c.created_at,
           (
             SELECT COUNT(*)::int
             FROM entities e
             WHERE e.client_id = c.id
               AND e.archived_at IS NULL
           ) AS entity_count,
           (
             -- True portfolio count — every unfiled, non-archived
             -- deadline for this client. No artificial future-horizon
             -- cap; matches File In Time / Canopy / Karbon convention
             -- where the "open" stat is a fact about the book, and
             -- time-windowed action views (dashboard "next 7d / 30d")
             -- live on separate UI surfaces.
             SELECT COUNT(*)::int
             FROM deadline_instances di
             INNER JOIN entities e2 ON e2.id = di.entity_id
             WHERE e2.client_id = c.id
               AND e2.archived_at IS NULL
               AND di.status IN ('pending', 'waiting_on_client', 'in_progress')
           ) AS active_deadline_count,
           (
             SELECT MIN(COALESCE(di.extension_due_date, di.due_date))::text
             FROM deadline_instances di
             INNER JOIN entities e3 ON e3.id = di.entity_id
             WHERE e3.client_id = c.id
               AND e3.archived_at IS NULL
               AND di.status IN ('pending', 'waiting_on_client', 'in_progress')
           ) AS next_due_date,
           (
             SELECT COUNT(*)::int
             FROM deadline_instances di
             INNER JOIN entities e4 ON e4.id = di.entity_id
             WHERE e4.client_id = c.id
               AND e4.archived_at IS NULL
               AND di.status IN ('pending', 'waiting_on_client', 'in_progress')
               AND COALESCE(di.extension_due_date, di.due_date) <= CURRENT_DATE + INTERVAL '3 days'
           ) AS urgent_count,
           (
             SELECT e5.entity_type
             FROM entities e5
             WHERE e5.client_id = c.id
               AND e5.archived_at IS NULL
             ORDER BY e5.created_at ASC
             LIMIT 1
           ) AS primary_entity_type,
           (
             SELECT e6.home_state
             FROM entities e6
             WHERE e6.client_id = c.id
               AND e6.archived_at IS NULL
             ORDER BY e6.created_at ASC
             LIMIT 1
           ) AS primary_home_state
    FROM clients c
    WHERE c.org_id = ${parsed.orgId}
      ${archivedFilter}
    ORDER BY c.created_at DESC
    LIMIT ${parsed.limit}
    OFFSET ${parsed.offset}
  `);

  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    primaryContactEmail: r.primary_contact_email,
    createdAt: new Date(r.created_at),
    entityCount: Number(r.entity_count),
    activeDeadlineCount: Number(r.active_deadline_count),
    nextDueDate: r.next_due_date,
    urgentCount: Number(r.urgent_count),
    primaryEntityType: r.primary_entity_type,
    primaryHomeState: r.primary_home_state,
  }));
}
