"use client";

import { useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { paletteForClient, clientInitials } from "@/lib/utils/client-palette";
import { switchOrgAction } from "./workspace-actions";

export interface WorkspaceOption {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
}

/**
 * Strip the auto-generated " practice" suffix from a workspace name for
 * the sidebar trigger display. Solo orgs are auto-named "<full>'s practice"
 * (organizations.ts), and the trailing word eats most of the available
 * width — "Yi Xiao's practice" truncates to "Yi Xiao's pra..." in a 240px
 * sidebar, which is uglier than just showing "Yi Xiao's". Custom workspace
 * names (anything not matching the auto-pattern) pass through untouched.
 */
function shortDisplayName(name: string): string {
  return name.replace(/'s practice$/i, "'s");
}

/**
 * Workspace switcher for the sidebar. Renders a single-line row: avatar
 * + workspace name + chevron. Click opens a dropdown listing all the
 * user's orgs. Role label has been removed from the inline display —
 * it's available in Settings, and the trigger now matches the original
 * brand-row visual rhythm (icon + name, single line) the user prefers.
 *
 * Solo users (one membership) see a static row.
 *
 * Avatar color comes from paletteForClient(orgId), so two orgs with
 * IDENTICAL names (a real-world case during multi-workspace testing)
 * still get distinguishable avatar colors — that color is the only
 * disambiguator we surface; users can rename in Settings if it isn't
 * enough.
 */
export function WorkspaceSwitcher({
  current,
  options,
}: {
  current: WorkspaceOption;
  options: WorkspaceOption[];
}) {
  const [pending, startTransition] = useTransition();

  if (options.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-1.5 py-0.5">
        <Avatar option={current} />
        <div className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {shortDisplayName(current.name)}
        </div>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 rounded-xl px-1.5 py-0.5 text-left transition-colors hover:bg-white/50 disabled:opacity-60"
        disabled={pending}
        aria-label="Switch workspace"
      >
        <Avatar option={current} />
        <div className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {shortDisplayName(current.name)}
        </div>
        <ChevronsUpDown
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="min-w-[260px]"
      >
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
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
              className="flex items-center gap-2.5 px-2 py-1.5"
            >
              <Avatar option={opt} />
              <div
                className={`min-w-0 flex-1 truncate text-sm ${isCurrent ? "font-medium" : ""}`}
              >
                {opt.name}
              </div>
              {isCurrent ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Workspace avatar — round, soft-tinted, initials based on org name.
 * Color is hashed from the org id (NOT the name) so two orgs with the
 * exact same name still get different colors. Sized to match the user
 * avatar in the sidebar footer (h-7) so the two rows align visually.
 */
function Avatar({ option }: { option: WorkspaceOption }) {
  const palette = paletteForClient(option.id);
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold"
      style={{ background: palette.bg, color: palette.text }}
      aria-hidden
    >
      {clientInitials(option.name)}
    </span>
  );
}
