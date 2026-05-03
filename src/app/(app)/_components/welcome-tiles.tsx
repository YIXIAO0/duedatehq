import Link from "next/link";
import { FileSpreadsheet, Plus } from "lucide-react";

/**
 * Two-tile welcome / empty-state block — used on /dashboard (when no
 * deadlines) and /clients (when no clients).
 *
 * Visual: warm-amber recommended tile + cream secondary tile, matching
 * the app's "warm cream + per-client color" design language. CTAs are
 * pinned to card bottom via `mt-auto` so they sit on the same baseline
 * regardless of description length.
 *
 * The wrapping container (centering / page header coexistence) is the
 * caller's concern — this component renders the headline + grid only.
 */
export function WelcomeTiles({
  title = "Welcome to DueDateHQ",
  subtitle = "Two ways to get started — pick whichever fits.",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="w-full max-w-3xl">
      <div className="mb-10 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-3 text-base text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/clients/import"
          className="group relative flex flex-col rounded-xl border border-[var(--color-priority-medium)]/25 bg-[var(--color-priority-medium-bg)]/60 p-7 transition-all hover:border-[var(--color-priority-medium)]/55 hover:bg-[var(--color-priority-medium-bg)]/80 hover:shadow-md"
        >
          <span className="absolute right-4 top-4 rounded-full bg-[var(--color-priority-medium)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-priority-medium)]">
            Recommended
          </span>
          <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--color-priority-medium)] text-white shadow-sm">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-semibold">Import from spreadsheet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Upload your existing client list. AI maps the columns for you.
          </p>
          <p className="mt-auto pt-6 text-sm font-medium text-[var(--color-priority-medium)] group-hover:underline">
            Start import →
          </p>
        </Link>
        <Link
          href="/clients/new"
          className="group flex flex-col rounded-xl border border-[var(--color-priority-medium)]/15 bg-[var(--color-priority-medium-bg)]/25 p-7 transition-all hover:border-[var(--color-priority-medium)]/35 hover:bg-[var(--color-priority-medium-bg)]/45 hover:shadow-md"
        >
          <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--color-priority-medium-bg)] text-[var(--color-priority-medium)]">
            <Plus className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-semibold">Add one client</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Try the tool with a single client first.
          </p>
          <p className="mt-auto pt-6 text-sm font-medium group-hover:underline">
            Add client →
          </p>
        </Link>
      </div>
    </div>
  );
}
