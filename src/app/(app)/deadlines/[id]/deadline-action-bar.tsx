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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Calendar, Download, RotateCcw, Loader2 } from "lucide-react";
import {
  markCompleteAction,
  reopenAction,
  fileExtensionAction,
  setStatusAction,
  type WorkflowStatus,
} from "./actions";

// Display labels for the four workflow states. Order matters — this is
// the typical CPA progression: nothing started → blocked on client →
// actively working → handoff to client. Labels are short on purpose so
// the trigger stays single-line; hints are shown as a caption below
// the action row, not inside SelectItem (Radix's SelectValue copies
// item children into the trigger, so a 2-line item = 2-line trigger).
const WORKFLOW_OPTIONS: { value: WorkflowStatus; label: string; hint: string }[] = [
  { value: "pending", label: "Pending", hint: "Not started" },
  {
    value: "waiting_on_client",
    label: "Waiting on client",
    hint: "Blocked on docs or signature",
  },
  { value: "in_progress", label: "In progress", hint: "Actively working on it" },
];

function isWorkflowStatus(s: string): s is WorkflowStatus {
  return WORKFLOW_OPTIONS.some((o) => o.value === s);
}

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

  // Workflow status dropdown only makes sense for non-terminal states.
  // Completed already early-returned above. Extended deadlines (now an
  // is_extended flag, not a status) flow through the same pending →
  // waiting_on_client → in_progress workflow against their new due date.
  const currentWorkflow: WorkflowStatus | null = isWorkflowStatus(status)
    ? status
    : null;
  const currentHint =
    currentWorkflow != null
      ? WORKFLOW_OPTIONS.find((o) => o.value === currentWorkflow)?.hint
      : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Workflow status — quick-toggle stage without committing to filed */}
        {currentWorkflow ? (
          <Select
            value={currentWorkflow}
            disabled={pending}
            onValueChange={(v) => {
              if (!isWorkflowStatus(v) || v === currentWorkflow) return;
              startTransition(() => setStatusAction(deadlineId, v));
            }}
          >
            <SelectTrigger className="w-[180px]" aria-label="Workflow status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKFLOW_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

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

      {/* Add to calendar — downloads a single .ics. Using `Download`
          icon rather than `CalendarPlus` because the latter's extra
          "+" glyph gave it more ink-weight than the Calendar icon on
          File extension, making the button read as visibly taller
          even though the box-model height was identical. Download
          also more accurately describes what happens — the browser
          gets a file. */}
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          window.location.assign(`/api/deadlines/${deadlineId}/ics`);
        }}
      >
        <Download className="mr-2 h-4 w-4" /> Add to calendar
      </Button>
      </div>

      {/* Caption: explains what the currently-selected workflow status
          *means*. Lives outside the SelectItem (Radix would copy it
          into the trigger and break the layout) and outside the row
          (so it doesn't fight for horizontal space with the buttons). */}
      {currentHint ? (
        <p className="text-xs text-muted-foreground">{currentHint}</p>
      ) : null}
    </div>
  );
}
