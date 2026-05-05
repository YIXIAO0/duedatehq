"use client";

import { Fragment, useState, useTransition } from "react";
import {
  Calendar,
  Check,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  createSubtaskAction,
  deleteSubtaskAction,
  markSubtaskCompleteAction,
  reopenSubtaskAction,
  updateSubtaskAction,
} from "./subtask-actions";

export type StepperSubtask = {
  id: string;
  label: string;
  dueDate: string; // YYYY-MM-DD
  completedAt: Date | null;
};

/**
 * Equal-spaced horizontal stepper (Variant B from
 * ui-samples/m-subtimeline-variants.html). Renders prep stages between
 * "today" and the parent deadline's "FILE" marker.
 *
 * Each node is a clickable popover trigger — opens a mini menu with
 * mark-done / rename / change-date / delete. The end node is the
 * deadline itself, non-interactive (its own actions live in the
 * action bar below the card).
 *
 * Why not vertical: the page's vertical real estate is already heavy
 * (date card + notes + history + rule reference). A horizontal rail
 * here adds the "what's next in this prep cycle" view without pushing
 * everything else further down.
 */
export function SubtaskStepper({
  deadlineId,
  deadlineDueDate,
  isExtended,
  isCompleted,
  subtasks,
}: {
  deadlineId: string;
  deadlineDueDate: string;
  isExtended: boolean;
  isCompleted: boolean;
  subtasks: StepperSubtask[];
}) {
  // Empty state: prompt to add the first stage. Don't show the rail
  // chrome — it would just be a single FILE marker which adds noise.
  if (subtasks.length === 0) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Prep stages
        </p>
        <AddStageDialog
          deadlineId={deadlineId}
          deadlineDueDate={deadlineDueDate}
        />
      </div>
    );
  }

  const firstOpenIdx = subtasks.findIndex((s) => !s.completedAt);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Prep stages
        </p>
        <AddStageDialog
          deadlineId={deadlineId}
          deadlineDueDate={deadlineDueDate}
        />
      </div>

      {/* Layout: nodes (stages + FILE) are fixed-width content blocks
          centered as a group via justify-center. Connectors are a
          generous w-24 hairline so the line reads as a real connection,
          not a tiny floating segment. overflow-x-auto handles narrow
          screens — when the cluster gets wider than the card, the user
          can scroll horizontally rather than seeing connectors collapse. */}
      <div className="overflow-x-auto pb-1">
        <div className="flex items-start justify-center min-w-fit">
          {subtasks.map((sub, i) => {
            const isFirstOpen = i === firstOpenIdx;
            // Connector after this stage is "done" (green) when this
            // stage itself is done — once you finish a stage, the
            // segment leading away from it stays green so the eye
            // tracks completed work as a continuous bar.
            const connectorDone = Boolean(sub.completedAt);
            return (
              <Fragment key={sub.id}>
                <Step
                  deadlineId={deadlineId}
                  subtask={sub}
                  index={i}
                  isFirstOpen={isFirstOpen}
                />
                <Connector done={connectorDone} />
              </Fragment>
            );
          })}
          <FileMarker
            dueDate={deadlineDueDate}
            isExtended={isExtended}
            isCompleted={isCompleted}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connector — fixed-width hairline between adjacent items. Color picks
// up from the LEFT stage's completion state.
// ---------------------------------------------------------------------------

function Connector({ done }: { done: boolean }) {
  return (
    <div
      className="flex-none w-32 h-0.5 mt-[14px]"
      style={{
        background: done ? "var(--color-priority-done)" : "var(--border)",
      }}
      aria-hidden
    />
  );
}

// ---------------------------------------------------------------------------
// Step node — flex-none, content-sized column. The whole stepper is
// centered as a group via the parent's justify-center, so each Step
// stays narrow (w-24) and connectors do the visual work of communicating
// distance instead of empty padding inside an over-wide column.
// ---------------------------------------------------------------------------

function Step({
  deadlineId,
  subtask,
  index,
  isFirstOpen,
}: {
  deadlineId: string;
  subtask: StepperSubtask;
  index: number;
  isFirstOpen: boolean;
}) {
  const isDone = Boolean(subtask.completedAt);
  // Not-done stages render in neutral grey regardless of position. Warm
  // colors (orange/red) here read as "stamped/handled" and got confused
  // with the green done state. The "next up" stage is distinguished by
  // a slightly heavier label and the inline relative-date hint ("· in 6d"),
  // not by hue — done vs. not-done is the only color contrast.
  const stateClass = isDone
    ? "bg-[var(--color-priority-done)] text-white border-[var(--color-priority-done)]"
    : "bg-background border-border text-muted-foreground";
  const labelClass = isDone
    ? "text-muted-foreground"
    : isFirstOpen
    ? "text-foreground font-medium"
    : "text-foreground";
  const dateClass = "text-muted-foreground";
  const displayLabel = truncateLabel(subtask.label);

  return (
    <div className="flex-none flex flex-col items-center text-center w-36 px-1">
      <NodeMenu
        deadlineId={deadlineId}
        subtask={subtask}
        trigger={
          <button
            type="button"
            className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-semibold transition-shadow hover:shadow-sm ${stateClass}`}
            aria-label={`${subtask.label} — click to edit`}
          >
            {isDone ? (
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            ) : (
              index + 1
            )}
          </button>
        }
      />
      <div
        className={`text-[12px] mt-2.5 truncate max-w-full ${labelClass}`}
        title={subtask.label}
      >
        {displayLabel}
      </div>
      <div className={`text-[11px] mt-0.5 ${dateClass}`}>
        {formatShort(subtask.dueDate)}
        {isFirstOpen ? <RelativeDays iso={subtask.dueDate} /> : null}
      </div>
    </div>
  );
}

function FileMarker({
  dueDate,
  isExtended,
  isCompleted,
}: {
  dueDate: string;
  isExtended: boolean;
  isCompleted: boolean;
}) {
  // Color follows actual urgency, not "this is the FILE step". Filed →
  // green; > 7 days out → grey (no false alarm); within a week → red;
  // overdue → red + bolder. Constant red on every open deadline made
  // even far-future filings read as "already handled / urgent now".
  const days = daysUntilDue(dueDate);
  const isOverdue = !isCompleted && days < 0;
  const isUrgent = !isCompleted && days <= 7;

  let ringClass: string;
  let labelClass: string;
  if (isCompleted) {
    ringClass =
      "bg-[var(--color-priority-done)] border-[var(--color-priority-done)] text-white";
    labelClass = "text-[var(--color-priority-done)]";
  } else if (isUrgent) {
    ringClass =
      "bg-[var(--color-priority-urgent-bg)] border-[var(--color-priority-urgent)] text-[var(--color-priority-urgent)]";
    labelClass = `text-[var(--color-priority-urgent)]${isOverdue ? " font-bold" : ""}`;
  } else {
    ringClass = "bg-background border-border text-muted-foreground";
    labelClass = "text-muted-foreground";
  }

  return (
    <div className="flex-none flex flex-col items-center text-center w-36 px-1">
      <div
        className={`w-7 h-7 rounded-full border-2 flex items-center justify-center ${ringClass}`}
      >
        {isCompleted ? (
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        ) : (
          <FileText className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </div>
      <div className={`text-[12px] font-semibold mt-2.5 ${labelClass}`}>
        {isCompleted ? "FILED" : isExtended ? "EXT FILE" : "FILE"}
      </div>
      <div className={`text-[11px] mt-0.5 ${labelClass}`}>
        {formatShort(dueDate)}
      </div>
    </div>
  );
}

function daysUntilDue(iso: string): number {
  const due = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Per-node menu (popover): mark done / rename / change date / delete
// ---------------------------------------------------------------------------

function NodeMenu({
  deadlineId,
  subtask,
  trigger,
}: {
  deadlineId: string;
  subtask: StepperSubtask;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const isDone = Boolean(subtask.completedAt);

  function handleToggle() {
    startTransition(async () => {
      if (isDone) {
        await reopenSubtaskAction({ subtaskId: subtask.id, deadlineId });
      } else {
        await markSubtaskCompleteAction({ subtaskId: subtask.id, deadlineId });
      }
      setOpen(false);
    });
  }

  function handleClose() {
    setOpen(false);
    // Defer the reset so the popover unmount animation doesn't see a
    // sudden layout swap from edit mode → menu mode.
    setTimeout(() => setEditing(false), 150);
  }

  return (
    <Popover open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={6}
        className="w-[260px] p-1"
      >
        {editing ? (
          <EditStageForm
            deadlineId={deadlineId}
            subtask={subtask}
            onDone={handleClose}
          />
        ) : (
          <div className="flex flex-col text-sm">
            <button
              type="button"
              onClick={handleToggle}
              disabled={pending}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-foreground/5 text-left"
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isDone ? (
                <RotateCcw className="h-3.5 w-3.5" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {isDone ? "Mark as not done" : "Mark as done"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-foreground/5 text-left"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit label &amp; date
            </button>
            <div className="my-1 border-t border-border" />
            <DeleteStageButton
              deadlineId={deadlineId}
              subtask={subtask}
              onDeleted={handleClose}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function EditStageForm({
  deadlineId,
  subtask,
  onDone,
}: {
  deadlineId: string;
  subtask: StepperSubtask;
  onDone: () => void;
}) {
  const [label, setLabel] = useState(subtask.label);
  const [dueDate, setDueDate] = useState(subtask.dueDate);
  const [pending, startTransition] = useTransition();

  const changed = label.trim() !== subtask.label || dueDate !== subtask.dueDate;

  function save() {
    if (!changed || !label.trim()) return;
    startTransition(async () => {
      await updateSubtaskAction({
        subtaskId: subtask.id,
        deadlineId,
        label: label.trim(),
        dueDate,
      });
      onDone();
    });
  }

  return (
    <div className="space-y-2 p-2">
      <div>
        <Label htmlFor={`label-${subtask.id}`} className="text-[11px]">
          Label
        </Label>
        <Input
          id={`label-${subtask.id}`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={120}
          className="mt-1 h-8"
          autoFocus
        />
      </div>
      <div>
        <Label htmlFor={`date-${subtask.id}`} className="text-[11px]">
          Due date
        </Label>
        <Input
          id={`date-${subtask.id}`}
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="mt-1 h-8"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDone}
          className="h-8"
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={!changed || !label.trim() || pending}
          className="h-8"
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function DeleteStageButton({
  deadlineId,
  subtask,
  onDeleted,
}: {
  deadlineId: string;
  subtask: StepperSubtask;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-foreground/5 text-left text-[var(--color-priority-urgent)]"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete stage
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{subtask.label}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This stage will be removed from the timeline. The deadline itself
            stays unchanged. Audit history keeps a record of the deletion.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              startTransition(async () => {
                await deleteSubtaskAction({
                  subtaskId: subtask.id,
                  deadlineId,
                });
                onDeleted();
              })
            }
            disabled={pending}
          >
            {pending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Add stage dialog (popover-based, anchored to the + Add stage button)
// ---------------------------------------------------------------------------

function AddStageDialog({
  deadlineId,
  deadlineDueDate,
}: {
  deadlineId: string;
  deadlineDueDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  // Default new stage to 7 days before the deadline as a reasonable
  // starting point ("most prep happens in the final week"). The user
  // can adjust to anything before that.
  const [dueDate, setDueDate] = useState(() => defaultPrepDate(deadlineDueDate));
  const [pending, startTransition] = useTransition();

  function reset() {
    setLabel("");
    setDueDate(defaultPrepDate(deadlineDueDate));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    const fd = new FormData();
    fd.set("deadlineId", deadlineId);
    fd.set("label", label.trim());
    fd.set("dueDate", dueDate);
    startTransition(async () => {
      await createSubtaskAction(fd);
      reset();
      setOpen(false);
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground transition-colors"
          aria-label="Add stage"
        >
          <Plus className="h-3 w-3" aria-hidden /> Add stage
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[300px] p-3">
        <form onSubmit={submit} className="space-y-2">
          <div>
            <Label htmlFor="new-stage-label" className="text-[11px]">
              Label
            </Label>
            <Input
              id="new-stage-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              placeholder="e.g. Receive financials"
              className="mt-1 h-8"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="new-stage-date" className="text-[11px]">
              Due date
            </Label>
            <Input
              id="new-stage-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              max={deadlineDueDate}
              className="mt-1 h-8"
            />
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              <Calendar className="inline h-2.5 w-2.5 mr-0.5" />
              Deadline is {formatShort(deadlineDueDate)}
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              className="h-8"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!label.trim() || pending}
              className="h-8"
            >
              {pending ? "Adding…" : "Add stage"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatShort(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const LABEL_DISPLAY_MAX = 25;
function truncateLabel(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= LABEL_DISPLAY_MAX) return trimmed;
  return `${trimmed.slice(0, LABEL_DISPLAY_MAX - 1)}…`;
}


function RelativeDays({ iso }: { iso: string }) {
  const due = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  const label =
    days < 0
      ? `${Math.abs(days)}d overdue`
      : days === 0
      ? "today"
      : days === 1
      ? "tomorrow"
      : `in ${days}d`;
  return <span className="ml-1">· {label}</span>;
}

function defaultPrepDate(deadlineDueDate: string): string {
  const d = new Date(deadlineDueDate + "T00:00:00");
  d.setDate(d.getDate() - 7);
  // Clamp to today if -7d is in the past so the date input doesn't
  // pre-fill an invalid date.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (d.getTime() < today.getTime()) return today.toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}
