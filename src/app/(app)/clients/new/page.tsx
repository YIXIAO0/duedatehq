"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2 } from "lucide-react";
import { createClientWithSetupAction } from "../actions";
import { StateCombobox } from "@/components/ui/state-combobox";

type Step = "client" | "contact" | "entity";

const ENTITY_TYPE_OPTIONS = [
  { value: "individual", label: "Individual (1040)" },
  { value: "s_corp", label: "S-Corporation (1120-S)" },
  { value: "c_corp", label: "C-Corporation (1120)" },
  { value: "partnership", label: "Partnership (1065)" },
  { value: "llc", label: "LLC (taxed as partnership)" },
  { value: "trust", label: "Trust (1041)" },
  { value: "estate", label: "Estate (1041)" },
  { value: "nonprofit", label: "Nonprofit (990)" },
] as const;

type EntityType = (typeof ENTITY_TYPE_OPTIONS)[number]["value"];


export default function NewClientPage() {
  const [step, setStep] = useState<Step>("client");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [clientName, setClientName] = useState("");
  const [clientNotes, setClientNotes] = useState("");

  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const [entityName, setEntityName] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("individual");
  const [entityHomeState, setEntityHomeState] = useState<string>("");

  const canAdvanceClient = clientName.trim().length > 0;
  const canAdvanceContact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    contactEmail.trim(),
  );
  const canSubmit = entityName.trim().length > 0 && entityType;

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await createClientWithSetupAction({
          clientName: clientName.trim(),
          clientNotes: clientNotes.trim() || undefined,
          contactName: contactName.trim() || undefined,
          contactEmail: contactEmail.trim(),
          contactPhone: contactPhone.trim() || undefined,
          entityName: entityName.trim(),
          entityType,
          entityHomeState: entityHomeState || undefined,
        });
      } catch (err) {
        // Next's redirect() throws a special error that we let bubble.
        if (
          err instanceof Error &&
          (err.message === "NEXT_REDIRECT" || err.message.includes("REDIRECT"))
        ) {
          throw err;
        }
        setError(err instanceof Error ? err.message : "Failed to create");
      }
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-3">
        <Link href="/clients">
          <ArrowLeft className="h-4 w-4" /> Back to clients
        </Link>
      </Button>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Add a new client
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A client needs at least one contact for reminders and one tax entity
          to track.
        </p>
      </div>

      <StepIndicator current={step} />

      {error ? (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mt-6">
        {step === "client" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Client basics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="clientName">Client name *</Label>
                <Input
                  id="clientName"
                  required
                  autoFocus
                  maxLength={200}
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientNotes">Notes</Label>
                <Textarea
                  id="clientNotes"
                  rows={3}
                  maxLength={2000}
                  value={clientNotes}
                  onChange={(e) => setClientNotes(e.target.value)}
                />
              </div>
            </CardContent>
            <CardFooter className="justify-end gap-2">
              <Button asChild variant="outline">
                <Link href="/clients">Cancel</Link>
              </Button>
              <Button
                disabled={!canAdvanceClient}
                onClick={() => setStep("contact")}
              >
                Continue
              </Button>
            </CardFooter>
          </Card>
        ) : null}

        {step === "contact" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Primary contact</CardTitle>
              <p className="text-sm text-muted-foreground">
                Where deadline reminders go. Email is required; name and phone
                are optional.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="contactEmail">Email *</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  required
                  autoFocus
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="contactName">Name</Label>
                  <Input
                    id="contactName"
                    maxLength={120}
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPhone">Phone</Label>
                  <Input
                    id="contactPhone"
                    type="tel"
                    maxLength={50}
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-between gap-2">
              <Button variant="outline" onClick={() => setStep("client")}>
                Back
              </Button>
              <Button
                disabled={!canAdvanceContact}
                onClick={() => setStep("entity")}
              >
                Continue
              </Button>
            </CardFooter>
          </Card>
        ) : null}

        {step === "entity" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">First tax entity</CardTitle>
              <p className="text-sm text-muted-foreground">
                We&apos;ll generate the deadline calendar based on this. You
                can add more entities (or fine-tune EIN, fiscal year, services)
                from the client page.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="entityName">Entity name *</Label>
                  <Input
                    id="entityName"
                    required
                    autoFocus
                    maxLength={200}
                    value={entityName}
                    onChange={(e) => setEntityName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="entityType">Entity type *</Label>
                  <Select
                    value={entityType}
                    onValueChange={(v) => setEntityType(v as EntityType)}
                  >
                    <SelectTrigger id="entityType" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENTITY_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="entityHomeState">Home state</Label>
                <StateCombobox
                  id="entityHomeState"
                  value={entityHomeState || undefined}
                  onChange={(code) => setEntityHomeState(code ?? "")}
                  placeholder="Select home state (optional)"
                />
              </div>
            </CardContent>
            <CardFooter className="justify-between gap-2">
              <Button
                variant="outline"
                onClick={() => setStep("contact")}
                disabled={pending}
              >
                Back
              </Button>
              <Button onClick={submit} disabled={!canSubmit || pending}>
                {pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Creating…
                  </>
                ) : (
                  <>Create client</>
                )}
              </Button>
            </CardFooter>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function StepIndicator({ current }: { current: Step }) {
  const steps: Array<{ id: Step; label: string }> = [
    { id: "client", label: "Client" },
    { id: "contact", label: "Contact" },
    { id: "entity", label: "Tax entity" },
  ];
  const currentIdx = steps.findIndex((s) => s.id === current);

  return (
    <div className="flex items-center gap-2 text-sm">
      {steps.map((s, i) => {
        const active = s.id === current;
        const done = i < currentIdx;
        return (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                active
                  ? "bg-primary text-primary-foreground"
                  : done
                  ? "bg-[var(--color-priority-done)] text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {done ? "✓" : i + 1}
            </div>
            <span
              className={
                active
                  ? "font-medium"
                  : done
                  ? "text-muted-foreground"
                  : "text-muted-foreground/60"
              }
            >
              {s.label}
            </span>
            {i < steps.length - 1 ? (
              <div className="mx-2 h-px w-6 bg-border" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
