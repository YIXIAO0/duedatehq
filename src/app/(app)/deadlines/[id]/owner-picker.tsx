"use client";

import { useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { paletteForClient, clientInitials } from "@/lib/utils/client-palette";
import { assignDeadlineAction } from "./actions";

export interface OwnerOption {
  userId: string;
  fullName: string | null;
  email: string;
}

/**
 * Owner picker — dropdown to assign / unassign a deadline.
 *
 * Pre-selects the current owner; "Unassigned" is a first-class option
 * that resets `owner_user_id` to NULL. Solo orgs hide the picker entirely
 * (caller passes `members.length <= 1` and skips render) — assignment
 * is meaningful only when there's more than one person to choose between.
 *
 * Server-side (assignDeadline) re-validates that the picked user is
 * actually a member of the deadline's org, so a tampered request can't
 * pin ownership cross-tenant.
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
  const [pending, startTransition] = useTransition();
  const value = currentOwnerUserId ?? "__unassigned__";

  function onValueChange(v: string) {
    const next = v === "__unassigned__" ? null : v;
    if (next === currentOwnerUserId) return;
    startTransition(() => assignDeadlineAction(deadlineId, next));
  }

  // Render the current owner's avatar inside the trigger so the picker
  // reads as "who's on this" at a glance, not just "Owner: name".
  const currentMember = currentOwnerUserId
    ? members.find((m) => m.userId === currentOwnerUserId)
    : null;

  return (
    <div className="flex items-center gap-3">
      {currentMember ? (
        <OwnerAvatar member={currentMember} />
      ) : (
        <UnassignedAvatar />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Owner
        </p>
        <div className="mt-1">
          <Select
            value={value}
            onValueChange={onValueChange}
            disabled={pending}
          >
            <SelectTrigger className="h-8 w-[260px] cursor-pointer text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unassigned__">
                <span className="text-muted-foreground">Unassigned</span>
              </SelectItem>
              {members.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.fullName ?? m.email.split("@")[0]}
                  {m.fullName ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {m.email}
                    </span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function OwnerAvatar({ member }: { member: OwnerOption }) {
  const palette = paletteForClient(member.userId);
  const display = member.fullName ?? member.email;
  const initials = clientInitials(display);
  return (
    <span
      title={display}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
      style={{ background: palette.bg, color: palette.text }}
    >
      {initials}
    </span>
  );
}

function UnassignedAvatar() {
  return (
    <span
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-medium text-muted-foreground"
      style={{ border: "1px dashed var(--border)" }}
      aria-label="Unassigned"
    >
      ·
    </span>
  );
}
