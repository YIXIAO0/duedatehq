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
  subtitle,
}: {
  title?: string;
  /** Optional. Skipped by default — the title + the two visible tiles
      already say "two paths to get started", a subtitle reading
      "Two ways to get started, pick whichever fits" was filler. */
  subtitle?: string;
}) {
  return (
    <div className="w-full max-w-3xl">
      <div className="mb-10 text-center">
        {/* Sample 5 hero — bigger title (4xl) + warm dark brown so the
            heading carries the brand warmth, freeing the cards below
            to stay near-white / minimal. */}
        <h2 className="text-4xl font-semibold tracking-tight text-[#6B4D1A]">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-3 text-base text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {/* Sample 5 — "bold hero + minimal cards". Cards are near-white;
          recommended sits inside a 2px amber frame with a solid amber
          pill + amber icon container, secondary has a thin warm-tan
          border with subtle warm-brown accents. The heading does the
          colour work, the cards stay quiet — Linear / Notion empty
          state vibe. Recommended border / icon bg / CTA reuse the
          --color-priority-medium token family; the warm-tan secondary
          colors are inline since they don't map to existing tokens. */}
      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/clients/import"
          className="group relative flex flex-col rounded-xl border-2 border-[var(--color-priority-medium)] bg-white p-7 transition-all hover:shadow-md"
        >
          <span className="absolute right-4 top-4 rounded-full bg-[var(--color-priority-medium)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
            Recommended
          </span>
          <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--color-priority-medium-bg)] text-[var(--color-priority-medium)]">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-semibold">Import existing list</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Upload your existing client list. AI maps the columns for you.
          </p>
          <p className="mt-auto pt-6 text-sm font-medium text-[var(--color-priority-medium)] group-hover:underline">
            Start import →
          </p>
        </Link>
        <Link
          href="/clients/new"
          className="group flex flex-col rounded-xl border border-[#EAE3D2] bg-white p-7 transition-all hover:border-stone-300 hover:shadow-md"
        >
          <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[#F5F2EC] text-[#6B4D1A]">
            <Plus className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-semibold">Add a client</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Try the tool with a single client first.
          </p>
          <p className="mt-auto pt-6 text-sm font-medium text-[#6B4D1A] group-hover:underline">
            Add manually →
          </p>
        </Link>
      </div>
    </div>
  );
}
