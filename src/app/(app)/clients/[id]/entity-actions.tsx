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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoreHorizontal, Pencil, Archive, Loader2 } from "lucide-react";
import { updateEntityAction, archiveEntityAction } from "./edit-actions";

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

const SUPPORTED_STATES = ["CA", "NY", "TX", "DE", "NJ"];

export function EntityActions({
  entity,
}: {
  entity: {
    id: string;
    name: string;
    entityType: string;
    homeState: string | null;
    operatingStates: string[];
    ein: string | null;
  };
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [pending, startTransition] = useTransition();

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
            <Pencil className="mr-2 h-4 w-4" /> Edit entity
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setArchiveOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Archive className="mr-2 h-4 w-4" /> Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <form
            action={async (fd) => {
              await updateEntityAction(fd);
              setEditOpen(false);
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit entity</DialogTitle>
              <DialogDescription>
                Changing entity type or states doesn&apos;t regenerate
                deadlines automatically — contact support if you need that.
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
                    <SelectTrigger id="entityType">
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
                  <Select
                    name="homeState"
                    defaultValue={entity.homeState ?? ""}
                  >
                    <SelectTrigger id="homeState">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_STATES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
              <div className="space-y-2">
                <Label htmlFor="ein">EIN / SSN</Label>
                <Input
                  id="ein"
                  name="ein"
                  defaultValue={entity.ein ?? ""}
                  maxLength={20}
                />
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

      {/* Archive confirmation */}
      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Archive &ldquo;{entity.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This entity and its deadlines will be hidden from active lists.
              The client stays.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await archiveEntityAction(entity.id);
                  setArchiveOpen(false);
                })
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Archiving…
                </>
              ) : (
                "Archive"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
