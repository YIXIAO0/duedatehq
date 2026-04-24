/**
 * Client service — CRUD operations for CPA clients (a client = the CPA's customer).
 *
 * All inputs/outputs use Zod schemas so agent tool-calls can reuse them.
 * Follows the "no direct DB from UI" rule: UI and MCP both call these fns.
 */

import "server-only";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { clients } from "@/lib/db/schema";
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
export type CreateClientInput = z.infer<typeof CreateClientInputSchema>;

export const ListClientsInputSchema = z.object({
  orgId: z.string(),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().positive().max(500).default(100),
  offset: z.number().int().nonnegative().default(0),
});
export type ListClientsInput = z.infer<typeof ListClientsInputSchema>;

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
