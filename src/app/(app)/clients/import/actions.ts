"use server";

import { revalidatePath } from "next/cache";
import { getCurrentContext } from "@/lib/auth/current-org";
import { createClient } from "@/lib/services/clients";
import { createEntity } from "@/lib/services/entities";
import {
  ApplyImportInputSchema,
  type ApplyImportResult,
  type ApplyImportInput,
} from "@/lib/import/types";
import { recordAudit } from "@/lib/services/audit";

/**
 * Apply a batch of imported rows. Each row becomes 1 client + 1 entity.
 * Deadline generation is triggered automatically by createEntity().
 *
 * Non-transactional: if any row fails we skip it and continue. The result
 * summarizes what landed. This matches CPA expectations — they'd rather
 * import 80/82 than have all 82 roll back because of 2 bad rows.
 */
export async function applyImportAction(
  input: ApplyImportInput,
): Promise<ApplyImportResult> {
  const ctx = await getCurrentContext();
  const parsed = ApplyImportInputSchema.parse(input);

  const result: ApplyImportResult = {
    clientsCreated: 0,
    entitiesCreated: 0,
    deadlinesGenerated: 0,
    rowsSkipped: 0,
    errors: [],
  };

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    try {
      // 1. Create client (one per row for MVP — user can merge later)
      const client = await createClient({
        orgId: ctx.organization.id,
        name: row.clientName,
        primaryContactEmail: row.contactEmail,
        primaryContactPhone: row.contactPhone,
        notes: row.notes,
        actorType: "user",
        actorId: ctx.user.id,
      });
      result.clientsCreated += 1;

      // 2. Create entity + auto-generate deadlines
      const entityResult = await createEntity({
        orgId: ctx.organization.id,
        clientId: client.id,
        name: row.entityName ?? row.clientName,
        entityType: row.entityType,
        homeState: row.homeState,
        operatingStates: row.operatingStates ?? [],
        ein: row.ein,
        actorType: "user",
        actorId: ctx.user.id,
      });
      result.entitiesCreated += 1;
      result.deadlinesGenerated += entityResult.deadlinesCreated;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.rowsSkipped += 1;
      result.errors.push({ rowIndex: i, message });
    }
  }

  await recordAudit({
    orgId: ctx.organization.id,
    actorType: "user",
    actorId: ctx.user.id,
    action: "bulk_import.applied",
    targetType: "organization",
    targetId: ctx.organization.id,
    payload: {
      totalRows: parsed.rows.length,
      ...result,
    },
  });

  revalidatePath("/clients");
  revalidatePath("/dashboard");

  return result;
}
