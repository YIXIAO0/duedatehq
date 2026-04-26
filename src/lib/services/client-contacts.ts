/**
 * Client contacts service — multi-contact support for clients.
 *
 * Design tenets:
 *   - priority=0 is "the primary" by convention. Promoting a new primary
 *     demotes the previous one.
 *   - We mirror the primary's email/phone back to clients.primary_contact_*
 *     so the existing search/CSV/dashboard queries (which still read
 *     those columns) stay correct without rewrite.
 *   - "At least one of email or phone" is enforced here, not in the DB,
 *     so future channels (Slack, etc.) don't need a schema migration.
 */

import "server-only";
import { z } from "zod";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  clientContacts,
  clients,
  type ClientContact,
} from "@/lib/db/schema";
import { recordAudit } from "./audit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ContactCoreFields = z.object({
  name: z.string().max(120).optional().nullable(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  phone: z.string().max(50).optional().nullable(),
  role: z.string().max(60).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  receivesReminders: z.boolean().default(true),
});

export const CreateContactInputSchema = ContactCoreFields.extend({
  orgId: z.string(),
  clientId: z.string(),
  /** Auto = bottom of the list. Pass 0 to mark this contact as primary. */
  priority: z.number().int().min(0).max(999).optional(),
  actorId: z.string().nullable().default(null),
}).superRefine((v, ctx) => {
  // At least one channel required so we never create a useless row.
  if (!v.email?.trim() && !v.phone?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one of email or phone is required.",
      path: ["email"],
    });
  }
});
export type CreateContactInput = z.input<typeof CreateContactInputSchema>;

export const UpdateContactInputSchema = ContactCoreFields.extend({
  id: z.string(),
  orgId: z.string(),
  actorId: z.string().nullable().default(null),
}).superRefine((v, ctx) => {
  if (!v.email?.trim() && !v.phone?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one of email or phone is required.",
      path: ["email"],
    });
  }
});
export type UpdateContactInput = z.input<typeof UpdateContactInputSchema>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listContactsForClient(args: {
  orgId: string;
  clientId: string;
}): Promise<ClientContact[]> {
  const db = getDb();
  return db
    .select()
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.orgId, args.orgId),
        eq(clientContacts.clientId, args.clientId),
        isNull(clientContacts.archivedAt),
      ),
    )
    .orderBy(asc(clientContacts.priority), asc(clientContacts.createdAt));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createContact(input: CreateContactInput) {
  const parsed = CreateContactInputSchema.parse(input);
  const db = getDb();

  // If priority is unset, append at the end. If priority=0 explicitly,
  // demote the current primary first.
  let priority = parsed.priority;
  if (priority === undefined) {
    const tail = await db
      .select({ p: clientContacts.priority })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.clientId, parsed.clientId),
          isNull(clientContacts.archivedAt),
        ),
      )
      .orderBy(desc(clientContacts.priority))
      .limit(1);
    priority = (tail[0]?.p ?? 0) + 1;
  }

  if (priority === 0) {
    await demoteCurrentPrimary(parsed.clientId);
  }

  const [row] = await db
    .insert(clientContacts)
    .values({
      orgId: parsed.orgId,
      clientId: parsed.clientId,
      name: parsed.name?.trim() || null,
      email: parsed.email?.trim() || null,
      phone: parsed.phone?.trim() || null,
      role: parsed.role?.trim() || null,
      notes: parsed.notes?.trim() || null,
      priority,
      receivesReminders: parsed.receivesReminders,
    })
    .returning();

  if (priority === 0) await syncPrimaryToClientRow(parsed.clientId);

  await recordAudit({
    orgId: parsed.orgId,
    actorType: "user",
    actorId: parsed.actorId,
    action: "client_contact.created",
    targetType: "client_contact",
    targetId: row.id,
    payload: {
      clientId: parsed.clientId,
      name: row.name,
      role: row.role,
      isPrimary: row.priority === 0,
    },
  });

  return row;
}

export async function updateContact(input: UpdateContactInput) {
  const parsed = UpdateContactInputSchema.parse(input);
  const db = getDb();

  const [pre] = await db
    .select()
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.id, parsed.id),
        eq(clientContacts.orgId, parsed.orgId),
      ),
    )
    .limit(1);
  if (!pre) throw new Error("Contact not found");

  const [row] = await db
    .update(clientContacts)
    .set({
      name: parsed.name?.trim() || null,
      email: parsed.email?.trim() || null,
      phone: parsed.phone?.trim() || null,
      role: parsed.role?.trim() || null,
      notes: parsed.notes?.trim() || null,
      receivesReminders: parsed.receivesReminders,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clientContacts.id, parsed.id),
        eq(clientContacts.orgId, parsed.orgId),
      ),
    )
    .returning();

  // Mirror to clients row if this is the primary.
  if (row.priority === 0) await syncPrimaryToClientRow(row.clientId);

  await recordAudit({
    orgId: parsed.orgId,
    actorType: "user",
    actorId: parsed.actorId,
    action: "client_contact.updated",
    targetType: "client_contact",
    targetId: row.id,
    payload: { clientId: row.clientId },
  });

  return row;
}

export async function archiveContact(args: {
  id: string;
  orgId: string;
  actorId: string | null;
}) {
  const db = getDb();
  const [pre] = await db
    .select()
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.id, args.id),
        eq(clientContacts.orgId, args.orgId),
      ),
    )
    .limit(1);
  if (!pre) throw new Error("Contact not found");

  await db
    .update(clientContacts)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(clientContacts.id, args.id),
        eq(clientContacts.orgId, args.orgId),
      ),
    );

  // If we just archived the primary, find the next-priority active
  // contact and promote it to keep clients.primary_contact_* in sync.
  if (pre.priority === 0) {
    const [next] = await db
      .select()
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.clientId, pre.clientId),
          isNull(clientContacts.archivedAt),
        ),
      )
      .orderBy(asc(clientContacts.priority), asc(clientContacts.createdAt))
      .limit(1);
    if (next) {
      await db
        .update(clientContacts)
        .set({ priority: 0, updatedAt: new Date() })
        .where(eq(clientContacts.id, next.id));
    }
    await syncPrimaryToClientRow(pre.clientId);
  }

  await recordAudit({
    orgId: args.orgId,
    actorType: "user",
    actorId: args.actorId,
    action: "client_contact.archived",
    targetType: "client_contact",
    targetId: args.id,
    payload: { clientId: pre.clientId, wasPrimary: pre.priority === 0 },
  });
}

export async function setContactAsPrimary(args: {
  id: string;
  orgId: string;
  actorId: string | null;
}) {
  const db = getDb();
  const [target] = await db
    .select()
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.id, args.id),
        eq(clientContacts.orgId, args.orgId),
      ),
    )
    .limit(1);
  if (!target) throw new Error("Contact not found");
  if (target.priority === 0) return; // no-op

  await demoteCurrentPrimary(target.clientId);
  await db
    .update(clientContacts)
    .set({ priority: 0, updatedAt: new Date() })
    .where(eq(clientContacts.id, target.id));

  await syncPrimaryToClientRow(target.clientId);

  await recordAudit({
    orgId: args.orgId,
    actorType: "user",
    actorId: args.actorId,
    action: "client_contact.set_primary",
    targetType: "client_contact",
    targetId: target.id,
    payload: { clientId: target.clientId },
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Move whatever's currently priority=0 for this client out of the way. */
async function demoteCurrentPrimary(clientId: string) {
  const db = getDb();
  await db
    .update(clientContacts)
    .set({ priority: 1, updatedAt: new Date() })
    .where(
      and(
        eq(clientContacts.clientId, clientId),
        eq(clientContacts.priority, 0),
        isNull(clientContacts.archivedAt),
      ),
    );
}

/** Reflect the priority=0 contact into clients.primary_contact_* so the
 *  existing dashboard / CSV / search queries stay correct. */
async function syncPrimaryToClientRow(clientId: string) {
  const db = getDb();
  const [primary] = await db
    .select()
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.clientId, clientId),
        eq(clientContacts.priority, 0),
        isNull(clientContacts.archivedAt),
      ),
    )
    .limit(1);

  await db
    .update(clients)
    .set({
      primaryContactEmail: primary?.email ?? null,
      primaryContactPhone: primary?.phone ?? null,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, clientId));
}
