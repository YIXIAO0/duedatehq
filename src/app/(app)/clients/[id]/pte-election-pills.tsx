"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { togglePteElectionAction } from "./election-actions";

type Election = { jurisdictionCode: string; kind: string };

/**
 * Inline toggle pills under each PTE-eligible entity. Clicking a state
 * code marks/unmarks that entity as PTE-elected in that state, which
 * gates the visibility of the state's PTE deadline rules.
 *
 * Optimistic UI — local state flips immediately, server action runs
 * in a transition. Reverts on error. Repeat clicks during the in-flight
 * request are blocked via `pending`.
 */
export function PteElectionPills({
  entityId,
  clientId,
  eligibleJurisdictions,
  currentElections,
}: {
  entityId: string;
  clientId: string;
  eligibleJurisdictions: string[];
  currentElections: Election[];
}) {
  const initial = new Set(
    currentElections
      .filter((e) => e.kind === "pte")
      .map((e) => e.jurisdictionCode),
  );
  const [elected, setElected] = useState<Set<string>>(initial);
  const [pending, startTransition] = useTransition();
  const [loadingJurisdiction, setLoadingJurisdiction] = useState<string | null>(
    null,
  );

  if (eligibleJurisdictions.length === 0) return null;

  function toggle(jurisdictionCode: string) {
    const wasElected = elected.has(jurisdictionCode);
    const next = new Set(elected);
    if (wasElected) next.delete(jurisdictionCode);
    else next.add(jurisdictionCode);
    setElected(next);
    setLoadingJurisdiction(jurisdictionCode);

    startTransition(async () => {
      try {
        await togglePteElectionAction({
          entityId,
          clientId,
          jurisdictionCode,
          kind: "pte",
        });
      } catch {
        // Revert optimistic flip on failure.
        const revert = new Set(elected);
        if (wasElected) revert.add(jurisdictionCode);
        else revert.delete(jurisdictionCode);
        setElected(revert);
      } finally {
        setLoadingJurisdiction(null);
      }
    });
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span
        className="text-[11px] text-muted-foreground"
        title="Mark this entity as having made a Pass-Through Entity tax election in the listed states. Marked states surface their PTE deadline rules."
      >
        PTE election:
      </span>
      {eligibleJurisdictions.map((j) => {
        const isElected = elected.has(j);
        const isLoading = loadingJurisdiction === j;
        return (
          <button
            key={j}
            type="button"
            onClick={() => toggle(j)}
            disabled={pending}
            aria-pressed={isElected}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors disabled:cursor-wait",
              isElected
                ? "bg-foreground text-background hover:bg-foreground/85"
                : "border border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {isLoading ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : null}
            {j}
          </button>
        );
      })}
    </div>
  );
}
