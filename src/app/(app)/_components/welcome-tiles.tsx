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
        <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
        {subtitle ? (
          <p className="mt-3 text-base text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {/* Sample 3 — "mono cream w/ depth". Both cards share the same
          warm-cream bg (#FBF7F0). Recommended is differentiated by
          a thicker border, ambient shadow, and dark icon/pill chrome;
          secondary uses a thinner border + warm-brown accents. Inline
          hex values are intentional — Sample 3's palette doesn't map
          cleanly to existing priority tokens, and substituting nearby
          tokens would drift away from the chosen visual. */}
      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/clients/import"
          className="group relative flex flex-col rounded-xl border-2 border-[#E0CFA8] bg-[#FBF7F0] p-7 shadow-[0_4px_12px_rgba(160,120,40,0.10)] transition-all hover:shadow-[0_6px_18px_rgba(160,120,40,0.14)]"
        >
          <span className="absolute right-4 top-4 rounded-full bg-[#37352F] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#FBF7F0]">
            Recommended
          </span>
          <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[#37352F] text-[#FBF7F0]">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-semibold">Import existing list</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Upload your existing client list. AI maps the columns for you.
          </p>
          <p className="mt-auto pt-6 text-sm font-medium text-[#37352F] group-hover:underline">
            Start import →
          </p>
        </Link>
        <Link
          href="/clients/new"
          className="group flex flex-col rounded-xl border border-[#EAE3D2] bg-[#FBF7F0] p-7 transition-all hover:shadow-md"
        >
          <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[#EAE3D2] text-[#6B4D1A]">
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
