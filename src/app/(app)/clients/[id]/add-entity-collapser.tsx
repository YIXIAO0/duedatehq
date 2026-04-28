"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { AddEntityForm } from "./add-entity-form";
import type { ServiceGroup } from "@/lib/db/schema";

/**
 * Modal-style trigger for the "Add a tax entity" flow. Single button
 * on the page; click pops a dialog with the full form. This matches
 * the create/edit symmetry we already have for entity edits (which
 * also use a Dialog) and keeps the page layout from being shoved
 * around by an inline-expanding form.
 *
 * `max-h-[90vh] overflow-y-auto` on DialogContent handles the case
 * where the form is taller than the viewport — common with the
 * services picker when 11 services are listed.
 */
export function AddEntityCollapser({
  clientId,
  services,
}: {
  clientId: string;
  services: ServiceGroup[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="mr-2 h-4 w-4" /> Add a tax entity
        </Button>
      </DialogTrigger>
      {/* max-w-3xl (768px) gives each form column ~350px after dialog
          padding — enough room that placeholders ("e.g. John Smith
          or Smith Holdings LLC", "Dec 31 — Calendar year (most common)")
          stop truncating and the helper text doesn't wrap into 4
          lines under each input. 2xl was too cramped. */}
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a tax entity</DialogTitle>
          <DialogDescription>
            Pick the entity type and the filings to track. We&apos;ll
            generate the deadlines automatically.
          </DialogDescription>
        </DialogHeader>
        <AddEntityForm
          clientId={clientId}
          services={services}
          onSubmitted={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
