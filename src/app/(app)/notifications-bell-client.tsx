"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { paletteForClient } from "@/lib/utils/client-palette";
import type { NotificationKind } from "@/lib/db/schema";
import type { NotificationListItem } from "@/lib/services/notifications";
import {
  markAllReadAction,
  markNotificationReadAction,
} from "./notifications-actions";

/**
 * NotificationsBell — Variant E from ui-samples/n-notifications-banner-variants.html.
 *
 * Placement: floating top-right of the main column, mirror of the sidebar
 * collapse-toggle's bottom-left floating button. Same visual language
 * (rounded-full, bg-card, shadow-card) so the two compose into a
 * symmetric "floating chrome" pair when the sidebar is collapsed.
 *
 * Data flow:
 *   - Initial render takes server-fetched (unreadCount, items) as props
 *   - "Mark all read" / row click fire server actions which revalidate the
 *     layout, refreshing the bell on the next paint
 *
 * Per-row color: hashed from linkPath (= /deadlines/{id}) via the existing
 * client palette. Stage rows for the same deadline reuse the deadline's
 * color since they share linkPath — visual continuity by accident, on
 * purpose.
 */
export function NotificationsBellClient({
  unreadCount,
  items,
}: {
  unreadCount: number;
  items: NotificationListItem[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const hasItems = items.length > 0;
  const hasUnread = unreadCount > 0;

  function handleMarkAllRead() {
    if (!hasUnread) return;
    startTransition(async () => {
      await markAllReadAction();
    });
  }

  function handleRowClick(notificationId: string, alreadyRead: boolean) {
    setOpen(false);
    if (alreadyRead) return;
    // Fire-and-forget — navigation already happens via the parent <Link>.
    // We don't await so the click feels instant.
    void markNotificationReadAction(notificationId);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            hasUnread
              ? `Notifications — ${unreadCount} unread`
              : "Notifications"
          }
          className={[
            // Mirror of app-shell.tsx's collapse expand-toggle:
            // hidden md:flex absolute top-4 left-4 z-30 w-8 h-8 rounded-full bg-card shadow-card
            // items-center justify-center hover:shadow-md text-foreground/70 transition-shadow
            "hidden md:flex absolute top-4 right-4 z-30",
            "w-8 h-8 rounded-full bg-card shadow-card",
            "items-center justify-center text-foreground/70",
            "hover:shadow-md transition-shadow cursor-pointer",
            // When open, give the bell a soft red ring so the trigger
            // anchor reads as "active" — matches Variant E mockup.
            open ? "ring-[3px] ring-[var(--priority-urgent)]/15" : "",
          ].join(" ")}
        >
          <Bell className="h-4 w-4" strokeWidth={1.8} />
          {hasUnread ? (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center"
              style={{ background: "var(--priority-urgent)" }}
              aria-hidden
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[360px] p-0 rounded-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-[13px] font-semibold">Reminders</span>
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={!hasUnread || pending}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Mark all read
          </button>
        </div>

        {hasItems ? (
          <div className="max-h-[420px] overflow-y-auto">
            {items.map((item, i) => (
              <NotificationRow
                key={item.id}
                item={item}
                showSeparator={i > 0}
                onClick={(alreadyRead) =>
                  handleRowClick(item.id, alreadyRead)
                }
              />
            ))}
          </div>
        ) : (
          <div className="px-4 py-10 text-center">
            <div className="text-[13px] font-medium text-foreground mb-1">
              All caught up
            </div>
            <div className="text-[11.5px] text-muted-foreground">
              We'll let you know when something needs your attention.
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  item,
  showSeparator,
  onClick,
}: {
  item: NotificationListItem;
  showSeparator: boolean;
  onClick: (alreadyRead: boolean) => void;
}) {
  const alreadyRead = item.readAt !== null;
  const palette = paletteForClient(item.linkPath);
  const pillStyle = pillForKind(item.kind);

  return (
    <>
      {showSeparator ? (
        <div className="border-t border-border" aria-hidden />
      ) : null}
      <Link
        href={item.linkPath}
        onClick={() => onClick(alreadyRead)}
        className={[
          "flex items-center gap-3 px-4 py-2.5 transition-colors",
          "hover:bg-[var(--canvas)]",
          alreadyRead ? "opacity-65" : "",
        ].join(" ")}
      >
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: palette.ring }}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold truncate">
            {item.title}
          </div>
          <div className="text-[11.5px] text-muted-foreground truncate">
            {item.body}
          </div>
        </div>
        <span
          className="text-[10.5px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ background: pillStyle.bg, color: pillStyle.fg }}
        >
          {pillStyle.label}
        </span>
      </Link>
    </>
  );
}

function pillForKind(kind: NotificationKind): {
  label: string;
  bg: string;
  fg: string;
} {
  switch (kind) {
    case "deadline_t_minus_7":
      return {
        label: "7d",
        bg: "var(--priority-high-bg)",
        fg: "var(--priority-high)",
      };
    case "deadline_t_minus_3":
      return {
        label: "3d",
        bg: "var(--priority-high-bg)",
        fg: "var(--priority-high)",
      };
    case "deadline_t_minus_1":
      return {
        label: "1d",
        bg: "var(--priority-urgent-bg)",
        fg: "var(--priority-urgent)",
      };
    case "stage_t_minus_1":
      return {
        label: "1d",
        bg: "var(--priority-urgent-bg)",
        fg: "var(--priority-urgent)",
      };
  }
}
