"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentContext } from "@/lib/auth/current-org";
import { getDb } from "@/lib/db";
import { entities } from "@/lib/db/schema";
import { generateDeadlinesForEntity } from "@/lib/services/deadline-engine";
import {
  electEntity,
  revokeElection,
  listElectionsForEntity,
  ElectionKindSchema,
} from "@/lib/services/entity-elections";

const ToggleElectionSchema = z.object({
  entityId: z.string().min(1),
  clientId: z.string().min(1),
  jurisdictionCode: z.string().regex(/^[A-Z]{2}$/),
  kind: ElectionKindSchema,
});

/**
 * Toggle a tax election for an entity in a given jurisdiction. Reads
 * current state, flips it, then regenerates deadlines for the current
 * and prior tax year so newly-gated rules materialize (or stop
 * materializing) immediately.
 *
 * Idempotent on re-clicks of the same direction — electEntity uses
 * INSERT ... ON CONFLICT DO NOTHING; revokeElection uses DELETE which
 * is also no-op on missing rows.
 */
export async function togglePteElectionAction(input: {
  entityId: string;
  clientId: string;
  jurisdictionCode: string;
  kind: "pte";
}): Promise<{ elected: boolean }> {
  const parsed = ToggleElectionSchema.parse(input);
  const ctx = await getCurrentContext();

  // Verify the entity belongs to the user's org before touching it.
  // This is the cheapest authz gate — without it a user could toggle
  // elections for any entity by guessing IDs.
  const db = getDb();
  const [entity] = await db
    .select()
    .from(entities)
    .where(eq(entities.id, parsed.entityId))
    .limit(1);
  if (!entity || entity.orgId !== ctx.organization.id) {
    throw new Error("Entity not found");
  }

  // Read current state to decide direction.
  const current = await listElectionsForEntity(parsed.entityId);
  const isElected = current.some(
    (e) =>
      e.jurisdictionCode === parsed.jurisdictionCode &&
      e.kind === parsed.kind,
  );

  if (isElected) {
    await revokeElection({
      orgId: ctx.organization.id,
      entityId: parsed.entityId,
      jurisdictionCode: parsed.jurisdictionCode,
      kind: parsed.kind,
    });
  } else {
    await electEntity({
      orgId: ctx.organization.id,
      entityId: parsed.entityId,
      jurisdictionCode: parsed.jurisdictionCode,
      kind: parsed.kind,
    });
  }

  // Regenerate deadlines so the gated rules materialize (or stop
  // materializing) for the current and prior tax year. Existing
  // instances aren't deleted on revoke — the engine just stops
  // emitting new ones, and the CPA can archive lingering instances
  // manually if they want them gone.
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  for (const taxYear of [currentYear - 1, currentYear]) {
    await generateDeadlinesForEntity(
      {
        orgId: ctx.organization.id,
        entityId: parsed.entityId,
        taxYear,
        actorType: "user",
        actorId: ctx.user.id,
        includeHistoricalAsCompleted: false,
      },
      entity,
    );
  }

  revalidatePath(`/clients/${parsed.clientId}`);
  revalidatePath("/dashboard");

  return { elected: !isElected };
}
