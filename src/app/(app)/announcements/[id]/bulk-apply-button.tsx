"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { bulkApplyAnnouncementReliefAction } from "../actions";

export type PendingDeadline = {
  deadlineId: string;
  clientId: string;
  clientName: string;
  formCode: string;
  currentEffectiveDate: string;
};

/**
 * Top-of-page bulk action: file extensions on every pending deadline
 * for this announcement in one click. Renders a primary CTA next to
 * the progress strip; click opens a confirmation dialog with a
 * checkbox per deadline so the CPA can deselect false positives
 * before committing.
 *
 * Caller is responsible for passing only deadlines that are still
 * pending (not appliedAt, not alreadyCovered). The component itself
 * trusts that filter — no additional gating here.
 *
 * Disaster-relief items get an extra "Confirmed county verified"
 * checkbox the CPA must tick before the Apply button enables. The
 * single-row Apply path uses a separate AlertDialog for the same
 * gate; we re-use the in-modal checkbox pattern here so the bulk
 * flow doesn't stack two dialogs.
 */
export function BulkApplyButton({
  announcementId,
  reliefDeadline,
  pendingDeadlines,
  requiresVerify,
  affectedCounties,
}: {
  announcementId: string;
  reliefDeadline: string;
  pendingDeadlines: PendingDeadline[];
  requiresVerify: boolean;
  affectedCounties: string[];
}) {
  const [open, setOpen] = useState(false);
  // Selection map keyed by deadlineId — defaults to "all selected".
  // We re-init each time the dialog opens so a partial apply followed
  // by re-open doesn't carry stale unchecks across server refreshes.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(pendingDeadlines.map((d) => d.deadlineId)),
  );
  const [verified, setVerified] = useState(!requiresVerify);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<
    | { applied: number; failed: number; errors: string[] }
    | null
  >(null);

  const total = pendingDeadlines.length;
  const selectedCount = selected.size;

  // Group by client so the checklist reads as "Acme Corp — 3 deadlines"
  // rather than a flat 30-row list. Order is stable from the server.
  const grouped = useMemo(() => {
    const map = new Map<string, { clientName: string; rows: PendingDeadline[] }>();
    for (const d of pendingDeadlines) {
      const existing = map.get(d.clientId);
      if (existing) {
        existing.rows.push(d);
      } else {
        map.set(d.clientId, { clientName: d.clientName, rows: [d] });
      }
    }
    return Array.from(map.entries()).map(([clientId, v]) => ({
      clientId,
      ...v,
    }));
  }, [pendingDeadlines]);

  function toggle(deadlineId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(deadlineId)) next.delete(deadlineId);
      else next.add(deadlineId);
      return next;
    });
  }

  function toggleClient(clientRows: PendingDeadline[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = clientRows.every((r) => next.has(r.deadlineId));
      for (const r of clientRows) {
        if (allOn) next.delete(r.deadlineId);
        else next.add(r.deadlineId);
      }
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(pendingDeadlines.map((d) => d.deadlineId)));
  }
  function selectNone() {
    setSelected(new Set());
  }

  function submit() {
    if (selectedCount === 0) return;
    if (requiresVerify && !verified) return;
    const ids = Array.from(selected);
    start(async () => {
      const res = await bulkApplyAnnouncementReliefAction({
        announcementId,
        deadlineIds: ids,
      });
      setResult(res);
      // Server revalidatePath will refresh the page data; close on
      // full success so the CPA sees the updated rows. Keep open on
      // partial failure so they can read the error summary.
      if (res.failed === 0) {
        setOpen(false);
      }
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Re-seed selection / state every open so a stale snapshot
      // doesn't leak across reopens (e.g., partial apply, dialog
      // closed, re-opened on the now-shorter pending list).
      setSelected(new Set(pendingDeadlines.map((d) => d.deadlineId)));
      setVerified(!requiresVerify);
      setResult(null);
    }
  }

  if (total === 0) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {/* Warm coral→amber pill — echoes the dashboard IRS strip's
            signature gradient so this CTA reads as the same family of
            "tax-update action" rather than a generic shadcn primary
            button. Rounded-full + gentle shadow for Arc-DNA feel. */}
        <button
          type="button"
          className="group inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-white shadow-sm transition-all hover:shadow-md hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--client-rose)]/40 focus-visible:ring-offset-2"
          style={{
            background: "linear-gradient(135deg, #FF7B7B, #FFB85C)",
          }}
          aria-label={`Apply ${humanShort(reliefDeadline)} to ${total} ${total === 1 ? "deadline" : "deadlines"}`}
        >
          Extend {total} {total === 1 ? "deadline" : "deadlines"} to{" "}
          {humanShort(reliefDeadline)}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden p-0">
        <div className="flex max-h-[85vh] flex-col">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>
              Apply relief to {selectedCount} of {total}{" "}
              {total === 1 ? "deadline" : "deadlines"}
            </DialogTitle>
            <DialogDescription>
              Each selected deadline will be extended to{" "}
              <span className="font-medium text-foreground">
                {humanDate(reliefDeadline)}
              </span>
              . Uncheck anything you don&apos;t want included.
            </DialogDescription>
          </DialogHeader>

          {/* Disaster-relief county warning + verify gate. Same copy as
              the per-row AlertDialog so both paths apply the same
              standard before extending — the only difference is bulk
              shows it once at the top instead of N times. */}
          {requiresVerify ? (
            <div className="border-b border-border bg-[var(--color-priority-medium-bg)]/30 px-6 py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-priority-medium)]" />
                <div className="flex-1 text-xs">
                  <p className="font-semibold text-[var(--color-priority-medium)]">
                    Relief is county-specific
                  </p>
                  <p className="mt-1 text-foreground/80">
                    {affectedCounties.length > 0
                      ? "IRS relief applies only to taxpayers in these declared counties:"
                      : "We couldn't extract specific counties from the IRS text. Verify against the official release before applying."}
                  </p>
                  {affectedCounties.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {affectedCounties.map((c) => (
                        <Badge
                          key={c}
                          variant="outline"
                          className="bg-background text-[10px]"
                        >
                          {c}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <label className="mt-3 flex items-start gap-2 text-xs text-foreground/90 cursor-pointer">
                <Checkbox
                  checked={verified}
                  onCheckedChange={(v) => setVerified(v === true)}
                  className="mt-0.5"
                />
                <span>
                  I&apos;ve verified each selected client is in a declared
                  county.
                </span>
              </label>
            </div>
          ) : null}

          {/* Quick select-all / none + count summary. Dense single row
              so it doesn't crowd the list. */}
          <div className="flex items-center gap-3 border-b border-border bg-muted/20 px-6 py-2 text-xs">
            <span className="text-muted-foreground">
              {selectedCount} selected
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="text-primary hover:underline"
              >
                Select all
              </button>
              <span className="text-muted-foreground/40">·</span>
              <button
                type="button"
                onClick={selectNone}
                className="text-primary hover:underline"
              >
                Select none
              </button>
            </div>
          </div>

          {/* Scrollable client/deadline checklist */}
          <div className="flex-1 overflow-y-auto px-6 py-3">
            <ul className="space-y-3">
              {grouped.map((g) => {
                const allOn = g.rows.every((r) => selected.has(r.deadlineId));
                const someOn = g.rows.some((r) => selected.has(r.deadlineId));
                return (
                  <li key={g.clientId}>
                    <label className="mb-1.5 flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={allOn ? true : someOn ? "indeterminate" : false}
                        onCheckedChange={() => toggleClient(g.rows)}
                      />
                      <span className="text-sm font-semibold">
                        {g.clientName}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {g.rows.length}{" "}
                        {g.rows.length === 1 ? "deadline" : "deadlines"}
                      </span>
                    </label>
                    <ul className="ml-6 space-y-1">
                      {g.rows.map((d) => (
                        <li key={d.deadlineId}>
                          <label className="flex items-center gap-2 rounded-md py-1 cursor-pointer hover:bg-muted/40 px-1.5">
                            <Checkbox
                              checked={selected.has(d.deadlineId)}
                              onCheckedChange={() => toggle(d.deadlineId)}
                            />
                            <span className="font-mono text-xs font-semibold">
                              {d.formCode}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {humanDate(d.currentEffectiveDate)}
                            </span>
                            <span className="text-xs text-muted-foreground/60">
                              →
                            </span>
                            <span className="text-xs font-medium">
                              {humanDate(reliefDeadline)}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Result panel — only when a partial-failure summary needs
              surfacing (full-success closes the dialog automatically). */}
          {result && result.failed > 0 ? (
            <div className="border-t border-border bg-amber-50 px-6 py-3 text-xs dark:bg-amber-950/30">
              <p className="font-semibold text-amber-800 dark:text-amber-300">
                Applied {result.applied}, failed {result.failed}
              </p>
              {result.errors.slice(0, 3).map((err, i) => (
                <p
                  key={i}
                  className="mt-1 truncate font-mono text-[11px] text-amber-700/80 dark:text-amber-400/80"
                >
                  {err}
                </p>
              ))}
            </div>
          ) : null}

          <DialogFooter className="border-t border-border px-6 py-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={
                pending ||
                selectedCount === 0 ||
                (requiresVerify && !verified)
              }
            >
              {pending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Applying {selectedCount}…
                </>
              ) : (
                <>Apply {selectedCount} {selectedCount === 1 ? "deadline" : "deadlines"}</>
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function humanDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function humanShort(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
