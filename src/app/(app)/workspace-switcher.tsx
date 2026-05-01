"use client";

import { useTransition } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchOrgAction } from "./workspace-actions";

export interface WorkspaceOption {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
}

/**
 * Workspace dropdown in the app header. Solo users (1 membership) see a
 * static label — no menu chrome — so the chrome only shows up when it
 * earns its keep. Multi-org users get a dropdown listing every workspace
 * with a checkmark on the current one.
 *
 * Switching fires switchOrgAction which writes the active-org cookie
 * and redirects to /dashboard. We wrap it in useTransition so the trigger
 * dims while the round-trip is in flight (otherwise feels frozen).
 */
export function WorkspaceSwitcher({
  current,
  options,
}: {
  current: WorkspaceOption;
  options: WorkspaceOption[];
}) {
  const [pending, startTransition] = useTransition();

  // Solo case: skip the dropdown chrome. The org name still shows so the
  // user knows which workspace they're in, but there's nothing to pick.
  if (options.length <= 1) {
    return (
      <div className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground sm:flex">
        <Building2 className="h-3.5 w-3.5" aria-hidden />
        <span className="max-w-[140px] truncate">{current.name}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-sm hover:bg-muted/40 disabled:opacity-60"
        disabled={pending}
        aria-label="Switch workspace"
      >
        <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="max-w-[160px] truncate font-medium">
          {current.name}
        </span>
        <ChevronDown
          className="h-3 w-3 text-muted-foreground"
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((opt) => {
          const isCurrent = opt.id === current.id;
          return (
            <DropdownMenuItem
              key={opt.id}
              onClick={() => {
                if (isCurrent) return;
                startTransition(() => switchOrgAction(opt.id));
              }}
              className="flex items-start justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{opt.name}</div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {opt.role}
                </div>
              </div>
              {isCurrent ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
