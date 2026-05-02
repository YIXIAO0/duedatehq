"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { paletteForClient, clientInitials } from "@/lib/utils/client-palette";
import { assignDeadlineAction } from "./actions";

export interface OwnerOption {
  userId: string;
  fullName: string | null;
  email: string;
}

/**
 * Owner picker for the deadline detail page.
 *
 * Built on Popover + custom button list (NOT Radix Select) because the
 * Select implementation had two visible bugs:
 *   1. Chevron drifted to the right edge of a min-width trigger even with
 *      justify-start — Radix Select's internal layout fights utility
 *      overrides.
 *   2. The popover sometimes anchored at the viewport top-left instead of
 *      under the trigger when custom children replaced SelectValue —
 *      Radix lost the anchor reference.
 *
 * Popover gives us full control over both, and matches the pattern the
 * dashboard's per-row OwnerCell already uses, so the two surfaces feel
 * the same.
 */
export function OwnerPicker({
  deadlineId,
  currentOwnerUserId,
  members,
}: {
  deadlineId: string;
  currentOwnerUserId: string | null;
  members: OwnerOption[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const currentMember = currentOwnerUserId
    ? members.find((m) => m.userId === currentOwnerUserId)
    : null;

  function pick(userId: string | null) {
    if (userId === currentOwnerUserId) {
      setOpen(false);
      return;
    }
    startTransition(() => assignDeadlineAction(deadlineId, userId));
    setOpen(false);
  }

  const triggerLabel = currentMember
    ? (currentMember.fullName ?? currentMember.email.split("@")[0])
    : "Unassigned";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label={`Owner: ${triggerLabel}. Click to change.`}
          className="inline-flex items-center gap-2 rounded-full border border-input bg-background pl-1 pr-2 py-1 text-xs cursor-pointer hover:bg-foreground/5 transition-colors disabled:opacity-50"
        >
              {currentMember ? (
            <SmallAvatar
              seed={currentMember.userId}
              initials={clientInitials(
                currentMember.fullName ?? currentMember.email,
              )}
            />
          ) : (
            <UnassignedDot />
          )}
          <span className={currentMember ? "" : "text-muted-foreground"}>
            {triggerLabel}
          </span>
          <ChevronDown
            className="ml-0.5 h-3 w-3 text-muted-foreground"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-[280px] p-1">
        <div className="flex flex-col">
          <PickerRow
            onClick={() => pick(null)}
            avatar={<UnassignedDot />}
            primary={
              <span className="text-muted-foreground">Unassigned</span>
            }
            isCurrent={currentOwnerUserId === null}
          />
          <div className="my-1 border-t border-border" />
          {members.map((m) => {
            const display = m.fullName ?? m.email.split("@")[0];
            const isCurrent = m.userId === currentOwnerUserId;
            return (
              <PickerRow
                key={m.userId}
                onClick={() => pick(m.userId)}
                avatar={
                  <SmallAvatar
                    seed={m.userId}
                    initials={clientInitials(m.fullName ?? m.email)}
                  />
                }
                primary={display}
                secondary={m.fullName ? m.email : null}
                isCurrent={isCurrent}
              />
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PickerRow({
  onClick,
  avatar,
  primary,
  secondary,
  isCurrent,
}: {
  onClick: () => void;
  avatar: React.ReactNode;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  isCurrent: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-foreground/5 cursor-pointer"
    >
      {avatar}
      <div className="min-w-0 flex-1">
        <div className={`truncate ${isCurrent ? "font-medium" : ""}`}>
          {primary}
        </div>
        {secondary ? (
          <div className="truncate text-xs text-muted-foreground">
            {secondary}
          </div>
        ) : null}
      </div>
      {isCurrent ? (
        <span className="text-xs text-primary" aria-label="current">
          ✓
        </span>
      ) : null}
    </button>
  );
}

function SmallAvatar({
  seed,
  initials,
}: {
  seed: string;
  initials: string;
}) {
  const palette = paletteForClient(seed);
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
      style={{ background: palette.bg, color: palette.text }}
    >
      {initials}
    </span>
  );
}

function UnassignedDot() {
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground"
      style={{ border: "1px dashed var(--border)" }}
      aria-hidden
    >
      <span className="text-[10px]">·</span>
    </span>
  );
}
