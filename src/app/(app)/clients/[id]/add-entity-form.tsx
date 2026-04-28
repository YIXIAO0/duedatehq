"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { createEntityAction } from "../actions";
import type { ServiceGroup } from "@/lib/db/schema";

const ENTITY_TYPE_OPTIONS = [
  { value: "individual", label: "Individual (1040)" },
  { value: "s_corp", label: "S-Corporation (1120-S)" },
  { value: "c_corp", label: "C-Corporation (1120)" },
  { value: "partnership", label: "Partnership (1065)" },
  { value: "llc", label: "LLC (taxed as partnership)" },
  { value: "trust", label: "Trust (1041)" },
  { value: "estate", label: "Estate (1041)" },
  { value: "nonprofit", label: "Nonprofit (990)" },
];

// Supported states for MVP (matches seed data coverage)
const SUPPORTED_STATES = [
  { value: "CA", label: "California" },
  { value: "NY", label: "New York" },
  { value: "TX", label: "Texas" },
  { value: "DE", label: "Delaware" },
  { value: "NJ", label: "New Jersey" },
];

const FYE_OPTIONS = [
  { value: "12-31", label: "Dec 31 — Calendar year (most common)" },
  { value: "06-30", label: "Jun 30 — Common for C-corps" },
  { value: "03-31", label: "Mar 31" },
  { value: "09-30", label: "Sep 30" },
  { value: "01-31", label: "Jan 31" },
  { value: "10-31", label: "Oct 31" },
  { value: "11-30", label: "Nov 30" },
];

export function AddEntityForm({
  clientId,
  services,
  onSubmitted,
}: {
  clientId: string;
  services: ServiceGroup[];
  /** Fired after the server action resolves successfully. The dialog
   *  wrapper uses this to close itself; standalone callers can leave
   *  it unset. */
  onSubmitted?: () => void;
}) {
  // Form is now a client component so the service picker can react
  // to entity-type changes — picking "C-Corp" auto-checks "C-Corp Tax
  // Filing", picking "Individual" swaps to "Personal Tax Filing".
  const [entityType, setEntityType] = useState("individual");

  // Defaults for the currently-selected type. Memoized so the effect
  // below has a stable dependency.
  const defaultServiceIds = useMemo(
    () =>
      services
        .filter((s) => (s.defaultForEntityTypes ?? []).includes(entityType))
        .map((s) => s.id),
    [services, entityType],
  );

  // The "store previous prop in state" pattern — React's recommended
  // way to reset state when an input changes, without useEffect:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  // When entityType flips, we snap the checks to that type's
  // defaults. Overwrites any manual edits — intentional: a CPA who
  // picks "Individual" then switches to "C-Corp" almost certainly
  // wants the C-Corp defaults, not the Individual checks they had.
  const [trackedEntityType, setTrackedEntityType] = useState(entityType);
  const [checkedServiceIds, setCheckedServiceIds] = useState<string[]>(
    defaultServiceIds,
  );
  if (trackedEntityType !== entityType) {
    setTrackedEntityType(entityType);
    setCheckedServiceIds(defaultServiceIds);
  }

  const toggleService = (id: string) => {
    setCheckedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <form
      action={async (fd) => {
        await createEntityAction(fd);
        onSubmitted?.();
      }}
    >
      <input type="hidden" name="clientId" value={clientId} />
      {/* Hidden inputs (one per checked service) so the FormData
          submitted to the server action carries the full selection.
          Using "name=serviceGroupIds[]" + multiple values is the
          form-encoding convention; FormData.getAll() reads them all. */}
      {checkedServiceIds.map((id) => (
        <input key={id} type="hidden" name="serviceGroupIds" value={id} />
      ))}

      <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Entity name *</Label>
              <Input
                id="name"
                name="name"
                required
                placeholder='e.g. "John Smith" or "Smith Holdings LLC"'
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entityType">Entity type *</Label>
              <Select
                name="entityType"
                value={entityType}
                onValueChange={setEntityType}
                required
              >
                <SelectTrigger id="entityType" className="w-full">
                  <SelectValue placeholder="Select entity type" />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="homeState">Home / domicile state</Label>
              <Select name="homeState">
                <SelectTrigger id="homeState" className="w-full">
                  <SelectValue placeholder="Select home state (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_STATES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.value} — {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                For individuals, this is where they live. For entities, where
                they&apos;re organized.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="operatingStates">Other operating states</Label>
              <Input
                id="operatingStates"
                name="operatingStates"
                placeholder="CA, NY, TX"
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated 2-letter codes. Leave blank if single-state.
              </p>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ein">EIN / SSN (optional)</Label>
              <Input
                id="ein"
                name="ein"
                placeholder="XX-XXXXXXX"
                maxLength={20}
              />
              <p className="text-xs text-muted-foreground">
                Not required — used only for your reference.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fiscalYearEnd">Fiscal year end</Label>
              <Select name="fiscalYearEnd" defaultValue="12-31">
                <SelectTrigger id="fiscalYearEnd" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FYE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Drives 1120 / 1120-S / 1065 / 1041 / 990 due dates. Most
                entities are calendar year — change only if this client
                explicitly elected otherwise.
              </p>
            </div>
          </div>

          {/* Service picker — what the CPA is filing for this entity.
              Defaults to the entity-type's natural bundle but the
              CPA can add Quarterly Payroll for an employer client,
              or remove the default for unusual cases. */}
          <div className="space-y-2 border-t border-border pt-5">
            <Label>Services</Label>
            <p className="text-xs text-muted-foreground">
              Pick which filings to track. Defaults are pre-checked
              based on entity type — add more for clients with payroll,
              retirement plans, or special elections.
            </p>
            <div className="grid gap-2 pt-2 sm:grid-cols-2">
              {services.map((s) => {
                const checked = checkedServiceIds.includes(s.id);
                const isDefault = (s.defaultForEntityTypes ?? []).includes(
                  entityType,
                );
                return (
                  <label
                    key={s.id}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors ${
                      checked
                        ? "border-primary/40 bg-primary/5"
                        : "border-border bg-background hover:bg-muted/30"
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleService(s.id)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        {s.name}
                        {isDefault ? (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                            Default
                          </span>
                        ) : null}
                      </div>
                      {s.description ? (
                        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                          {s.description}
                        </p>
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </div>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
        <Button type="submit">Create entity & generate deadlines</Button>
      </div>
    </form>
  );
}
