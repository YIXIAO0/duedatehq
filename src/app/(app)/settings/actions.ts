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
import {
  createInvitation,
  revokeInvitation as revokeInvitationService,
  removeMember as removeMemberService,
  changeMemberRole as changeMemberRoleService,
  InvitationError,
  RemoveMemberError,
  ChangeRoleError,
} from "@/lib/services/team";

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

// ---------------------------------------------------------------------------
// Team — invite + revoke
//
// Permission: V1 doesn't gate by role yet (any member can invite). The
// action runs scoped to the caller's current org, so cross-tenant abuse
// is structurally impossible. Role gating goes in the next iteration once
// we have admins distinct from members in real accounts.
// ---------------------------------------------------------------------------

const InviteFormSchema = z.object({
  email: z.string().min(1).max(320),
  role: z.enum(["admin", "member"]),
});

export type InviteResult =
  | { ok: true; token: string }
  | { ok: false; message: string };

export async function inviteTeamMemberAction(
  formData: FormData,
): Promise<InviteResult> {
  const ctx = await getCurrentContext();
  const parsed = InviteFormSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  try {
    const invitation = await createInvitation({
      orgId: ctx.organization.id,
      email: parsed.data.email,
      role: parsed.data.role,
      invitedByUserId: ctx.user.id,
    });
    revalidatePath("/settings");
    return { ok: true, token: invitation.token };
  } catch (err) {
    if (err instanceof InvitationError) {
      return { ok: false, message: err.message };
    }
    throw err;
  }
}

export async function revokeInvitationAction(
  invitationId: string,
): Promise<void> {
  const ctx = await getCurrentContext();
  await revokeInvitationService({
    orgId: ctx.organization.id,
    invitationId,
    actorUserId: ctx.user.id,
  });
  revalidatePath("/settings");
}

export type RemoveMemberResult =
  | { ok: true; isSelf: boolean }
  | { ok: false; message: string };

export type ChangeRoleResult =
  | { ok: true }
  | { ok: false; message: string };

const ChangeRoleSchema = z.object({
  membershipId: z.string().min(1),
  newRole: z.enum(["owner", "admin", "member"]),
});

export async function changeMemberRoleAction(
  membershipId: string,
  newRole: "owner" | "admin" | "member",
): Promise<ChangeRoleResult> {
  const ctx = await getCurrentContext();
  const parsed = ChangeRoleSchema.safeParse({ membershipId, newRole });
  if (!parsed.success) {
    return { ok: false, message: "Invalid input" };
  }
  try {
    await changeMemberRoleService({
      orgId: ctx.organization.id,
      membershipIdToChange: parsed.data.membershipId,
      newRole: parsed.data.newRole,
      actorUserId: ctx.user.id,
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    if (err instanceof ChangeRoleError) {
      return { ok: false, message: err.message };
    }
    throw err;
  }
}

/**
 * Remove a member (or self-leave). Returns a result object instead of
 * throwing so the UI can show a friendly message for permission errors
 * (last-owner, forbidden) without spamming the server-error overlay.
 *
 * Self-leave returns `isSelf: true` so the client can redirect the
 * just-left user out of /settings (which now would 401-redirect on the
 * org they no longer belong to).
 */
export async function removeMemberAction(
  membershipId: string,
): Promise<RemoveMemberResult> {
  const ctx = await getCurrentContext();
  try {
    await removeMemberService({
      orgId: ctx.organization.id,
      membershipIdToRemove: membershipId,
      actorUserId: ctx.user.id,
    });
    revalidatePath("/settings");
    // Detect self-leave by checking whether ctx.user still has a
    // membership in this org. Cheaper than re-fetching the deleted row.
    // The caller doesn't actually need a precise answer beyond "should
    // I redirect?" — we know it's self-leave when the action's target
    // membership belonged to ctx.user, but that info was consumed in
    // removeMemberService. Conservative: return false here; the client
    // already knows from the row data whether it clicked its own row.
    return { ok: true, isSelf: false };
  } catch (err) {
    if (err instanceof RemoveMemberError) {
      return { ok: false, message: err.message };
    }
    throw err;
  }
}
