// Async server shell — wrap call sites in <Suspense fallback={<NotificationsBellSkeleton />}>.
import { getCurrentContext } from "@/lib/auth/current-org";
import {
  listNotificationsForUser,
  unreadCountForUser,
} from "@/lib/services/notifications";
import { NotificationsBellClient } from "./notifications-bell-client";

export async function NotificationsBell() {
  const ctx = await getCurrentContext();
  const [unreadCount, items] = await Promise.all([
    unreadCountForUser(ctx.user.id, ctx.organization.id),
    listNotificationsForUser(ctx.user.id, ctx.organization.id, 50),
  ]);

  if (items.length === 0) return null;

  return <NotificationsBellClient unreadCount={unreadCount} items={items} />;
}

export function NotificationsBellSkeleton() {
  return (
    <div
      aria-hidden
      className="hidden md:flex absolute top-4 right-4 z-30 w-8 h-8 rounded-full bg-card shadow-card opacity-50"
    />
  );
}
