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
  | { status: "error"; message: string };

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
        } else {
          setState({ status: "skipped", reason: result.reason });
        }
      } catch (e) {
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
          Every Monday at 7am ET, you&apos;ll get a one-glance summary of the
          week ahead — deadlines, irrevocable elections, anything overdue.
          Send yourself a sample now to see what it looks like.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={send} disabled={pending} variant="outline">
            <Mail className="mr-2 h-4 w-4" />
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
            <div>
              <div className="font-medium">Send failed</div>
              <div className="text-xs">{state.message}</div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
