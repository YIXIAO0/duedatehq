"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoreHorizontal, Pencil, Trash2, Loader2 } from "lucide-react";
import { updateEntityAction, archiveEntityAction } from "./edit-actions";
import type { ServiceGroup } from "@/lib/db/schema";
import { StateCombobox } from "@/components/ui/state-combobox";

const ENTITY_TYPE_OPTIONS = [
  { value: "individual", label: "Individual (1040)" },
  { value: "s_corp", label: "S-Corporation (1120-S)" },
  { value: "c_corp", label: "C-Corporation (1120)" },
  { value: "partnership", label: "Partnership (1065)" },
  { value: "llc", label: "LLC" },
  { value: "trust", label: "Trust (1041)" },
  { value: "estate", label: "Estate (1041)" },
  { value: "nonprofit", label: "Nonprofit (990)" },
];

export function EntityActions({
  entity,
  availableServices,
}: {
  entity: {
    id: string;
    name: string;
    entityType: string;
    homeState: string | null;
    operatingStates: string[];
    ein: string | null;
    fiscalYearEnd: string;
    activeServiceIds: string[];
  };
  availableServices: ServiceGroup[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, startTransition] = useTransition();
  const canDelete = confirmText.trim() === entity.name;
  const [checkedServiceIds, setCheckedServiceIds] = useState<string[]>(
    entity.activeServiceIds,
  );
  // Combobox is controlled; mirror its value into a hidden input so the
  // server action's FormData reads `homeState` like before.
  const [homeState, setHomeState] = useState<string | undefined>(
    entity.homeState ?? undefined,
  );
  const toggleService = (id: string) => {
    setCheckedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" /> Edit entity
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setConfirmText("");
              setDeleteOpen(true);
            }}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" /> Delete entity
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-2xl">
          <form
            action={async (fd) => {
              await updateEntityAction(fd);
              setEditOpen(false);
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit entity</DialogTitle>
              <DialogDescription>
                Type or state changes won&apos;t regenerate existing deadlines.
              </DialogDescription>
            </DialogHeader>

            <input type="hidden" name="id" value={entity.id} />

            <div className="space-y-4 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Entity name *</Label>
                  <Input
                    id="name"
                    name="name"
                    required
                    defaultValue={entity.name}
                    maxLength={200}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="entityType">Entity type *</Label>
                  <Select
                    name="entityType"
                    defaultValue={entity.entityType}
                    required
                  >
                    <SelectTrigger id="entityType" className="w-full">
                      <SelectValue />
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
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="homeState">Home state</Label>
                  <input
                    type="hidden"
                    name="homeState"
                    value={homeState ?? ""}
                  />
                  <StateCombobox
                    id="homeState"
                    value={homeState}
                    onChange={setHomeState}
                    placeholder="None"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="operatingStates">Operating states</Label>
                  <Input
                    id="operatingStates"
                    name="operatingStates"
                    placeholder="CA, NY, TX"
                    defaultValue={entity.operatingStates.join(", ")}
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ein">EIN / SSN</Label>
                  <Input
                    id="ein"
                    name="ein"
                    defaultValue={entity.ein ?? ""}
                    maxLength={20}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fiscalYearEnd">Fiscal year end</Label>
                  <Select
                    name="fiscalYearEnd"
                    defaultValue={entity.fiscalYearEnd || "12-31"}
                  >
                    <SelectTrigger id="fiscalYearEnd" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="12-31">Dec 31 — Calendar year</SelectItem>
                      <SelectItem value="06-30">Jun 30</SelectItem>
                      <SelectItem value="03-31">Mar 31</SelectItem>
                      <SelectItem value="09-30">Sep 30</SelectItem>
                      <SelectItem value="01-31">Jan 31</SelectItem>
                      <SelectItem value="10-31">Oct 31</SelectItem>
                      <SelectItem value="11-30">Nov 30</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Service-group editor. Re-checks regenerate the
                  deadline list for newly-added services on save —
                  removed services don't delete existing instances
                  (they keep their status/notes/audit history). */}
              <div className="space-y-2 border-t border-border pt-4">
                <Label>Services</Label>
                <p className="text-xs text-muted-foreground">
                  Adding a service generates its deadlines for the
                  current and next tax year. Removing one stops adding
                  new deadlines but doesn&apos;t delete existing ones.
                </p>
                <div className="grid gap-2 pt-1 sm:grid-cols-2">
                  {availableServices.map((s) => {
                    const checked = checkedServiceIds.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 transition-colors ${
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
                        <span className="text-xs font-medium">{s.name}</span>
                      </label>
                    );
                  })}
                </div>
                {/* Hidden inputs feed the form's serviceGroupIds[]. */}
                {checkedServiceIds.map((id) => (
                  <input
                    key={id}
                    type="hidden"
                    name="serviceGroupIds"
                    value={id}
                  />
                ))}
                {/* Marker so the server action can distinguish "form
                    rendered the picker (use checkboxes)" from "form
                    didn't (don't touch services)". Without this, an
                    edit that simply doesn't expose services would
                    blast all assignments. */}
                <input type="hidden" name="hasServicePicker" value="1" />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Save changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{entity.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the entity and all its deadlines. The client stays.
              This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="confirm-entity-name" className="text-sm">
              Type{" "}
              <span className="font-mono font-semibold">{entity.name}</span>{" "}
              to confirm.
            </Label>
            <Input
              id="confirm-entity-name"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={pending}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending || !canDelete}
              onClick={() =>
                startTransition(async () => {
                  await archiveEntityAction(entity.id);
                  setDeleteOpen(false);
                })
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Deleting…
                </>
              ) : (
                "Delete entity"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
