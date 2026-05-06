"use client";

import { useState, useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Mail, AlertCircle } from "lucide-react";
import { sendDigestPreviewAction } from "./actions";

type State =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent"; weekKey: string; messageId: string | null }
  | { status: "skipped"; reason: string }
  | { status: "error"; message: string; stage?: string };

export function DigestPreviewCard({
  recipientEmail,
}: {
  recipientEmail: string;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  function send() {
    setState({ status: "sending" });
    startTransition(async () => {
      try {
        const result = await sendDigestPreviewAction();
        if (result.sent) {
          setState({
            status: "sent",
            weekKey: result.weekKey,
            messageId: result.messageId,
          });
        } else if (result.reason === "error") {
          setState({
            status: "error",
            message: result.errorMessage ?? "Send failed.",
            stage: result.errorStage,
          });
        } else {
          setState({ status: "skipped", reason: result.reason });
        }
      } catch (e) {
        // Server actions now return structured errors; this catch is the
        // last-resort fallback for things like network drops.
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Send failed.",
        });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Weekly digest
          <Badge variant="outline" className="text-xs">
            Preview
          </Badge>
        </CardTitle>
        <CardDescription>
          Mondays at 7am ET — the week&apos;s deadlines, elections, and overdue
          items.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={send} disabled={pending} variant="outline">
            <Mail className="h-4 w-4" />
            {pending ? "Sending…" : "Send me a sample"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Goes to <span className="font-mono">{recipientEmail}</span>
          </span>
        </div>

        {state.status === "sent" ? (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">
                Sent for week {state.weekKey}.
              </div>
              <div className="text-xs text-emerald-800">
                Check your inbox in a moment.
                {state.messageId
                  ? ` Resend message id: ${state.messageId}.`
                  : ""}
              </div>
            </div>
          </div>
        ) : null}
        {state.status === "skipped" ? (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">Not sent.</div>
              <div className="text-xs text-amber-800">
                {state.reason === "no-recipient"
                  ? "Your account has no email on file."
                  : "Already sent this week — preview can&apos;t override the dedupe."}
              </div>
            </div>
          </div>
        ) : null}
        {state.status === "error" ? (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                Send failed{state.stage ? ` (stage: ${state.stage})` : ""}
              </div>
              <div className="mt-0.5 break-words text-xs">{state.message}</div>
              {state.stage === "send" &&
              state.message.toLowerCase().includes("testing emails") ? (
                <div className="mt-2 rounded border border-destructive/20 bg-background p-2 text-xs text-foreground">
                  <div className="font-medium">How to fix:</div>
                  <div className="mt-1 text-muted-foreground">
                    Resend&apos;s shared <code>onboarding@resend.dev</code>{" "}
                    sender only delivers to your Resend account&apos;s signup
                    email. Either (a) verify a domain at{" "}
                    <a
                      href="https://resend.com/domains"
                      target="_blank"
                      className="underline"
                      rel="noreferrer"
                    >
                      resend.com/domains
                    </a>{" "}
                    and update <code>RESEND_FROM_EMAIL</code>, or (b) sign in
                    here with the email tied to your Resend account.
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
