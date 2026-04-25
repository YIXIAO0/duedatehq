"use server";

import { revalidatePath } from "next/cache";
import { getCurrentContext } from "@/lib/auth/current-org";
import {
  ackClientForAnnouncement,
  dismissAnnouncement,
  unackClientForAnnouncement,
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

// Per-client review checkbox on /announcements/[id]. Toggle-style:
// pass `acked` to indicate the desired post-state. Idempotent.
export async function setClientReviewedAction(args: {
  announcementId: string;
  clientId: string;
  acked: boolean;
}) {
  const ctx = await getCurrentContext();
  if (args.acked) {
    await ackClientForAnnouncement({
      userId: ctx.user.id,
      announcementId: args.announcementId,
      clientId: args.clientId,
    });
  } else {
    await unackClientForAnnouncement({
      userId: ctx.user.id,
      announcementId: args.announcementId,
      clientId: args.clientId,
    });
  }
  revalidatePath(`/announcements/${args.announcementId}`);
  revalidatePath("/dashboard");
}
