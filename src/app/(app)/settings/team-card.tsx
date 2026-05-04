"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  Copy,
  LogOut,
  Mail,
  MoreHorizontal,
  Shield,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import {
  inviteTeamMemberAction,
  revokeInvitationAction,
  removeMemberAction,
  changeMemberRoleAction,
  type InviteResult,
} from "./actions";

export interface TeamMemberView {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string | null;
  role: "owner" | "admin" | "member";
  joinedAt: string;
  isCurrentUser: boolean;
}

export interface PendingInviteView {
  invitationId: string;
  email: string;
  role: "owner" | "admin" | "member";
  inviteUrl: string;
  expiresAt: string;
  createdAt: string;
}

export function TeamCard({
  members,
  pendingInvites,
  appUrl,
  viewerRole,
}: {
  members: TeamMemberView[];
  pendingInvites: PendingInviteView[];
  appUrl: string;
  /** Current user's role in this org — gates the per-row remove menu. */
  viewerRole: "owner" | "admin" | "member";
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Members</h3>
          <p className="text-sm text-muted-foreground">
            Anyone you invite can see and edit all clients, entities, and
            deadlines in this org.
          </p>
        </div>
        {canInvite(viewerRole) ? (
          <InviteDialog appUrl={appUrl} viewerRole={viewerRole} />
        ) : null}
      </div>

      <MembersList members={members} viewerRole={viewerRole} />

      {pendingInvites.length > 0 ? (
        <div className="space-y-3 border-t border-border pt-6">
          <h4 className="text-sm font-semibold">
            Pending invites ({pendingInvites.length})
          </h4>
          <PendingList invites={pendingInvites} />
        </div>
      ) : null}
    </div>
  );
}

function canRemove(args: {
  viewerRole: "owner" | "admin" | "member";
  targetRole: "owner" | "admin" | "member";
  isSelf: boolean;
}): boolean {
  if (args.isSelf) return true;
  if (args.viewerRole === "owner") return true;
  if (args.viewerRole === "admin") return args.targetRole === "member";
  return false;
}

/** Mirrors the server-side hierarchy rule in `services/team.ts` —
 *  actor must strictly outrank the target. Self-edit is always blocked. */
const ROLE_RANK: Record<"owner" | "admin" | "member", number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

/** Roles a given viewer is allowed to assign — strictly below their own.
 *  Owner can assign admin/member, admin can assign member, member can't
 *  assign anything. Returned in display order (highest first). */
function assignableRoles(
  viewerRole: "owner" | "admin" | "member",
): Array<"owner" | "admin" | "member"> {
  if (viewerRole === "owner") return ["admin", "member"];
  if (viewerRole === "admin") return ["member"];
  return [];
}

function canChangeRole(args: {
  viewerRole: "owner" | "admin" | "member";
  targetRole: "owner" | "admin" | "member";
  isSelf: boolean;
}): boolean {
  if (args.isSelf) return false;
  if (ROLE_RANK[args.viewerRole] <= ROLE_RANK[args.targetRole]) return false;
  // Hide the menu when the viewer has no role they could assign that
  // would actually change the target's role. Without this, an admin
  // looking at a member sees a "Change role" item whose only option is
  // "Member" (current) — wasted click.
  return assignableRoles(args.viewerRole).some((r) => r !== args.targetRole);
}

function canInvite(viewerRole: "owner" | "admin" | "member"): boolean {
  return viewerRole === "owner" || viewerRole === "admin";
}

// Avatar palette — soft tints that hold up against the muted Salesforce
// Lightning canvas without making the team list look like a kid's app.
// Email is hashed mod palette so two members with identical names still
// land on different colors.
const AVATAR_PALETTE = [
  { bg: "bg-blue-100", text: "text-blue-700" },
  { bg: "bg-emerald-100", text: "text-emerald-700" },
  { bg: "bg-amber-100", text: "text-amber-700" },
  { bg: "bg-rose-100", text: "text-rose-700" },
  { bg: "bg-violet-100", text: "text-violet-700" },
  { bg: "bg-cyan-100", text: "text-cyan-700" },
  { bg: "bg-orange-100", text: "text-orange-700" },
] as const;

function avatarColor(seed: string): (typeof AVATAR_PALETTE)[number] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function memberInitials(fullName: string | null, email: string): string {
  if (fullName) {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].slice(0, 2).toUpperCase();
    }
  }
  return email.slice(0, 2).toUpperCase();
}

function MembersList({
  members,
  viewerRole,
}: {
  members: TeamMemberView[];
  viewerRole: "owner" | "admin" | "member";
}) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {members.map((m) => {
        const showRemove = canRemove({
          viewerRole,
          targetRole: m.role,
          isSelf: m.isCurrentUser,
        });
        const showRoleChange = canChangeRole({
          viewerRole,
          targetRole: m.role,
          isSelf: m.isCurrentUser,
        });
        const showMenu = showRemove || showRoleChange;
        const palette = avatarColor(m.email);
        return (
          <li
            key={m.membershipId}
            className="flex items-center gap-3 px-3 py-2.5"
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${palette.bg} ${palette.text}`}
            >
              {memberInitials(m.fullName, m.email)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="truncate text-sm font-medium">
                  {m.fullName ?? m.email.split("@")[0]}
                </span>
                {m.isCurrentUser ? (
                  <span className="text-xs text-muted-foreground">(you)</span>
                ) : null}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {m.email}
              </div>
            </div>
            <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
              {m.role}
            </Badge>
            {showMenu ? (
              <MemberRowMenu
                member={m}
                viewerRole={viewerRole}
                canRemove={showRemove}
                canChangeRole={showRoleChange}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function MemberRowMenu({
  member,
  viewerRole,
  canRemove,
  canChangeRole,
}: {
  member: TeamMemberView;
  viewerRole: "owner" | "admin" | "member";
  canRemove: boolean;
  canChangeRole: boolean;
}) {
  const [removeOpen, setRemoveOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);

  const isSelf = member.isCurrentUser;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            aria-label={`Actions for ${member.fullName ?? member.email}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canChangeRole ? (
            <DropdownMenuItem onClick={() => setRoleOpen(true)}>
              <Shield className="h-4 w-4" /> Change role
            </DropdownMenuItem>
          ) : null}
          {canRemove ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setRemoveOpen(true)}
            >
              {isSelf ? (
                <LogOut className="h-4 w-4" />
              ) : (
                <UserMinus className="h-4 w-4" />
              )}
              {isSelf ? "Leave workspace" : "Remove member"}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {canRemove ? (
        <RemoveConfirmDialog
          member={member}
          open={removeOpen}
          onOpenChange={setRemoveOpen}
        />
      ) : null}

      {canChangeRole ? (
        <ChangeRoleDialog
          member={member}
          viewerRole={viewerRole}
          open={roleOpen}
          onOpenChange={setRoleOpen}
        />
      ) : null}
    </>
  );
}

function RemoveConfirmDialog({
  member,
  open,
  onOpenChange,
}: {
  member: TeamMemberView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const isSelf = member.isCurrentUser;

  const dialogTitle = isSelf
    ? "Leave this workspace?"
    : `Remove ${member.fullName ?? member.email}?`;
  const dialogBody = isSelf
    ? "You'll lose access to this workspace's clients, entities, and deadlines. Anyone with admin access can re-invite you later."
    : "They'll lose access immediately. Their work history (audit log) is preserved, but they won't be able to see or edit anything in this workspace.";

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await removeMemberAction(member.membershipId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onOpenChange(false);
      if (isSelf) {
        router.push("/dashboard");
        router.refresh();
      } else {
        router.refresh();
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
          <AlertDialogDescription>{dialogBody}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? "…" : isSelf ? "Leave" : "Remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const ROLE_DESCRIPTIONS: Record<
  "owner" | "admin" | "member",
  string
> = {
  owner: "Full control over the workspace.",
  admin: "Manage members and invitations.",
  member: "View and edit workspace data.",
};

function ChangeRoleDialog({
  member,
  viewerRole,
  open,
  onOpenChange,
}: {
  member: TeamMemberView;
  viewerRole: "owner" | "admin" | "member";
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  // Roles this viewer is allowed to assign — strictly below their own.
  // The current target role is included in the dropdown for visual
  // consistency (showing "Member" already-selected for a member target),
  // even when it'd be a no-op assignment.
  const allowedRoles = assignableRoles(viewerRole);
  const roleOptions = allowedRoles.includes(member.role)
    ? allowedRoles
    : [member.role, ...allowedRoles];

  const [newRole, setNewRole] = useState<"owner" | "admin" | "member">(
    member.role,
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Reset internal state when the dialog re-opens for the same row but
  // the row's role has changed (e.g., another tab promoted them).
  function handleOpenChange(o: boolean) {
    if (o) setNewRole(member.role);
    setError(null);
    onOpenChange(o);
  }

  function handleSave() {
    if (newRole === member.role) {
      onOpenChange(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await changeMemberRoleAction(
        member.membershipId,
        newRole,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Change role for {member.fullName ?? member.email}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-3">
          <div className="flex items-center gap-3">
            <Label htmlFor="member-role" className="w-12 shrink-0">
              Role
            </Label>
            <Select
              value={newRole}
              onValueChange={(v) =>
                setNewRole(v as "owner" | "admin" | "member")
              }
            >
              <SelectTrigger id="member-role" className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r === "owner" ? "Owner" : r === "admin" ? "Admin" : "Member"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {ROLE_DESCRIPTIONS[newRole]}
            </p>
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={pending || newRole === member.role}
            className=""
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PendingList({ invites }: { invites: PendingInviteView[] }) {
  return (
    <ul className="divide-y divide-border rounded-md border border-dashed border-border">
      {invites.map((inv) => (
        <PendingRow key={inv.invitationId} invite={inv} />
      ))}
    </ul>
  );
}

function PendingRow({ invite }: { invite: PendingInviteView }) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function copy() {
    await navigator.clipboard.writeText(invite.inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function revoke() {
    startTransition(async () => {
      await revokeInvitationAction(invite.invitationId);
      router.refresh();
    });
  }

  const expiresIn = relativeFromNow(invite.expiresAt);

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Mail
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{invite.email}</div>
        <div className="text-xs text-muted-foreground">
          {invite.role} · expires {expiresIn}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={copy}
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5" /> Copied
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" /> Copy link
          </>
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        onClick={revoke}
        disabled={pending}
        aria-label="Revoke invitation"
      >
        <X className="h-4 w-4" />
      </Button>
    </li>
  );
}

function InviteDialog({
  appUrl,
  viewerRole,
}: {
  appUrl: string;
  viewerRole: "owner" | "admin" | "member";
}) {
  // Roles this viewer is allowed to invite — admins can only invite
  // members; owners can invite admin or member. Server enforces too.
  const inviteOptions = (assignableRoles(viewerRole).filter(
    (r) => r === "admin" || r === "member",
  ) as Array<"admin" | "member">);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">(
    inviteOptions[inviteOptions.length - 1] ?? "member",
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [issuedEmail, setIssuedEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  function reset() {
    setEmail("");
    setRole("member");
    setError(null);
    setIssuedToken(null);
    setIssuedEmail(null);
    setCopied(false);
  }

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result: InviteResult = await inviteTeamMemberAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setIssuedToken(result.token);
      setIssuedEmail(email);
      router.refresh();
    });
  }

  const inviteUrl = issuedToken
    ? `${appUrl.replace(/\/$/, "")}/invite/${issuedToken}`
    : "";

  async function copy() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="shrink-0">
          <UserPlus className="h-4 w-4" /> Invite teammate
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {issuedToken ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Invite link ready</DialogTitle>
              <DialogDescription>
                Send to <strong>{issuedEmail}</strong>. Expires in 7 days.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border border-border bg-muted/40 p-3 font-mono text-xs break-all">
              {inviteUrl}
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  reset();
                }}
              >
                Invite another
              </Button>
              <Button
                type="button"
                onClick={copy}
                className=""
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" /> Copy link
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={submit}>
            <DialogHeader>
              <DialogTitle>Invite a teammate</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  required
                  placeholder="teammate@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v as "admin" | "member")}
                >
                  <SelectTrigger id="invite-role" name="role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {inviteOptions.includes("member") ? (
                      <SelectItem value="member">
                        Member — view and edit workspace data
                      </SelectItem>
                    ) : null}
                    {inviteOptions.includes("admin") ? (
                      <SelectItem value="admin">
                        Admin — also manage members
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
                <input type="hidden" name="role" value={role} />
              </div>

              {error ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending || !email.trim()}
                className=""
              >
                {pending ? "Generating…" : "Generate invite link"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function relativeFromNow(iso: string): string {
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = target - now;
  if (diffMs <= 0) return "expired";
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) {
    const hours = Math.round(diffMs / (1000 * 60 * 60));
    return `in ${hours}h`;
  }
  if (days === 1) return "tomorrow";
  return `in ${days}d`;
}
