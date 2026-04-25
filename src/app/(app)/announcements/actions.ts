"use server";

import { revalidatePath } from "next/cache";
import { getCurrentContext } from "@/lib/auth/current-org";
import {
  dismissAnnouncement,
  undismissAnnouncement,
} from "@/lib/services/announcements";

/**
 * Server actions for the per-user dismiss UX.
 *
 * Both refresh the dashboard + announcements page so the X click feels
 * instant. They take no orgId parameter — dismiss is per-user, not
 * per-org. The user can only act on their own dismissals (we always
 * pass `ctx.user.id`, ignoring any client-supplied user id).
 */

export async function dismissAnnouncementAction(announcementId: string) {
  const ctx = await getCurrentContext();
  await dismissAnnouncement(ctx.user.id, announcementId);
  revalidatePath("/dashboard");
  revalidatePath("/announcements");
  // Layout's UpdatesNavLink badge also reads from getAnnouncementsSummary,
  // so revalidating the layout root keeps the header count in sync.
  revalidatePath("/", "layout");
}

export async function undismissAnnouncementAction(announcementId: string) {
  const ctx = await getCurrentContext();
  await undismissAnnouncement(ctx.user.id, announcementId);
  revalidatePath("/dashboard");
  revalidatePath("/announcements");
  revalidatePath("/", "layout");
}
