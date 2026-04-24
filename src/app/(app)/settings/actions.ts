"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getCurrentContext } from "@/lib/auth/current-org";
import { getDb } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { recordAudit } from "@/lib/services/audit";

const UpdateOrgFormSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
});

export async function updateOrgAction(formData: FormData) {
  const ctx = await getCurrentContext();
  const parsed = UpdateOrgFormSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  // Defense: only update the user's own org (proxy.ts already auth-gates,
  // but this stops a manually-tampered orgId).
  if (parsed.data.id !== ctx.organization.id) {
    throw new Error("Forbidden");
  }

  const db = getDb();
  const [row] = await db
    .update(organizations)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(eq(organizations.id, parsed.data.id))
    .returning();

  if (!row) throw new Error("Organization not found");

  await recordAudit({
    orgId: row.id,
    actorType: "user",
    actorId: ctx.user.id,
    action: "organization.renamed",
    targetType: "organization",
    targetId: row.id,
    payload: { newName: parsed.data.name },
  });

  revalidatePath("/settings");
}
