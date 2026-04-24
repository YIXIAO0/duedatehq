import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, Calendar, Shield, Zap } from "lucide-react";

export default function LandingPage() {
  return (
    <main className="flex flex-col flex-1">
      {/* Header */}
      <header className="border-b border-border">
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

      {/* Hero */}
      <section className="mx-auto w-full max-w-4xl px-6 py-20 text-center md:py-28">
        <p className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          For independent tax professionals
        </p>
        <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
          Never miss another
          <br />
          tax deadline.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
          Federal + 50-state deadline database for solo CPAs and EAs. Auto-updates
          when the IRS issues disaster extensions. Built for tax pros who serve
          clients across multiple states.
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
          Free during beta · Invite-only · Founding pricing $19/mo for life
        </p>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-5xl px-6 py-16">
        <div className="grid gap-8 md:grid-cols-3">
          <FeatureCard
            icon={<Calendar className="h-6 w-6" />}
            title="50-state coverage"
            body="Federal + CA, NY, TX, DE, NJ at launch. Franchise tax, PTE elections, quarterly estimates — all pre-loaded."
          />
          <FeatureCard
            icon={<Zap className="h-6 w-6" />}
            title="Auto-updates"
            body="When the IRS announces disaster extensions, affected clients' deadlines update within 24 hours."
          />
          <FeatureCard
            icon={<Shield className="h-6 w-6" />}
            title="Built for solo practices"
            body="One dashboard for all your clients. No practice-management bloat. No Windows install."
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
    <div className="rounded-lg border border-border p-6">
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
