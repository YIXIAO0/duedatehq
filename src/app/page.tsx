import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, Calendar, Sparkles, Repeat } from "lucide-react";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://duedatehq.com";

/**
 * Landing-page metadata. `title.absolute` opts out of the root layout's
 * "%s · DueDateHQ" template so the home title reads cleanly as a single
 * SEO phrase rather than duplicating the brand. Description is tuned
 * for the "tax deadline tool for independent tax pros" search-intent
 * cluster — covers both CPA and EA queries.
 */
export const metadata: Metadata = {
  title: {
    absolute: "Tax Deadline Tracker for Independent Tax Pros | DueDateHQ",
  },
  description:
    "DueDateHQ is the cloud deadline tracker for independent tax professionals. Federal + 50-state coverage, automatic IRS disaster-relief updates, and live sync to Google or Apple Calendar.",
  alternates: { canonical: APP_URL },
  openGraph: {
    type: "website",
    url: APP_URL,
    siteName: "DueDateHQ",
    title: "Tax Deadline Tracker for Independent Tax Pros | DueDateHQ",
    description:
      "Federal + 50-state tax deadline coverage with automatic IRS disaster-relief updates. Built for solo CPAs and small firms.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tax Deadline Tracker for Independent Tax Pros | DueDateHQ",
    description:
      "Federal + 50-state coverage, IRS auto-updates, calendar sync. Built for independent tax pros.",
  },
};

/**
 * JSON-LD SoftwareApplication schema — drives Google's rich product
 * cards and AI-citation surfaces (ChatGPT / Perplexity / Gemini)
 * when crawling. No `offers` block on purpose: pre-launch pricing
 * isn't committed yet, and emitting a placeholder number would let
 * AI aggregators cite it as fact. Add an Offer once a real price
 * is locked.
 */
const PRODUCT_JSONLD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "DueDateHQ",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "Tax deadline tracker for independent CPAs and small accounting firms. Federal + 50-state coverage, automatic IRS disaster-relief updates.",
  url: APP_URL,
  audience: {
    "@type": "BusinessAudience",
    audienceType: "Independent CPAs and small accounting firms",
  },
};

export default function LandingPage() {
  return (
    <main className="flex flex-col flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(PRODUCT_JSONLD) }}
      />

      {/* Header — sticky, solid background (legibility > trendiness for a pro tool) */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            DueDateHQ
          </Link>
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/sign-up">
                Request beta access <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero — leads with the magical bit ("updates itself") instead of
          generic "never miss a deadline". The sub spells out the
          disaster-relief wedge in plain language so the value lands
          before the reader scrolls. */}
      <section className="relative mx-auto w-full max-w-5xl px-6 pb-12 pt-16 text-center md:pb-16 md:pt-24">
        <p className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          For independent tax professionals
        </p>
        <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
          The tax deadline tracker
          <br />
          that updates itself.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
          Federal + 50 states. Every form, every client, every year. When the
          IRS posts disaster relief, your dashboard already shows which of your
          clients qualify.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/sign-up">
              Request beta access <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/sign-in">I already have an account</Link>
          </Button>
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          Free during invite-only beta · No card required
        </p>
      </section>

      {/* Hero screenshot — the dashboard is the product, surface it.
          Wrapped in a soft warm gradient to evoke the Arc-DNA cream
          tone of the in-app palette without overpowering the screenshot
          itself. priority=true: this is above the fold, opt out of
          lazy-loading so LCP stays fast. */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-20">
        <div
          className="overflow-hidden rounded-[28px] p-3 shadow-2xl ring-1 ring-black/5"
          style={{
            background:
              "linear-gradient(135deg, #FFE3E3 0%, #FFEBD0 50%, #E0DAF6 100%)",
          }}
        >
          <Image
            src="/dashboard.png"
            alt="DueDateHQ dashboard showing upcoming tax deadlines grouped by client and time bucket"
            width={3022}
            height={1714}
            priority
            sizes="(max-width: 1280px) 100vw, 1200px"
            className="h-auto w-full rounded-[20px]"
          />
        </div>
      </section>

      {/* Three wedges — replaces the previous generic feature list with
          the actual differentiation: import friction, AI client-matching
          on disaster relief, and native calendar sync. Worded as
          outcomes ("in 10 minutes", "in seconds") not features. */}
      <section className="mx-auto w-full max-w-5xl px-6 pb-20">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Built around what actually slows you down
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
            Three things take more time than they should in a small tax
            practice. We&apos;ve put serious effort into all three.
          </p>
        </div>
        <div className="grid gap-8 md:grid-cols-3">
          <FeatureCard
            icon={<Repeat className="h-5 w-5" />}
            title="From spreadsheet to live calendar — in 10 minutes"
            body="Drop your existing client list. AI maps the columns, generates a year of deadlines per entity and state, and shows you the next 60 days on day one."
          />
          <FeatureCard
            icon={<Sparkles className="h-5 w-5" />}
            title="IRS disaster relief, matched in seconds"
            body="When the IRS extends FEMA-declared counties, your dashboard surfaces the affected clients. Review, deselect any that don't qualify, and extend them all in one click."
          />
          <FeatureCard
            icon={<Calendar className="h-5 w-5" />}
            title="Lives in Google or Apple Calendar"
            body="One iCal feed URL. Every deadline, every reminder, on every device you already use. No new app to check."
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 text-sm text-muted-foreground">
          <span>© 2026 DueDateHQ</span>
          <span>v0.1.0 · beta</span>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card transition-shadow hover:shadow-md">
      <div
        className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-xl text-white"
        style={{
          background: "linear-gradient(135deg, #FF7B7B, #FFB85C)",
        }}
      >
        {icon}
      </div>
      <h3 className="text-base font-semibold leading-snug">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
