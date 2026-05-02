"use server";

/**
 * Server actions for the notifications bell (C-3).
 *
 * Two mutations:
 *   - markAllReadAction        → "Mark all read" button in popover footer
 *   - markNotificationReadAction → row click (close popover, navigate, fade row)
 *
 * Both are scoped to the current user/org via getCurrentContext, so an
 * attacker can't pass another user's notification id and have it marked
 * read on their behalf — the WHERE clause filters by both id AND userId.
 *
 * revalidatePath("/", "layout") refreshes the bell wherever it's rendered
 * (it lives in the app-shell layout, not on a single route).
 */

import { revalidatePath } from "next/cache";
import { getCurrentContext } from "@/lib/auth/current-org";
import {
  markAllReadForUser,
  markNotificationRead,
} from "@/lib/services/notifications";

export async function markAllReadAction(): Promise<{ updated: number }> {
  const ctx = await getCurrentContext();
  const updated = await markAllReadForUser(ctx.user.id, ctx.organization.id);
  revalidatePath("/", "layout");
  return { updated };
}

export async function markNotificationReadAction(
  notificationId: string,
): Promise<void> {
  const ctx = await getCurrentContext();
  await markNotificationRead(notificationId, ctx.user.id);
  revalidatePath("/", "layout");
}
