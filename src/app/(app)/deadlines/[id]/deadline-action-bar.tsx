"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  Calendar,
  Download,
  RotateCcw,
  Loader2,
} from "lucide-react";
import {
  markCompleteAction,
  reopenAction,
  fileExtensionAction,
} from "./actions";
import { shiftSubtasksAction } from "./subtask-actions";

/**
 * Action bar for the deadline detail page.
 *
 * State model collapsed to binary on 2026-05-01: a deadline is either
 * Pending (open) or Filed (completed). Workflow nuance moves to:
 *   - the owner avatar (who's on it)
 *   - the notes field (what's blocking / where they are)
 *
 * So this bar only carries 2 paths:
 *   - Open: Mark as filed · File extension · Add to calendar
 *   - Filed: Re-open
 *
 * Extension is orthogonal to status (it shifts the date, not the work
 * stage), so it stays available regardless.
 */
export function DeadlineActionBar({
  deadlineId,
  isCompleted,
  defaultNewDueDate,
  currentExtensionDueDate,
}: {
  deadlineId: string;
  isCompleted: boolean;
  /** Pre-fill the extension date input with the rule's canonical extension date */
  defaultNewDueDate: string;
  /** When non-null, this deadline already has an extension. We warn the
      user before they file another one (e.g., disaster relief stacking
      on top of Form 4868). The audit trail keeps the original extension
      record so nothing is "lost", but the UI confirmation prevents
      accidental over-writes. */
  currentExtensionDueDate?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [extOpen, setExtOpen] = useState(false);
  // Two-stage extension flow: file extension → if open stages exist that
  // would be candidates to shift, surface a follow-up dialog. Default
  // for that follow-up is "Keep stages as-is" (safer — moving dates
  // silently is a worse failure mode than leaving stale ones the user
  // can fix manually).
  const [shiftPrompt, setShiftPrompt] = useState<null | {
    candidates: number;
    originalDueDate: string;
    newDueDate: string;
  }>(null);
  const [shifting, startShift] = useTransition();

  if (isCompleted) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={pending} className="gap-1.5">
              <RotateCcw className="mr-0 h-4 w-4" /> Re-open
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Re-open this deadline?</AlertDialogTitle>
              <AlertDialogDescription>
                It will return to the open list and show on your dashboard
                again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => startTransition(() => reopenAction(deadlineId))}
              >
                Re-open
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Mark as filed — outline like its siblings. The three actions
          (Mark as filed / File extension / Add to calendar) are
          conceptually equal-weight, so visual hierarchy here was a
          fiction. The dialog's confirm button keeps a sage tint to
          reassure "yes, you really did file it" — distinct context. */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" disabled={pending} className="gap-1.5">
            <CheckCircle2 className="mr-0 h-4 w-4" /> Mark as filed
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this deadline as filed?</AlertDialogTitle>
            <AlertDialogDescription>
              It&apos;ll disappear from your upcoming list and show in the
              &ldquo;completed&rdquo; stats. You can re-open it later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                startTransition(() => markCompleteAction(deadlineId))
              }
              className="gap-1.5 !bg-[#4F8B66] !text-white hover:!bg-[#4F8B66]/90"
            >
              {pending ? (
                <>
                  <Loader2 className="mr-0 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                "Mark as filed"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* File extension — orthogonal to status (shifts the date) */}
      <Dialog open={extOpen} onOpenChange={setExtOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" disabled={pending} className="gap-1.5">
            <Calendar className="mr-0 h-4 w-4" /> File extension
          </Button>
        </DialogTrigger>

        <DialogContent>
          <form
            action={async (fd) => {
              const result = await fileExtensionAction(fd);
              setExtOpen(false);
              // Open shift prompt only when there's actually something to
              // shift — zero candidates means no stages live in the post-
              // extension window, so the dialog would just ask the user
              // to confirm a no-op.
              if (result.shiftCandidates > 0) {
                setShiftPrompt({
                  candidates: result.shiftCandidates,
                  originalDueDate: result.originalDueDate,
                  newDueDate: result.newDueDate,
                });
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {currentExtensionDueDate
                  ? "Replace the existing extension"
                  : "File an extension"}
              </DialogTitle>
              <DialogDescription>
                {currentExtensionDueDate
                  ? "This deadline already has an extension on file. Filing again will replace the current extension date — usually only correct for disaster relief on top of Form 4868. The original extension stays in the History below."
                  : "Record that you filed the extension form. We'll update the effective due date on your dashboard."}
              </DialogDescription>
            </DialogHeader>

            <input type="hidden" name="deadlineId" value={deadlineId} />

            {currentExtensionDueDate ? (
              <div className="my-2 rounded-md border border-[var(--color-priority-high)]/30 bg-[var(--color-priority-high-bg)]/50 px-3 py-2 text-xs text-foreground">
                <span className="font-semibold text-[var(--color-priority-high)]">
                  Currently extended to{" "}
                  {new Date(
                    currentExtensionDueDate + "T00:00:00",
                  ).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                <span className="ml-1 text-muted-foreground">
                  — entering a new date below will overwrite this in the
                  active record.
                </span>
              </div>
            ) : null}

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="newDueDate">New due date *</Label>
                <Input
                  id="newDueDate"
                  name="newDueDate"
                  type="date"
                  defaultValue={defaultNewDueDate}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Pre-filled with this form&apos;s statutory extension date.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes (optional)</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  placeholder="e.g. Form 7004 submitted via ProConnect, confirmation #12345"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setExtOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">
                {currentExtensionDueDate
                  ? "Replace extension"
                  : "Record extension"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add to calendar — downloads a single .ics */}
      <Button
        variant="outline"
        disabled={pending}
        className="gap-1.5"
        onClick={() => {
          window.location.assign(`/api/deadlines/${deadlineId}/ics`);
        }}
      >
        <Download className="mr-0 h-4 w-4" /> Add to calendar
      </Button>

      {/* Stage-shift follow-up — shown only when filing the extension
          left open stages dated on/after the pre-extension deadline. */}
      <Dialog
        open={shiftPrompt !== null}
        onOpenChange={(v) => {
          if (!v) setShiftPrompt(null);
        }}
      >
        <DialogContent>
          {shiftPrompt ? (
            <>
              <DialogHeader>
                <DialogTitle>Shift prep stages?</DialogTitle>
                <DialogDescription>
                  Extension recorded — due date moved{" "}
                  <span className="font-medium text-foreground">
                    {humanShortDate(shiftPrompt.originalDueDate)}
                  </span>{" "}
                  →{" "}
                  <span className="font-medium text-foreground">
                    {humanShortDate(shiftPrompt.newDueDate)}
                  </span>
                  . You have{" "}
                  <span className="font-medium text-foreground">
                    {shiftPrompt.candidates}
                  </span>{" "}
                  open stage{shiftPrompt.candidates === 1 ? "" : "s"} dated on
                  or after the original due date. Already-completed stages
                  never shift.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShiftPrompt(null)}
                  disabled={shifting}
                >
                  Keep stages as-is
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    const target = shiftPrompt;
                    startShift(async () => {
                      await shiftSubtasksAction({
                        deadlineId,
                        originalDueDate: target.originalDueDate,
                        newDueDate: target.newDueDate,
                      });
                      setShiftPrompt(null);
                    });
                  }}
                  disabled={shifting}
                >
                  {shifting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Shifting…
                    </>
                  ) : (
                    `Shift ${shiftPrompt.candidates} stage${shiftPrompt.candidates === 1 ? "" : "s"}`
                  )}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function humanShortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
