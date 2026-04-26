"use client";

/**
 * Calendar Sync settings card.
 *
 * Why this is a Client Component: copy-to-clipboard needs `navigator`,
 * the rotate / revoke confirmations want optimistic UI, and the URL
 * preview should react to enable/disable without a full page round
 * trip. Server fetches the initial token (via the parent server
 * component) and passes it in — we only mutate from here.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Calendar,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Loader2,
} from "lucide-react";
import {
  rotateIcalTokenAction,
  revokeIcalTokenAction,
} from "./actions";

export function CalendarSyncCard({
  initialToken,
  appUrl,
}: {
  initialToken: string | null;
  appUrl: string;
}) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const subscriptionUrl = token ? `${appUrl}/api/ical/${token}.ics` : null;

  const handleEnable = () => {
    startTransition(async () => {
      const { token: newToken } = await rotateIcalTokenAction();
      setToken(newToken);
    });
  };

  const handleRotate = () => {
    startTransition(async () => {
      const { token: newToken } = await rotateIcalTokenAction();
      setToken(newToken);
    });
  };

  const handleRevoke = () => {
    startTransition(async () => {
      await revokeIcalTokenAction();
      setToken(null);
    });
  };

  const handleCopy = async () => {
    if (!subscriptionUrl) return;
    await navigator.clipboard.writeText(subscriptionUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (!subscriptionUrl) {
    return (
      <Button onClick={handleEnable} disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
          </>
        ) : (
          <>
            <Calendar className="mr-2 h-4 w-4" /> Enable calendar sync
          </>
        )}
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      {/* URL display + copy button. Readonly input (not a code block) so
          users can triple-click to select on desktop. The privacy note
          sits below it as a small caption rather than a full paragraph
          — the URL is the focal point, not the prose around it. */}
      <div className="flex gap-2">
        <input
          readOnly
          value={subscriptionUrl}
          onClick={(e) => e.currentTarget.select()}
          className="flex-1 truncate rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-xs"
          aria-label="Calendar subscription URL"
        />
        <Button
          type="button"
          variant="outline"
          onClick={handleCopy}
          disabled={pending}
          aria-label="Copy URL"
        >
          {copied ? (
            <>
              <Check className="mr-2 h-4 w-4 text-[var(--color-priority-done)]" />{" "}
              Copied
            </>
          ) : (
            <>
              <Copy className="mr-2 h-4 w-4" /> Copy
            </>
          )}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Anyone with this URL can read your deadlines — keep it private.
      </p>

      {/* Per-app instructions. One terse line per app — calendar
          subscription flows are well-known by now, no need to walk
          users through every menu click. */}
      <details className="rounded-md border border-border bg-muted/20 px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          How to subscribe
        </summary>
        <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Google Calendar:</span>{" "}
            sidebar &gt; <strong>+</strong> Other calendars &gt; From URL.
          </li>
          <li>
            <span className="font-medium text-foreground">Outlook:</span>{" "}
            Add calendar &gt; Subscribe from web.
          </li>
          <li>
            <span className="font-medium text-foreground">Apple Calendar:</span>{" "}
            File &gt; New Calendar Subscription (Mac), or Settings &gt;
            Calendar &gt; Add Account &gt; Other (iPhone).
          </li>
        </ul>
      </details>

      {/* Rotate + revoke actions. Both are destructive enough (existing
          subscriptions break) to warrant confirmation. */}
      <div className="flex flex-wrap gap-2 pt-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={pending}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Rotate URL
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Rotate the subscription URL?</AlertDialogTitle>
              <AlertDialogDescription>
                The current URL will stop working immediately. You&apos;ll
                need to update the subscription in every calendar app where
                you pasted it. Use this if you think the URL was shared by
                accident.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleRotate}>
                Rotate
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              className="text-[var(--color-priority-urgent)] hover:text-[var(--color-priority-urgent)]"
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Disable
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disable calendar sync?</AlertDialogTitle>
              <AlertDialogDescription>
                The subscription URL stops working. Calendar apps will keep
                showing the most recent fetch but will fail on the next
                refresh. You can re-enable any time — a new URL will be
                generated.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleRevoke}>
                Disable
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
