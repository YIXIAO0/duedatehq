"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { AddEntityForm } from "./add-entity-form";
import type { ServiceGroup } from "@/lib/db/schema";

/**
 * Progressive disclosure for the "Add tax entity" form.
 *
 * Previously the form was always rendered fully expanded — for a CPA
 * landing on a client page, that's a wall of inputs (entity name,
 * type, home state, operating states, EIN, FYE, services picker)
 * before they've even decided they want to add anything. Collapsed-
 * by-default removes that pressure: the page leads with the existing
 * entities and deadlines (the actual content), and the form is one
 * click away when needed.
 */
export function AddEntityCollapser({
  clientId,
  services,
}: {
  clientId: string;
  services: ServiceGroup[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="w-full justify-center sm:w-auto"
      >
        <Plus className="mr-2 h-4 w-4" /> Add a tax entity
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Add a tax entity</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          <X className="mr-1 h-4 w-4" /> Cancel
        </Button>
      </div>
      <AddEntityForm clientId={clientId} services={services} />
    </div>
  );
}
