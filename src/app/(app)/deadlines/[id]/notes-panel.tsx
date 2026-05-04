"use client";

import {
  createContext,
  useContext,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronRight, Plus, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateNotesAction } from "./actions";

/**
 * Notes panel — Variant D pattern (smart collapse).
 *
 * Single-column layout. Two render points kept in sync via context:
 *
 *   1. NotesPillSlot       — sits in the DUE DATE row, top-right.
 *      Visible only when notes is empty AND user isn't editing.
 *      Mirrors the "+ Add stage" pill in the PREP STAGES row.
 *
 *   2. NotesSectionSlot    — sits between due-date block and stages.
 *      Renders: nothing (empty + idle), full body (has-content + idle),
 *      collapsed preview (has-content + collapsed), or inline editor
 *      (editing).
 *
 * Why two render points + Context (rather than one component handling
 * both): the parent layout owns vertical spacing between sections via
 * `space-y-5`. The pill needs to land inside the DUE DATE row's
 * justify-between flex; the body needs to land between two
 * border-separated sections. Trying to render both from one component
 * would require portals or break the vertical rhythm.
 *
 * Edit mode is inline (Jira / Linear pattern) — textarea + Save / Cancel
 * replace the read view in place. No popover. Notes are first-class
 * content; the user wants their surrounding context visible while writing.
 */

type NotesContextValue = {
  deadlineId: string;
  savedText: string;
  hasContent: boolean;
  editing: boolean;
  collapsed: boolean;
  draft: string;
  pending: boolean;
  startEdit: () => void;
  cancelEdit: () => void;
  toggleCollapsed: () => void;
  setDraft: (s: string) => void;
  submit: (fd: FormData) => void;
};

const NotesCtx = createContext<NotesContextValue | null>(null);

function useNotesCtx(): NotesContextValue {
  const ctx = useContext(NotesCtx);
  if (!ctx) {
    throw new Error("Notes slot used outside of <NotesProvider>");
  }
  return ctx;
}

export function NotesProvider({
  deadlineId,
  initialNotes,
  children,
}: {
  deadlineId: string;
  initialNotes: string | null;
  children: ReactNode;
}) {
  const savedText = initialNotes ?? "";
  const hasContent = savedText.trim().length > 0;
  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState(savedText);
  const [pending, startTransition] = useTransition();

  const value: NotesContextValue = {
    deadlineId,
    savedText,
    hasContent,
    editing,
    collapsed,
    draft,
    pending,
    startEdit: () => {
      setDraft(savedText);
      setCollapsed(false);
      setEditing(true);
    },
    cancelEdit: () => {
      setDraft(savedText);
      setEditing(false);
    },
    toggleCollapsed: () => setCollapsed((c) => !c),
    setDraft,
    submit: (fd) => {
      startTransition(async () => {
        await updateNotesAction(fd);
        setEditing(false);
      });
    },
  };

  return <NotesCtx.Provider value={value}>{children}</NotesCtx.Provider>;
}

/**
 * Pill that sits in the DUE DATE row's right side. Mirrors "+ Add stage"
 * styling. Visible only when notes is empty + idle. Click → opens the
 * inline editor in the section slot below.
 */
export function NotesPillSlot() {
  const ctx = useNotesCtx();
  if (ctx.hasContent || ctx.editing) return null;
  return (
    <button
      type="button"
      onClick={ctx.startEdit}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground transition-colors"
      aria-label="Add note"
    >
      <Plus className="h-3 w-3" aria-hidden />
      Add note
    </button>
  );
}

/**
 * Body slot between DUE DATE and PREP STAGES. Four render branches:
 *   - editing                 → textarea + Save/Cancel
 *   - has-content, expanded   → label + body + Edit button (click body to edit)
 *   - has-content, collapsed  → label + 1-line preview + chevron
 *   - empty, idle             → null (pill in due-date row handles affordance)
 */
export function NotesSectionSlot() {
  const ctx = useNotesCtx();

  if (ctx.editing) {
    return (
      <div className="border-t border-border pt-5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Notes
          </p>
          <span className="text-[11px] text-muted-foreground">Editing</span>
        </div>
        <form action={ctx.submit} className="space-y-3">
          <input type="hidden" name="deadlineId" value={ctx.deadlineId} />
          <Textarea
            name="notes"
            value={ctx.draft}
            onChange={(e) => ctx.setDraft(e.target.value)}
            placeholder="Context, blockers, client conversations…"
            rows={5}
            maxLength={2000}
            autoFocus
            className="resize-none text-[13.5px] leading-relaxed"
            disabled={ctx.pending}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={ctx.cancelEdit}
              disabled={ctx.pending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={ctx.pending}>
              {ctx.pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  if (!ctx.hasContent) {
    // Empty + idle → nothing here. Pill in due-date row is the entry.
    return null;
  }

  if (ctx.collapsed) {
    const lines = ctx.savedText.split("\n").filter((l) => l.trim().length > 0);
    const previewLine = lines[0] ?? ctx.savedText;
    const lineCount = lines.length;
    return (
      <div className="border-t border-border pt-5">
        <button
          type="button"
          onClick={ctx.toggleCollapsed}
          className="w-full flex items-center justify-between gap-2 text-left group"
          aria-label="Expand notes"
        >
          <div className="flex items-center gap-2">
            <ChevronRight
              className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors"
              strokeWidth={2.4}
            />
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Notes
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {lineCount === 1 ? "1 line" : `${lineCount} lines`}
          </span>
        </button>
        <div className="mt-1.5 pl-5 text-[13px] text-muted-foreground truncate">
          {previewLine}
        </div>
      </div>
    );
  }

  // Has content, expanded (default)
  return (
    <div className="border-t border-border pt-5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <button
          type="button"
          onClick={ctx.toggleCollapsed}
          className="flex items-center gap-2 hover:opacity-70 transition-opacity"
          aria-label="Collapse notes"
        >
          <ChevronDown
            className="h-3 w-3 text-muted-foreground"
            strokeWidth={2.4}
          />
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Notes
          </p>
        </button>
        <button
          type="button"
          onClick={ctx.startEdit}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground transition-colors"
          aria-label="Edit notes"
        >
          <NotebookPen className="h-3 w-3" aria-hidden />
          Edit
        </button>
      </div>
      <button
        type="button"
        onClick={ctx.startEdit}
        className="w-full text-left cursor-text rounded-lg p-2 -m-2 hover:bg-muted/30 transition-colors"
        aria-label="Click to edit notes"
      >
        <div className="text-[13.5px] leading-relaxed whitespace-pre-wrap">
          {ctx.savedText}
        </div>
      </button>
    </div>
  );
}
