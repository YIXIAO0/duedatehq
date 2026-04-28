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
      {/* IMPORTANT: must use `sm:max-w-3xl` (not bare `max-w-3xl`) —
          shadcn's DialogContent default class includes `sm:max-w-sm`
          (384px) which is more specific than an unprefixed `max-w-*`
          at sm+ screens, so a plain `max-w-3xl` gets stomped on
          desktop. The `sm:` prefix matches the same breakpoint and
          overrides cleanly via tailwind-merge.
          3xl (768px) gives each form column ~350px so placeholders
          ("Smith Holdings LLC", "Dec 31 — Calendar year (most common)")
          stop truncating. */}
      <DialogContent className="max-h-[90vh] sm:max-w-3xl overflow-y-auto">
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
