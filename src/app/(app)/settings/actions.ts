"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getCurrentContext } from "@/lib/auth/current-org";
import { getDb } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { recordAudit } from "@/lib/services/audit";
import {
  generateAndSendWeeklyDigest,
  type GenerateDigestResult,
} from "@/lib/services/digest";
import {
  rotateIcalToken,
  revokeIcalToken,
} from "@/lib/services/ical-tokens";

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

// ---------------------------------------------------------------------------
// Manual "send me this week's digest now"
//
// Pilot users want to see what the email looks like before Monday hits.
// This skips the (user, week) idempotency guard via `force: true` so the
// CPA can preview repeatedly. Since the action runs as the logged-in user,
// it always sends to *their* email — no risk of spamming arbitrary
// recipients.
// ---------------------------------------------------------------------------
export async function sendDigestPreviewAction(): Promise<GenerateDigestResult> {
  const ctx = await getCurrentContext();
  return generateAndSendWeeklyDigest({
    orgId: ctx.organization.id,
    userId: ctx.user.id,
    recipientEmail: ctx.email,
    recipientName: ctx.user.fullName,
    orgName: ctx.organization.name,
    force: true,
  });
}

// ---------------------------------------------------------------------------
// iCal subscription management
//
// Three actions: enable (first-time), rotate (replace existing), and
// revoke. Both enable and rotate go through `rotateIcalToken` since the
// flow is identical — write a fresh token. The UI presents them as
// separate buttons because the user-facing intent differs ("turn this
// on" vs "I lost the URL, give me a new one").
// ---------------------------------------------------------------------------

export async function rotateIcalTokenAction(): Promise<{ token: string }> {
  const ctx = await getCurrentContext();
  const token = await rotateIcalToken({
    userId: ctx.user.id,
    orgId: ctx.organization.id,
  });
  revalidatePath("/settings");
  return { token };
}

export async function revokeIcalTokenAction(): Promise<void> {
  const ctx = await getCurrentContext();
  await revokeIcalToken({
    userId: ctx.user.id,
    orgId: ctx.organization.id,
  });
  revalidatePath("/settings");
}
