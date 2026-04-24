"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateNotesAction } from "./actions";

export function NotesForm({
  deadlineId,
  initialNotes,
}: {
  deadlineId: string;
  initialNotes: string | null;
}) {
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(fd: FormData) {
    setSaving(true);
    setSaved(false);
    try {
      await updateNotesAction(fd);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  const changed = notes !== (initialNotes ?? "");

  return (
    <form action={handleSubmit} className="space-y-3">
      <input type="hidden" name="deadlineId" value={deadlineId} />
      <Textarea
        name="notes"
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Filing reference numbers, extension details, client communications, anything worth remembering..."
        maxLength={2000}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {saved ? "✓ Saved" : changed ? "Unsaved changes" : ""}
        </span>
        <Button type="submit" size="sm" disabled={!changed || saving}>
          {saving ? "Saving…" : "Save notes"}
        </Button>
      </div>
    </form>
  );
}
