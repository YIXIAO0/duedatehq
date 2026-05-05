"use server";

import { revalidatePath } from "next/cache";
import { getCurrentContext } from "@/lib/auth/current-org";
import {
  ackClientForAnnouncement,
  dismissAnnouncement,
  unackClientForAnnouncement,
  undismissAnnouncement,
} from "@/lib/services/announcements";
import { fileExtension } from "@/lib/services/deadlines";
import { recordAudit } from "@/lib/services/audit";
import { getDb } from "@/lib/db";
import { announcements } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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

/**
 * One-click apply: file an extension on `deadlineId` to the
 * announcement's `reliefDeadline`. The audit_events row tags this as
 * `announcement.relief_applied` with the announcement id in payload,
 * which the review query reads back to display "Applied" state on
 * the deadline row. The underlying `fileExtension` already audit-logs
 * `deadline.extension_filed`, so the deadline timeline reads as
 * normal — we just add the announcement-specific marker on top.
 *
 * Skip path is `markReliefSkippedAction` — same audit shape but
 * without actually filing anything, so the row shows as "Skipped"
 * instead of pending.
 */
export async function applyAnnouncementReliefAction(args: {
  announcementId: string;
  deadlineId: string;
}) {
  const ctx = await getCurrentContext();
  const db = getDb();

  const [a] = await db
    .select({
      id: announcements.id,
      reliefDeadline: announcements.reliefDeadline,
      title: announcements.title,
    })
    .from(announcements)
    .where(eq(announcements.id, args.announcementId))
    .limit(1);
  if (!a) throw new Error("Announcement not found");
  if (!a.reliefDeadline) {
    throw new Error("This announcement has no relief deadline to apply");
  }

  await fileExtension({
    deadlineInstanceId: args.deadlineId,
    orgId: ctx.organization.id,
    newDueDate: a.reliefDeadline,
    actorType: "user",
    actorId: ctx.user.id,
    notes: `Auto-applied from IRS announcement: ${a.title}`,
  });

  // Tag the apply for the review-row "Applied" state. The deadline
  // timeline already gets `deadline.extension_filed` from fileExtension;
  // this extra event is the announcement-side breadcrumb.
  await recordAudit({
    orgId: ctx.organization.id,
    actorType: "user",
    actorId: ctx.user.id,
    action: "announcement.relief_applied",
    targetType: "deadline_instance",
    targetId: args.deadlineId,
    payload: {
      announcementId: a.id,
      reliefDeadline: a.reliefDeadline,
    },
  });

  revalidatePath(`/announcements/${args.announcementId}`);
  revalidatePath(`/deadlines/${args.deadlineId}`);
  revalidatePath("/dashboard");
}

/**
 * Batch apply: file extensions on every deadline in `deadlineIds` to
 * the announcement's `reliefDeadline` in one call. Each deadline goes
 * through the same `fileExtension` + `announcement.relief_applied`
 * audit pair as the single-row path, so per-deadline state on the
 * review page (Applied badge, audit timeline) reads identically
 * regardless of whether the CPA used the bulk button or per-row.
 *
 * Partial-success on purpose: one bad row doesn't roll back the others.
 * The audit chain already records each successful extend atomically,
 * and the CPA gets a `{applied, failed}` summary so they know exactly
 * what landed. Rolling back N successful extensions because the (N+1)th
 * was malformed would be a worse failure mode than reporting the gap.
 *
 * Caller is expected to filter out alreadyCovered / alreadyApplied
 * deadlines client-side; we don't re-validate here. fileExtension is
 * idempotent enough that double-apply just refreshes the date — no
 * data corruption — but the audit chain would gain redundant rows.
 */
export async function bulkApplyAnnouncementReliefAction(args: {
  announcementId: string;
  deadlineIds: string[];
}): Promise<{ applied: number; failed: number; errors: string[] }> {
  const ctx = await getCurrentContext();
  const db = getDb();

  const [a] = await db
    .select({
      id: announcements.id,
      reliefDeadline: announcements.reliefDeadline,
      title: announcements.title,
    })
    .from(announcements)
    .where(eq(announcements.id, args.announcementId))
    .limit(1);
  if (!a) throw new Error("Announcement not found");
  if (!a.reliefDeadline) {
    throw new Error("This announcement has no relief deadline to apply");
  }

  let applied = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const deadlineId of args.deadlineIds) {
    try {
      await fileExtension({
        deadlineInstanceId: deadlineId,
        orgId: ctx.organization.id,
        newDueDate: a.reliefDeadline,
        actorType: "user",
        actorId: ctx.user.id,
        notes: `Auto-applied from IRS announcement: ${a.title}`,
      });
      await recordAudit({
        orgId: ctx.organization.id,
        actorType: "user",
        actorId: ctx.user.id,
        action: "announcement.relief_applied",
        targetType: "deadline_instance",
        targetId: deadlineId,
        payload: {
          announcementId: a.id,
          reliefDeadline: a.reliefDeadline,
          batch: true,
        },
      });
      applied++;
    } catch (e) {
      failed++;
      errors.push(
        `${deadlineId}: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }
  }

  revalidatePath(`/announcements/${args.announcementId}`);
  revalidatePath("/dashboard");
  return { applied, failed, errors };
}

/**
 * "Skip" path — same audit row shape (so the review-query LEFT JOIN
 * picks it up as actioned), but without modifying the deadline. Use
 * when the CPA decides this announcement doesn't actually require
 * acting on this particular deadline (e.g. client already filed,
 * client opted out of relief, etc.).
 */
export async function skipAnnouncementForDeadlineAction(args: {
  announcementId: string;
  deadlineId: string;
}) {
  const ctx = await getCurrentContext();
  await recordAudit({
    orgId: ctx.organization.id,
    actorType: "user",
    actorId: ctx.user.id,
    action: "announcement.relief_applied",
    targetType: "deadline_instance",
    targetId: args.deadlineId,
    payload: {
      announcementId: args.announcementId,
      skipped: true,
    },
  });
  revalidatePath(`/announcements/${args.announcementId}`);
}
