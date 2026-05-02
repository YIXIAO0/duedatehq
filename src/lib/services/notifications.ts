/**
 * Notifications read service (C-3) — powers the bell + popover.
 *
 * Counterpart to lib/services/reminders.ts: that file *writes* notifications
 * from the cron, this one *reads* them for the UI. Keeping the two halves
 * separated lets the cron stay server-only/cron-only while the read paths
 * can be called from React Server Components on every page load.
 *
 * All queries are scoped by both userId and orgId. orgId enforces multi-
 * tenant isolation in case a user later belongs to multiple workspaces —
 * the bell only shows reminders for the active workspace, not a global
 * cross-org feed.
 */

import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { notifications, type NotificationKind } from "@/lib/db/schema";

export type NotificationListItem = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  linkPath: string;
  deliveredAt: string; // ISO
  readAt: string | null; // ISO or null
};

/**
 * Popover query — most recent N notifications for the user/org, unread or
 * recently read. Limit defaults to 50; the popover scrolls inside.
 *
 * Hot path: every dashboard load fires this. Index
 * `notifications_user_recent_idx` (user_id, delivered_at) keeps it cheap.
 */
export async function listNotificationsForUser(
  userId: string,
  orgId: string,
  limit = 50,
): Promise<NotificationListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      linkPath: notifications.linkPath,
      deliveredAt: notifications.deliveredAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.orgId, orgId),
      ),
    )
    .orderBy(desc(notifications.deliveredAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    linkPath: r.linkPath,
    deliveredAt: r.deliveredAt.toISOString(),
    readAt: r.readAt ? r.readAt.toISOString() : null,
  }));
}

/**
 * Bell badge count — unread notifications for this user/org.
 *
 * Hot path: every page load (the bell sits in app-shell). Backed by partial
 * index `notifications_unread_idx` (WHERE read_at IS NULL), so the count
 * is roughly O(badge_count) per user, not O(total_notifications).
 */
export async function unreadCountForUser(
  userId: string,
  orgId: string,
): Promise<number> {
  const db = getDb();
  const r = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.orgId, orgId),
        isNull(notifications.readAt),
      ),
    );
  return Number(r[0]?.n ?? 0);
}

/**
 * Mark all unread notifications read for this user/org.
 *
 * Triggered by the popover's "Mark all read" action. Returns the affected
 * row count so the caller can decide whether to surface a toast / no-op.
 */
export async function markAllReadForUser(
  userId: string,
  orgId: string,
): Promise<number> {
  const db = getDb();
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.orgId, orgId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return updated.length;
}

/**
 * Mark a single notification read. Used when the user clicks a row in the
 * popover and we want that one to lose its unread emphasis without
 * affecting the rest. Idempotent — if already read, the update is a no-op.
 *
 * userId is required (not derived from session) to keep this callable from
 * server actions where we already have ctx.user.id; it also blocks a user
 * from marking another user's notification read via crafted ID.
 */
export async function markNotificationRead(
  notificationId: string,
  userId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    );
}
