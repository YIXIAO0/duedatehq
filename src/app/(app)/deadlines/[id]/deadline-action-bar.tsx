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
import { CheckCircle2, Calendar, RotateCcw, Loader2 } from "lucide-react";
import {
  markCompleteAction,
  reopenAction,
  fileExtensionAction,
} from "./actions";

export function DeadlineActionBar({
  deadlineId,
  status,
  defaultNewDueDate,
  currentExtensionDueDate,
}: {
  deadlineId: string;
  status: string;
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

  if (status === "completed") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={pending}>
              <RotateCcw className="mr-2 h-4 w-4" /> Re-open
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Re-open this deadline?</AlertDialogTitle>
              <AlertDialogDescription>
                It will return to the pending state so it shows up on your
                upcoming list again.
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
      {/* Mark complete */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button disabled={pending}>
            <CheckCircle2 className="mr-2 h-4 w-4" /> Mark as filed
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
            >
              {pending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                "Mark as filed"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* File extension */}
      <Dialog open={extOpen} onOpenChange={setExtOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" disabled={pending}>
            <Calendar className="mr-2 h-4 w-4" /> File extension
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form
            action={async (fd) => {
              await fileExtensionAction(fd);
              setExtOpen(false);
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
    </div>
  );
}
