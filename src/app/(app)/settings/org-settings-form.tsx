"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { updateOrgAction } from "./actions";

export function OrgSettingsForm({
  orgId,
  orgName,
  plan,
}: {
  orgId: string;
  orgName: string;
  plan: string;
}) {
  const [name, setName] = useState(orgName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const changed = name.trim() !== orgName;

  async function handleSubmit(formData: FormData) {
    setSaving(true);
    setSaved(false);
    try {
      await updateOrgAction(formData);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <input type="hidden" name="id" value={orgId} />
      <div className="space-y-2">
        <Label htmlFor="name">Organization name</Label>
        <Input
          id="name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          required
        />
      </div>

      <div className="flex items-center gap-2">
        <Label className="text-sm text-muted-foreground">Plan</Label>
        <Badge variant="outline" className="text-xs uppercase">
          {plan}
        </Badge>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {saved ? "✓ Saved" : changed ? "Unsaved changes" : ""}
        </span>
        <Button type="submit" size="sm" disabled={!changed || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
