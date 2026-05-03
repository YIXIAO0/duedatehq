import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Plus, FileSpreadsheet, Download } from "lucide-react";
import { getCurrentContext } from "@/lib/auth/current-org";
import { listClientsWithEntityCount } from "@/lib/services/clients";
import { ClientsList } from "./clients-list";
import { WelcomeTiles } from "../_components/welcome-tiles";

export default function ClientsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Note: the firm-wide PDF route at /api/export/deadlines.pdf is
              still live for partners who want a workload-review snapshot,
              but we don't surface it here. The high-value PDF — per-client
              annual calendar — lives on each client detail page instead.
              CSV stays because Excel is a real workflow for many CPAs. */}
          <Button asChild variant="outline">
            <a href="/api/export/deadlines.csv" download>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link href="/clients/import">
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Import
            </Link>
          </Button>
          <Button asChild>
            <Link href="/clients/new">
              <Plus className="mr-2 h-4 w-4" /> Add client
            </Link>
          </Button>
        </div>
      </div>

      <Suspense fallback={<ClientsSkeleton />}>
        <ClientsListContainer />
      </Suspense>
    </div>
  );
}

async function ClientsListContainer() {
  const ctx = await getCurrentContext();
  const clients = await listClientsWithEntityCount({ orgId: ctx.organization.id });

  if (clients.length === 0) {
    // Sits below the page header (Clients title + action buttons).
    // pt-20 + min-h-[60vh] pushes the hero clearly off the action
    // bar — without that gap the headline ran straight into the
    // "Add client" button and read as part of the same row.
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-2 pt-20">
        <WelcomeTiles title="No clients yet" />
      </div>
    );
  }

  return <ClientsList clients={clients} />;
}

function ClientsSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-lg border border-border bg-muted/40"
        />
      ))}
    </div>
  );
}
