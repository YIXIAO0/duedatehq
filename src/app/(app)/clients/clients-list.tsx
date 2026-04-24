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
import { Users, Merge, X, AlertCircle, ArrowRight } from "lucide-react";
import { mergeClientsAction } from "./actions";
import type { ClientWithEntityCount } from "@/lib/services/clients";

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
  const inner = (
    <div className="flex items-center gap-4">
      {mergeMode ? (
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelected}
          aria-label={`Select ${client.name}`}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Users className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate font-medium">{client.name}</div>
          {client.entityCount > 0 ? (
            <Badge variant="outline" className="text-[11px]">
              {client.entityCount}{" "}
              {client.entityCount === 1 ? "entity" : "entities"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[11px] text-amber-700">
              No entities
            </Badge>
          )}
        </div>
        {client.primaryContactEmail ? (
          <div className="text-xs text-muted-foreground">
            {client.primaryContactEmail}
          </div>
        ) : null}
      </div>
      <div className="hidden text-sm text-muted-foreground sm:block">
        Added {client.createdAt.toLocaleDateString()}
      </div>
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
