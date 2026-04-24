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
import { Plus, Users } from "lucide-react";
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
        <Button asChild>
          <Link href="/clients/new">
            <Plus className="mr-2 h-4 w-4" /> Add client
          </Link>
        </Button>
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
            Add your first client to get started. You&apos;ll then add their tax
            entities and DueDateHQ auto-generates the full-year deadline calendar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/clients/new">
              <Plus className="mr-2 h-4 w-4" /> Add your first client
            </Link>
          </Button>
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
