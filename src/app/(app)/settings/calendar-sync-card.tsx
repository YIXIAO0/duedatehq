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

import { useId, useState, useTransition } from "react";
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
  ChevronRight,
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

/**
 * Brand glyphs drawn inline as 40px SVGs. Each one is sized at a 40×40
 * viewBox so the brand-distinctive details (Google's color band,
 * Outlook's "O" ring, Apple's red day-of-week + large date) have room
 * to render legibly. Single-file, no external dep, no network request.
 */
function GoogleCalendarGlyph({ className }: { className?: string }) {
  // The recognisable Google Calendar tile: white card, fine grey
  // hairline, and a confident "31" in Google's signature blue. The 4
  // tiny corner squares (red/green/yellow/blue) on the official asset
  // get dropped — at 40px they read as visual noise, not brand.
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="3"
        y="3"
        width="34"
        height="34"
        rx="5"
        fill="white"
        stroke="#DADCE0"
        strokeWidth="1"
      />
      <text
        x="20"
        y="27"
        textAnchor="middle"
        fontSize="17"
        fontWeight="700"
        fill="#1A73E8"
        fontFamily="'Product Sans', 'Google Sans', 'Roboto', system-ui, sans-serif"
      >
        31
      </text>
    </svg>
  );
}

function OutlookGlyph({ className }: { className?: string }) {
  // Outlook's identity is the bold blue tile + the white "O" ring (the
  // letter is a literal hollow circle in the official logo, not a
  // typographic glyph). Drawing it as a thick stroke gets closer to
  // the brand than just a serifed "O".
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="3" y="3" width="34" height="34" rx="5" fill="#0078D4" />
      <ellipse
        cx="20"
        cy="20"
        rx="7"
        ry="9"
        fill="none"
        stroke="white"
        strokeWidth="3"
      />
    </svg>
  );
}

function AppleCalendarGlyph({ className }: { className?: string }) {
  // Apple Calendar uses red day-of-week ABOVE a large dark date — not
  // a stripe. Replicating that rhythm here makes the icon read as
  // "macOS app" at a glance. useId() prevents clipPath ID collisions
  // when multiple instances render on the same page.
  const clipId = useId();
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="3" y="3" width="34" height="34" rx="5.5" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect x="3" y="3" width="34" height="34" fill="white" />
      </g>
      <rect
        x="3"
        y="3"
        width="34"
        height="34"
        rx="5.5"
        fill="none"
        stroke="#D2D2D7"
        strokeWidth="1"
      />
      <text
        x="20"
        y="14.5"
        textAnchor="middle"
        fontSize="5.5"
        fontWeight="700"
        fill="#FF3B30"
        fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
        letterSpacing="0.5"
      >
        SAT
      </text>
      <text
        x="20"
        y="32"
        textAnchor="middle"
        fontSize="17"
        fontWeight="700"
        fill="#1D1D1F"
        fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
      >
        17
      </text>
    </svg>
  );
}

/**
 * Per-app subscribe instructions. Apple is grouped (Mac + iPhone share
 * the app, just different menu paths) so we don't duplicate the icon —
 * sub-paths get a tiny "Mac" / "iPhone" label inline.
 */
type SubscribeApp = {
  name: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
  paths: Array<{ label?: string; steps: string[] }>;
};

const SUBSCRIBE_APPS: SubscribeApp[] = [
  {
    name: "Google Calendar",
    Icon: GoogleCalendarGlyph,
    paths: [{ steps: ["Sidebar", "+ Other calendars", "From URL"] }],
  },
  {
    name: "Outlook",
    Icon: OutlookGlyph,
    paths: [{ steps: ["Add calendar", "Subscribe from web"] }],
  },
  {
    name: "Apple Calendar",
    Icon: AppleCalendarGlyph,
    paths: [
      { label: "Mac", steps: ["File", "New Calendar Subscription"] },
      {
        label: "iPhone",
        steps: ["Settings", "Calendar", "Add Account", "Other"],
      },
    ],
  },
];

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
  const [showHelp, setShowHelp] = useState(false);

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
            <Loader2 className="h-4 w-4 animate-spin" /> Generating…
          </>
        ) : (
          <>
            <Calendar className="h-4 w-4" /> Enable calendar sync
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
              <Check className="h-4 w-4 text-[var(--color-priority-done)]" />{" "}
              Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" /> Copy
            </>
          )}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Anyone with this URL can read your deadlines — keep it private.
      </p>

      {/* Per-app subscribe instructions. Custom toggle (instead of
          <details>) so we can fully style the disclosure: rotating
          chevron, hover state, no browser-default triangle marker.
          Each app renders as a row with the name on the left and the
          menu path as a step pill-chain on the right — reads as
          "follow these steps" instead of a wall of '>' prose. */}
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          aria-expanded={showHelp}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${
              showHelp ? "rotate-90" : ""
            }`}
            aria-hidden
          />
          How to subscribe
        </button>
        {showHelp ? (
          <ul className="divide-y divide-border border-t border-border bg-muted/20">
            {SUBSCRIBE_APPS.map((app) => (
              <li
                key={app.name}
                className="flex items-start gap-4 px-4 py-3.5"
              >
                {/* Icon larger (h-10) so brand-distinctive details
                    (Google "31", Outlook ring, Apple red+date) have
                    presence — at h-8 they read as outline placeholders. */}
                <app.Icon className="h-10 w-10 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                  <div className="text-sm font-semibold text-foreground">
                    {app.name}
                  </div>
                  {app.paths.map((path, idx) => (
                    <div
                      key={idx}
                      className="flex flex-wrap items-center gap-1.5 text-xs"
                    >
                      {path.steps.map((step, i) => (
                        <span key={i} className="flex items-center gap-1.5">
                          {i > 0 ? (
                            <ChevronRight
                              className="h-3 w-3 shrink-0 text-muted-foreground/40"
                              aria-hidden
                            />
                          ) : null}
                          {/* kbd-style: physical-button feel reads as
                              "click this in the menu". Subtle bottom
                              shadow gives the lift; bg-card on a slightly
                              tinted parent provides contrast. */}
                          <kbd className="inline-flex h-6 items-center rounded-md border border-border bg-card px-2 font-sans text-[12px] font-medium text-foreground/90 shadow-[inset_0_-1px_0_var(--color-border)]">
                            {step}
                          </kbd>
                        </span>
                      ))}
                      {path.label ? (
                        // Device qualifier as a parenthesized suffix —
                        // reads as natural-language footnote rather
                        // than a column header, and lets every app's
                        // first pill start at the same x-position
                        // (the column-header version offset Apple's
                        // pills relative to Google/Outlook).
                        <span className="ml-0.5 text-[11px] text-muted-foreground/70">
                          ({path.label})
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Rotate + revoke actions. Both are destructive enough (existing
          subscriptions break) to warrant confirmation. */}
      <div className="flex flex-wrap gap-2 pt-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={pending}>
              <RefreshCw className="h-3.5 w-3.5" /> Rotate URL
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
              <Trash2 className="h-3.5 w-3.5" /> Disable
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
