import Link from "next/link";
import { FileSpreadsheet, Plus } from "lucide-react";

// Two-tile welcome / empty-state — used on /dashboard and /clients.
export function WelcomeTiles({
  title = "Welcome to DueDateHQ",
  subtitle = "Get started in two minutes.",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="w-full max-w-3xl">
      <div className="mb-10 text-center">
        <h2 className="text-4xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-3 text-base text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/clients/import"
          className="group relative flex flex-col rounded-xl border-2 border-[#B68C2D] bg-white p-7 transition-all hover:shadow-md"
        >
          <span className="absolute right-4 top-4 rounded-full bg-[#B68C2D] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
            Recommended
          </span>
          <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[#FBF3DE] text-[#B68C2D]">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-semibold">Import existing list</h3>
          <p className="mt-2 text-sm text-stone-600">
            Upload your existing client list. AI maps the columns for you.
          </p>
          <p className="mt-auto pt-6 text-sm font-medium text-[#B68C2D] group-hover:underline">
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
          <p className="mt-2 text-sm text-stone-600">
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
