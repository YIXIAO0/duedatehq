"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { Textarea } from "@/components/ui/textarea";
import {
  MoreHorizontal,
  Pencil,
  Archive,
  Loader2,
  FileText,
} from "lucide-react";
import { updateClientAction, archiveClientAction } from "./edit-actions";

export function ClientActions({
  client,
}: {
  client: {
    id: string;
    name: string;
    primaryContactEmail: string | null;
    primaryContactPhone: string | null;
    notes: string | null;
  };
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            {/* Calendar PDF lives in here now — it's a 1-2x/year action
                (engagement-letter time), doesn't deserve its own button
                competing with the page title. */}
            <a
              href={`/api/export/clients/${client.id}/calendar.pdf?taxYear=${new Date().getFullYear()}`}
              download
            >
              <FileText className="mr-2 h-4 w-4" /> Download calendar PDF
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" /> Edit client
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
        <DialogContent className="sm:max-w-lg">
          <form
            action={async (fd) => {
              await updateClientAction(fd);
              setEditOpen(false);
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit client</DialogTitle>
              <DialogDescription>
                Update the client&apos;s details. Changes are reflected
                immediately.
              </DialogDescription>
            </DialogHeader>

            <input type="hidden" name="id" value={client.id} />

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Client name *</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  defaultValue={client.name}
                  maxLength={200}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="primaryContactEmail">Contact email</Label>
                  <Input
                    id="primaryContactEmail"
                    name="primaryContactEmail"
                    type="email"
                    defaultValue={client.primaryContactEmail ?? ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="primaryContactPhone">Phone</Label>
                  <Input
                    id="primaryContactPhone"
                    name="primaryContactPhone"
                    defaultValue={client.primaryContactPhone ?? ""}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  defaultValue={client.notes ?? ""}
                  maxLength={2000}
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
              Archive &ldquo;{client.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The client, its entities, and their deadlines will be hidden from
              your active lists. Data is preserved — you can contact support to
              un-archive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await archiveClientAction(client.id);
                  router.push("/clients");
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
