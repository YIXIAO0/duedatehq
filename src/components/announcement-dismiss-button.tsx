"use client";

import { useTransition } from "react";
import { X, RotateCcw } from "lucide-react";
import {
  dismissAnnouncementAction,
  undismissAnnouncementAction,
} from "@/app/(app)/announcements/actions";

/**
 * Tiny X button shown on every announcement row. Optimistic-feel via
 * useTransition: the click stays disabled (and the X spins to a loader)
 * for the round-trip, then revalidatePath in the action causes the row
 * to disappear from view.
 *
 * Variant `undismiss` shows a "↺ Restore" button instead — used on the
 * "Show dismissed" view of /announcements as a recovery path.
 */
export function AnnouncementDismissButton({
  announcementId,
  variant = "dismiss",
  size = "md",
}: {
  announcementId: string;
  variant?: "dismiss" | "undismiss";
  size?: "sm" | "md";
}) {
  const [pending, start] = useTransition();
  const handleClick = () => {
    start(async () => {
      if (variant === "undismiss") {
        await undismissAnnouncementAction(announcementId);
      } else {
        await dismissAnnouncementAction(announcementId);
      }
    });
  };
  const Icon = variant === "undismiss" ? RotateCcw : X;
  const dim = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={variant === "undismiss" ? "Restore" : "Dismiss"}
      className={
        variant === "undismiss"
          ? "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          : "inline-flex items-center justify-center rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      <Icon className={`${dim} ${pending ? "animate-spin" : ""}`} />
      {variant === "undismiss" ? <span>Restore</span> : null}
    </button>
  );
}
