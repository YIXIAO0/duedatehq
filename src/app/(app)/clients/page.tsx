import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plus, Users, FileSpreadsheet, Download } from "lucide-react";
import { getCurrentContext } from "@/lib/auth/current-org";
import { listClients } from "@/lib/services/clients";

export default function ClientsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All your tax clients. Add an entity to any client to auto-generate
            their deadlines.
          </p>
        </div>
        <div className="flex gap-2">
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
        <ClientsList />
      </Suspense>
    </div>
  );
}

async function ClientsList() {
  const ctx = await getCurrentContext();
  const clients = await listClients({ orgId: ctx.organization.id });

  if (clients.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No clients yet</CardTitle>
          <CardDescription>
            Two ways to get going:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <Link
              href="/clients/import"
              className="group flex flex-col rounded-lg border-2 border-primary/30 bg-primary/5 p-6 transition-all hover:border-primary hover:bg-primary/10"
            >
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">
                Import from spreadsheet
                <span className="ml-2 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                  Recommended
                </span>
              </h3>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Excel / CSV / File In Time exports — AI maps the columns
                for you.
              </p>
            </Link>
            <Link
              href="/clients/new"
              className="group flex flex-col rounded-lg border-2 border-border bg-card p-6 transition-all hover:border-slate-400 hover:bg-muted/30"
            >
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-muted text-foreground">
                <Plus className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">Add one manually</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Type in a single client — useful for testing or first-time
                practitioners.
              </p>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {clients.map((client) => (
        <Link
          key={client.id}
          href={`/clients/${client.id}`}
          className="flex items-center justify-between px-5 py-4 hover:bg-muted/40 transition-colors"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <div className="font-medium">{client.name}</div>
              {client.primaryContactEmail ? (
                <div className="text-xs text-muted-foreground">
                  {client.primaryContactEmail}
                </div>
              ) : null}
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            Added {new Date(client.createdAt).toLocaleDateString()}
          </div>
        </Link>
      ))}
    </div>
  );
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
