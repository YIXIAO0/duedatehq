"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  Mail,
  Phone,
  MoreHorizontal,
  Star,
  Pencil,
  Archive,
  Loader2,
  Bell,
  BellOff,
} from "lucide-react";
import {
  createContactAction,
  updateContactAction,
  archiveContactAction,
  setPrimaryAction,
} from "./contact-actions";
import type { ClientContact } from "@/lib/db/schema";

/**
 * Contacts section for /clients/[id]. List of all active contacts with
 * a primary star, role chip, mailto/tel links, and per-contact actions
 * (edit / set as primary / archive). One Add button.
 *
 * Ordering: priority asc, then createdAt asc — primary always at top.
 */
export function ContactsSection({
  clientId,
  contacts,
}: {
  clientId: string;
  contacts: ClientContact[];
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Contacts{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({contacts.length})
          </span>
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" /> Add contact
        </Button>
      </div>

      {contacts.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
          No contacts yet. Add one so the email cron knows where to send
          reminders.
        </div>
      ) : (
        <div className="space-y-2">
          {contacts.map((c) => (
            <ContactRow key={c.id} contact={c} clientId={clientId} />
          ))}
        </div>
      )}

      <ContactDialog
        mode="create"
        open={addOpen}
        onOpenChange={setAddOpen}
        clientId={clientId}
      />
    </section>
  );
}

function ContactRow({
  contact,
  clientId,
}: {
  contact: ClientContact;
  clientId: string;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const isPrimary = contact.priority === 0;

  return (
    <>
      <div
        className={`flex items-center gap-3 rounded-lg border p-3 ${
          isPrimary
            ? "border-primary/30 bg-primary/5"
            : "border-border bg-card"
        }`}
      >
        {/* Primary star — visible if primary; click to flip if not */}
        {isPrimary ? (
          <div
            className="shrink-0 text-primary"
            aria-label="Primary contact"
            title="Primary contact"
          >
            <Star className="h-4 w-4 fill-current" />
          </div>
        ) : (
          <div className="h-4 w-4 shrink-0" aria-hidden />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">
              {contact.name || contact.email || contact.phone || "Unnamed"}
            </span>
            {contact.role ? (
              <Badge variant="outline" className="text-[10px]">
                {contact.role}
              </Badge>
            ) : null}
            {isPrimary ? (
              <Badge className="bg-primary/15 text-[10px] text-primary hover:bg-primary/15">
                Primary
              </Badge>
            ) : null}
            {!contact.receivesReminders ? (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] text-muted-foreground"
              >
                <BellOff className="h-2.5 w-2.5" /> No reminders
              </Badge>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {contact.email ? (
              <a
                href={`mailto:${contact.email}`}
                className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
              >
                <Mail className="h-3 w-3" />
                {contact.email}
              </a>
            ) : null}
            {contact.phone ? (
              <a
                href={`tel:${contact.phone}`}
                className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
              >
                <Phone className="h-3 w-3" />
                {contact.phone}
              </a>
            ) : null}
          </div>
          {contact.notes ? (
            <div className="mt-1 truncate text-xs text-foreground/70">
              {contact.notes}
            </div>
          ) : null}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={pending}>
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreHorizontal className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
            {!isPrimary ? (
              <DropdownMenuItem
                onClick={() =>
                  startTransition(async () => {
                    await setPrimaryAction({
                      id: contact.id,
                      clientId,
                    });
                  })
                }
              >
                <Star className="mr-2 h-4 w-4" /> Set as primary
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setArchiveOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              <Archive className="mr-2 h-4 w-4" /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ContactDialog
        mode="edit"
        open={editOpen}
        onOpenChange={setEditOpen}
        clientId={clientId}
        contact={contact}
      />

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove this contact?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {contact.name || contact.email || "This contact"} will stop
              receiving reminders for {contact.role ? "this " + contact.role + " role" : "this client"}.
              {isPrimary
                ? " The next contact in the list will become the new primary."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await archiveContactAction({
                    id: contact.id,
                    clientId,
                  });
                  setArchiveOpen(false);
                })
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Removing…
                </>
              ) : (
                "Remove"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ContactDialog({
  mode,
  open,
  onOpenChange,
  clientId,
  contact,
}: {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  contact?: ClientContact;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-w-2xl (672px) instead of lg (512px) — at lg the Name/Role
          columns end up around 220px each and the placeholder
          "Owner, Bookkeeper, CFO…" truncates. 2xl gives each column
          ~300px which fits realistic role labels and longer email
          addresses without horizontal scrolling. */}
      <DialogContent className="max-w-2xl">
        <form
          action={async (fd) => {
            if (mode === "create") await createContactAction(fd);
            else await updateContactAction(fd);
            onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {mode === "create" ? "Add contact" : "Edit contact"}
            </DialogTitle>
            <DialogDescription>
              At least one of email or phone is required so we can reach
              this person.
            </DialogDescription>
          </DialogHeader>

          {mode === "create" ? (
            <input type="hidden" name="clientId" value={clientId} />
          ) : (
            <>
              <input type="hidden" name="id" value={contact!.id} />
              <input type="hidden" name="clientId" value={clientId} />
            </>
          )}

          <div className="space-y-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={contact?.name ?? ""}
                  maxLength={120}
                  placeholder="Sarah Johnson"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Input
                  id="role"
                  name="role"
                  defaultValue={contact?.role ?? ""}
                  maxLength={60}
                  placeholder="Owner, Bookkeeper, CFO…"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={contact?.email ?? ""}
                placeholder="sarah@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                name="phone"
                defaultValue={contact?.phone ?? ""}
                placeholder="(555) 555-1234"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                name="notes"
                rows={2}
                defaultValue={contact?.notes ?? ""}
                maxLength={2000}
                placeholder="Best to email after 5pm. Cc'd on all 1099 emails."
              />
            </div>
            {/* Receives reminders — Checkbox (radix) doesn't submit; mirror
                via a hidden input that updates on toggle. Initial value
                preserved on edit. */}
            <ReceivesRemindersField
              defaultChecked={contact?.receivesReminders ?? true}
            />
            {mode === "create" ? (
              <SetPrimaryField />
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">
              {mode === "create" ? "Add contact" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Small inline helpers — Radix Checkbox doesn't post a form value out
// of the box; we mirror state into a hidden input that does.
function ReceivesRemindersField({
  defaultChecked,
}: {
  defaultChecked: boolean;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => setChecked(v === true)}
      />
      <input
        type="hidden"
        name="receivesReminders"
        value={checked ? "on" : ""}
      />
      <div className="-mt-0.5">
        <div className="font-medium">
          <Bell className="mr-1 inline h-3.5 w-3.5" />
          Send deadline reminders to this contact
        </div>
        <div className="text-xs text-muted-foreground">
          When the email cron starts running (Round B), only contacts with
          this enabled will receive emails.
        </div>
      </div>
    </label>
  );
}

function SetPrimaryField() {
  const [checked, setChecked] = useState(false);
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => setChecked(v === true)}
      />
      <input type="hidden" name="setPrimary" value={checked ? "on" : ""} />
      <div className="-mt-0.5">
        <div className="font-medium">
          <Star className="mr-1 inline h-3.5 w-3.5" />
          Make this the primary contact
        </div>
        <div className="text-xs text-muted-foreground">
          The current primary will be demoted to secondary.
        </div>
      </div>
    </label>
  );
}
