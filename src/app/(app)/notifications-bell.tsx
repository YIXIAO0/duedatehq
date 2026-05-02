/**
 * NotificationsBell — async server component shell.
 *
 * Fetches the popover's initial data (unread count + list of recent
 * notifications) on every layout render and hands them to the client
 * component. Server actions in notifications-actions.ts revalidate the
 * "/" layout, so mark-read flows refresh this shell without a hard nav.
 *
 * Wrap with <Suspense fallback={<NotificationsBellSkeleton />}> at the
 * call site (layout.tsx) so the rest of the app shell can stream while
 * the bell's two queries resolve.
 */

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
  return <NotificationsBellClient unreadCount={unreadCount} items={items} />;
}

export function NotificationsBellSkeleton() {
  // Renders an empty bell shell so the layout's top-right slot doesn't
  // shift when the real bell streams in. Same dimensions as the real
  // button — top-4 right-4 w-8 h-8.
  return (
    <div
      aria-hidden
      className="hidden md:flex absolute top-4 right-4 z-30 w-8 h-8 rounded-full bg-card shadow-card opacity-50"
    />
  );
}
