"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { paletteForClient, clientInitials } from "@/lib/utils/client-palette";
import { assignDeadlineAction } from "../deadlines/[id]/actions";
import type { DashboardDeadline, MemberSummary } from "./dashboard-client";

/**
 * Clickable owner cell — assigned avatar OR "+ in dashed circle" for
 * unassigned. Click opens an inline popover with the member list so
 * the CPA can assign / reassign without leaving the dashboard. The
 * detail page has a richer picker (with email and avatar preview);
 * this is the keep-flowing-through-the-list version.
 *
 * Stable per-user color slot via paletteForClient — owner colors stay
 * consistent across sessions regardless of which client they're on.
 */
export function OwnerCell({
  deadline,
  members,
}: {
  deadline: DashboardDeadline;
  members: MemberSummary[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function assign(userId: string | null) {
    if (userId === deadline.owner_user_id) {
      setOpen(false);
      return;
    }
    startTransition(() => assignDeadlineAction(deadline.id, userId));
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label={
            deadline.owner_user_id
              ? `Owner: ${deadline.owner_full_name ?? deadline.owner_email}. Click to reassign.`
              : "Unassigned. Click to assign."
          }
          className="transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {deadline.owner_user_id ? (
            <AssignedAvatar deadline={deadline} />
          ) : (
            <UnassignedPlus />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-56 p-1"
        onClick={(e) => e.stopPropagation()}
      >
        <OwnerPickerList
          members={members}
          currentOwnerUserId={deadline.owner_user_id}
          onPick={assign}
        />
      </PopoverContent>
    </Popover>
  );
}

function AssignedAvatar({ deadline }: { deadline: DashboardDeadline }) {
  const palette = paletteForClient(deadline.owner_user_id ?? "");
  const display = deadline.owner_full_name ?? deadline.owner_email ?? "Owner";
  const initials = clientInitials(display);
  return (
    <span
      title={display}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold"
      style={{ background: palette.bg, color: palette.text }}
    >
      {initials}
    </span>
  );
}

function UnassignedPlus() {
  return (
    <span
      title="Unassigned — click to assign"
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
      style={{ border: "1px dashed var(--border)" }}
    >
      <Plus className="h-3 w-3" />
    </span>
  );
}

function OwnerPickerList({
  members,
  currentOwnerUserId,
  onPick,
}: {
  members: MemberSummary[];
  currentOwnerUserId: string | null;
  onPick: (userId: string | null) => void;
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => onPick(null)}
        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-foreground/5"
      >
        <span
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] text-muted-foreground"
          style={{ border: "1px dashed var(--border)" }}
        >
          ·
        </span>
        <span
          className={
            currentOwnerUserId === null
              ? "font-medium"
              : "text-muted-foreground"
          }
        >
          Unassigned
        </span>
      </button>
      <div className="my-1 border-t border-border" />
      {members.map((m) => {
        const palette = paletteForClient(m.userId);
        const display = m.fullName ?? m.email.split("@")[0];
        const isCurrent = m.userId === currentOwnerUserId;
        return (
          <button
            key={m.userId}
            type="button"
            onClick={() => onPick(m.userId)}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-foreground/5"
          >
            <span
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
              style={{ background: palette.bg, color: palette.text }}
            >
              {clientInitials(display)}
            </span>
            <span
              className={`truncate ${isCurrent ? "font-medium" : ""}`}
            >
              {display}
            </span>
          </button>
        );
      })}
    </div>
  );
}
