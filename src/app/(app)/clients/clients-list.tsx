"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Merge, X, AlertCircle, ArrowRight } from "lucide-react";
import { mergeClientsAction } from "./actions";
import type { ClientWithEntityCount } from "@/lib/services/clients";

// Initials + brand-tinted avatar bg, derived deterministically from
// the client name. Replaces the generic Users-icon avatar that made
// every row identical at a glance — initials let CPA pattern-match
// on familiar clients in long lists.
const AVATAR_PALETTE = [
  "bg-blue-100 text-blue-800",
  "bg-purple-100 text-purple-800",
  "bg-green-100 text-green-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-slate-200 text-slate-700",
  "bg-teal-100 text-teal-800",
  "bg-indigo-100 text-indigo-800",
] as const;

function avatarStyle(name: string): { initials: string; colorClass: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length >= 2
      ? `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase()
      : (words[0]?.slice(0, 2) ?? "?").toUpperCase();
  // Cheap deterministic hash — djb2-ish, sufficient for an 8-bucket
  // palette pick. Same name always yields the same color across
  // sessions and devices.
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const colorClass = AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
  return { initials: initials || "?", colorClass };
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  individual: "Individual",
  c_corp: "C-Corp",
  s_corp: "S-Corp",
  partnership: "Partnership",
  llc: "LLC",
  trust: "Trust",
  estate: "Estate",
  nonprofit: "Nonprofit",
};

function entityTypeLabel(type: string): string {
  return ENTITY_TYPE_LABELS[type] ?? type;
}

/** Days from today to an ISO YYYY-MM-DD date (negative = overdue). */
function daysUntil(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(iso + "T00:00:00");
  return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function relativeLabel(iso: string): string {
  const d = daysUntil(iso);
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d <= 30) return `in ${d}d`;
  if (d <= 90) return `in ${Math.round(d / 7)}w`;
  if (d <= 365) return `in ${Math.round(d / 30)}mo`;
  return `in ${Math.round(d / 365)}y`;
}

function urgencyTextClass(iso: string): string {
  const d = daysUntil(iso);
  if (d <= 3) return "text-[var(--color-priority-urgent)]";
  if (d <= 14) return "text-[var(--color-priority-high)]";
  if (d <= 30) return "text-[var(--color-priority-medium)]";
  if (d <= 90) return "text-emerald-600 dark:text-emerald-400";
  if (d <= 180) return "text-sky-600 dark:text-sky-400";
  return "text-muted-foreground";
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  // Include year if not the current year — keeps "Apr 15 '27" readable
  // without the year cluttering the common same-year case.
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "2-digit" }),
  });
}

export function ClientsList({ clients }: { clients: ClientWithEntityCount[] }) {
  const router = useRouter();
  const [mergeMode, setMergeMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);

  const selectedCount = selected.size;

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function enterMergeMode() {
    setMergeMode(true);
    setSelected(new Set());
  }
  function exitMergeMode() {
    setMergeMode(false);
    setSelected(new Set());
  }

  return (
    <>
      {/* Top action row (above the list). When NOT in merge mode, shows a
          hint + "Merge clients" toggle. When IN merge mode, it morphs into
          a sticky selection bar with the merge count + action buttons. */}
      {!mergeMode ? (
        <div className="mb-3 flex items-center justify-between rounded-md border border-border bg-muted/30 px-4 py-2 text-sm">
          <div className="text-muted-foreground">
            Have duplicates from an import?{" "}
            <span className="text-foreground">
              Merge them into one client with multiple entities.
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={enterMergeMode}
            className="h-8"
          >
            <Merge className="mr-2 h-3.5 w-3.5" /> Merge clients
          </Button>
        </div>
      ) : (
        <div className="sticky top-4 z-20 mb-3 flex items-center justify-between rounded-md border-2 border-primary bg-primary/5 px-4 py-2 text-sm shadow-sm">
          <div className="font-medium">
            {selectedCount === 0
              ? "Pick 2 or more clients to merge."
              : `${selectedCount} selected`}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setMergeDialogOpen(true)}
              disabled={selectedCount < 2}
              className="h-8"
            >
              <Merge className="mr-2 h-3.5 w-3.5" /> Merge {selectedCount}{" "}
              clients
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={exitMergeMode}
              className="h-8"
            >
              <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="divide-y divide-border rounded-lg border border-border">
        {clients.map((client) => (
          <ClientRow
            key={client.id}
            client={client}
            mergeMode={mergeMode}
            selected={selected.has(client.id)}
            onToggleSelected={() => toggleSelected(client.id)}
          />
        ))}
      </div>

      {/* key by the selection so when the user toggles a different set of
          clients, the dialog's internal state (primaryId, error) fully
          resets — avoids having to reach for useEffect resets. */}
      <MergeDialog
        key={Array.from(selected).sort().join(",")}
        open={mergeDialogOpen}
        onOpenChange={(open) => setMergeDialogOpen(open)}
        clients={clients.filter((c) => selected.has(c.id))}
        onDone={() => {
          setMergeDialogOpen(false);
          exitMergeMode();
          router.refresh();
        }}
      />
    </>
  );
}

function ClientRow({
  client,
  mergeMode,
  selected,
  onToggleSelected,
}: {
  client: ClientWithEntityCount;
  mergeMode: boolean;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  // When in merge mode, the whole row is a click target for toggle. When not
  // in merge mode, it's a Link to the client detail page. We render two
  // different wrappers to keep the semantics right for keyboard/screen-reader.
  const { initials, colorClass } = avatarStyle(client.name);
  const extraEntities = Math.max(0, client.entityCount - 1);
  const inner = (
    <div className="flex items-center gap-3">
      {mergeMode ? (
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelected}
          aria-label={`Select ${client.name}`}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${colorClass}`}
          aria-hidden
        >
          {initials}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-semibold">{client.name}</span>
          {/* Primary entity type + state as inline chips. For multi-
              entity clients, show "+N more" rather than pretending the
              first entity's type covers all of them. No-entity clients
              get an amber warning chip — that's a real "you should fix
              this" state, not just a count of zero. */}
          {client.entityCount === 0 ? (
            <Badge variant="outline" className="text-[11px] text-amber-700">
              No entities
            </Badge>
          ) : (
            <>
              {client.primaryEntityType ? (
                <Badge variant="outline" className="text-[11px]">
                  {entityTypeLabel(client.primaryEntityType)}
                </Badge>
              ) : null}
              {client.primaryHomeState ? (
                <Badge variant="outline" className="font-mono text-[11px]">
                  {client.primaryHomeState}
                </Badge>
              ) : null}
              {extraEntities > 0 ? (
                <Badge
                  variant="outline"
                  className="text-[11px] text-muted-foreground"
                >
                  +{extraEntities} more
                </Badge>
              ) : null}
            </>
          )}
        </div>
        {client.primaryContactEmail ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {client.primaryContactEmail}
          </div>
        ) : null}
      </div>
      {/* Right-side stat block — next deadline date + relative time
          (urgency-colored) + open count. Far more useful than the old
          standalone "16 OPEN" red number, which told the CPA the
          weight of the client but nothing about *when* they need to
          act. The relative chip ("Today" / "in 7w") carries the
          urgency tier; the date underneath gives the absolute anchor;
          the urgent count is highlighted only when non-zero. */}
      {client.activeDeadlineCount > 0 && client.nextDueDate ? (
        <div className="hidden shrink-0 text-right leading-tight sm:block">
          <div
            className={`font-mono text-[11px] font-bold uppercase tracking-wider ${urgencyTextClass(client.nextDueDate)}`}
          >
            {relativeLabel(client.nextDueDate)}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {formatShortDate(client.nextDueDate)} ·{" "}
            {client.urgentCount > 0 ? (
              <>
                <span className="font-semibold text-[var(--color-priority-urgent)]">
                  {client.urgentCount} urgent
                </span>{" "}
                of {client.activeDeadlineCount}
              </>
            ) : (
              <span>{client.activeDeadlineCount} open</span>
            )}
          </div>
        </div>
      ) : (
        <div className="hidden shrink-0 text-xs text-muted-foreground sm:block">
          {client.activeDeadlineCount === 0 && client.entityCount > 0
            ? "All clear"
            : `Added ${client.createdAt.toLocaleDateString()}`}
        </div>
      )}
    </div>
  );

  if (mergeMode) {
    return (
      <button
        type="button"
        onClick={onToggleSelected}
        className={`block w-full cursor-pointer px-5 py-4 text-left transition-colors ${
          selected ? "bg-primary/5" : "hover:bg-muted/40"
        }`}
      >
        {inner}
      </button>
    );
  }
  return (
    <Link
      href={`/clients/${client.id}`}
      className="block px-5 py-4 transition-colors hover:bg-muted/40"
    >
      {inner}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Merge dialog
//
// The merge is a destructive operation: the user picks one client to keep
// (the "primary"), and every other selected client gets deleted after its
// entities are reassigned to the primary. We surface every non-obvious
// consequence — entities moved, clients deleted, which contact info wins —
// so the CPA never has an "wait, where did that go?" moment after confirm.
// ---------------------------------------------------------------------------
function MergeDialog({
  open,
  onOpenChange,
  clients,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: ClientWithEntityCount[];
  onDone: () => void;
}) {
  // Default primary = the one with the most entities (if tied, the first).
  const defaultPrimaryId = useMemo(() => {
    if (clients.length === 0) return "";
    const sorted = [...clients].sort(
      (a, b) => b.entityCount - a.entityCount,
    );
    return sorted[0].id;
  }, [clients]);

  // Component is keyed by the selection set (see parent), so useState's
  // initial value IS correct on every fresh selection — no effect needed.
  const [primaryId, setPrimaryId] = useState(defaultPrimaryId);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const primary = clients.find((c) => c.id === primaryId);
  const toMerge = clients.filter((c) => c.id !== primaryId);
  const entitiesToMove = toMerge.reduce((sum, c) => sum + c.entityCount, 0);

  function handleConfirm() {
    if (!primary) return;
    setError(null);
    startSubmit(async () => {
      try {
        await mergeClientsAction({
          primaryId: primary.id,
          mergeIds: toMerge.map((c) => c.id),
        });
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Merge failed.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge {clients.length} clients</DialogTitle>
          <DialogDescription>
            Pick the client to keep. Its name, email, and notes stay. The
            others get deleted — but their entities (and all their deadlines)
            move to the one you keep.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-4 overflow-y-auto">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Keep this one
            </div>
            <RadioGroup
              value={primaryId}
              onValueChange={setPrimaryId}
              className="gap-1"
            >
              {clients.map((c) => (
                <label
                  key={c.id}
                  htmlFor={`primary-${c.id}`}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors ${
                    c.id === primaryId
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/30"
                  }`}
                >
                  <RadioGroupItem
                    id={`primary-${c.id}`}
                    value={c.id}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate font-medium">{c.name}</div>
                      <Badge variant="outline" className="text-[10px]">
                        {c.entityCount}{" "}
                        {c.entityCount === 1 ? "entity" : "entities"}
                      </Badge>
                    </div>
                    {c.primaryContactEmail ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {c.primaryContactEmail}
                      </div>
                    ) : null}
                  </div>
                </label>
              ))}
            </RadioGroup>
          </div>

          {primary && toMerge.length > 0 ? (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <ArrowRight className="h-3 w-3" /> What will happen
              </div>
              <ul className="space-y-1.5 text-sm">
                <li>
                  <strong>{primary.name}</strong> keeps its name, email, and
                  notes.
                </li>
                <li>
                  <strong>
                    {entitiesToMove}{" "}
                    {entitiesToMove === 1 ? "entity moves" : "entities move"}
                  </strong>{" "}
                  to {primary.name} (with all their deadlines).
                </li>
                <li>
                  <strong>
                    {toMerge.length}{" "}
                    {toMerge.length === 1
                      ? "client gets deleted"
                      : "clients get deleted"}
                  </strong>
                  : {toMerge.map((c) => c.name).join(", ")}.
                </li>
              </ul>
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting || !primary || toMerge.length === 0}
          >
            {submitting
              ? "Merging…"
              : `Merge into ${primary?.name ?? "…"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
