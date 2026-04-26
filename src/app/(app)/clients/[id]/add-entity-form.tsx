import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createEntityAction } from "../actions";

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

// Common FYE choices. The seven options cover ~99% of US entities —
// most are calendar year (Dec 31), and "natural business years" of
// Jun 30 / Sep 30 / Mar 31 cover the rest. Free-form would let CPAs
// pick weird dates but we'd have to handle Feb 29 + last-day-of-month
// math more carefully. Stick with the standard choices.
const FYE_OPTIONS = [
  { value: "12-31", label: "Dec 31 — Calendar year (most common)" },
  { value: "06-30", label: "Jun 30 — Common for C-corps" },
  { value: "03-31", label: "Mar 31" },
  { value: "09-30", label: "Sep 30" },
  { value: "01-31", label: "Jan 31" },
  { value: "10-31", label: "Oct 31" },
  { value: "11-30", label: "Nov 30" },
];

export function AddEntityForm({ clientId }: { clientId: string }) {
  return (
    <form action={createEntityAction}>
      <input type="hidden" name="clientId" value={clientId} />
      <Card>
        <CardContent className="space-y-5 pt-6">
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
              <Select name="entityType" defaultValue="individual" required>
                <SelectTrigger id="entityType">
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
                <SelectTrigger id="homeState">
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
                <SelectTrigger id="fiscalYearEnd">
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
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit">
            Create entity & generate deadlines
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
