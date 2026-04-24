import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, Building2, User as UserIcon } from "lucide-react";
import { getCurrentContext } from "@/lib/auth/current-org";
import { getDb } from "@/lib/db";
import { clients, entities, deadlineInstances, deadlineRules } from "@/lib/db/schema";
import { isNull } from "drizzle-orm";
import { AddEntityForm } from "./add-entity-form";
import { ClientActions } from "./client-actions";
import { EntityActions } from "./entity-actions";

type Params = Promise<{ id: string }>;

// Outer component stays synchronous so PPR can prerender the static shell
// (back button). The async data-fetching child lives inside <Suspense>.
export default function ClientDetailPage({ params }: { params: Params }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-3">
        <Link href="/clients">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to clients
        </Link>
      </Button>

      <Suspense fallback={<DetailSkeleton />}>
        <ClientDetail params={params} />
      </Suspense>
    </div>
  );
}

async function ClientDetail({ params }: { params: Params }) {
  const { id } = await params;
  const ctx = await getCurrentContext();
  const db = getDb();

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.orgId, ctx.organization.id)))
    .limit(1);

  if (!client) notFound();

  const entityRows = await db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.clientId, id),
        eq(entities.orgId, ctx.organization.id),
        isNull(entities.archivedAt),
      ),
    );

  return (
    <div className="space-y-8">
      {/* Client header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {client.primaryContactEmail ? (
              <span>{client.primaryContactEmail}</span>
            ) : null}
            {client.primaryContactPhone ? (
              <span>{client.primaryContactPhone}</span>
            ) : null}
            <span>Added {new Date(client.createdAt).toLocaleDateString()}</span>
          </div>
          {client.notes ? (
            <p className="mt-3 max-w-2xl rounded border border-border bg-muted/30 p-3 text-sm">
              {client.notes}
            </p>
          ) : null}
        </div>
        <ClientActions client={client} />
      </div>

      {/* Entities */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Tax entities ({entityRows.length})
          </h2>
        </div>
        {entityRows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No entities yet</CardTitle>
              <CardDescription>
                Add an entity below. When you do, DueDateHQ generates the full
                deadline calendar for the current and next tax year
                automatically.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {entityRows.map((e) => (
              <EntityCard key={e.id} entity={e} orgId={ctx.organization.id} />
            ))}
          </div>
        )}
      </section>

      {/* Add entity form */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Add a tax entity</h2>
        <AddEntityForm clientId={id} />
      </section>
    </div>
  );
}

async function EntityCard({
  entity,
  orgId,
}: {
  entity: typeof entities.$inferSelect;
  orgId: string;
}) {
  const db = getDb();
  const deadlineCount = await db
    .select({ id: deadlineInstances.id })
    .from(deadlineInstances)
    .innerJoin(deadlineRules, eq(deadlineRules.id, deadlineInstances.ruleId))
    .where(
      and(
        eq(deadlineInstances.entityId, entity.id),
        eq(deadlineInstances.orgId, orgId),
      ),
    );

  const icon =
    entity.entityType === "individual" ? (
      <UserIcon className="h-4 w-4" />
    ) : (
      <Building2 className="h-4 w-4" />
    );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">{entity.name}</CardTitle>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant="secondary" className="font-mono text-xs">
                {entityTypeLabel(entity.entityType)}
              </Badge>
              {entity.homeState ? (
                <Badge variant="outline" className="text-xs">
                  {entity.homeState}
                </Badge>
              ) : null}
              {entity.operatingStates && entity.operatingStates.length > 1 ? (
                <Badge variant="outline" className="text-xs">
                  +{entity.operatingStates.length - 1} states
                </Badge>
              ) : null}
            </div>
          </div>
          <EntityActions
            entity={{
              id: entity.id,
              name: entity.name,
              entityType: entity.entityType,
              homeState: entity.homeState,
              operatingStates: entity.operatingStates ?? [],
              ein: entity.ein,
            }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {deadlineCount.length} deadlines generated
        </p>
      </CardContent>
    </Card>
  );
}

function entityTypeLabel(type: string): string {
  const map: Record<string, string> = {
    individual: "Individual",
    c_corp: "C-Corp",
    s_corp: "S-Corp",
    partnership: "Partnership",
    llc: "LLC",
    trust: "Trust",
    estate: "Estate",
    nonprofit: "Nonprofit",
  };
  return map[type] ?? type;
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      <div className="h-4 w-96 animate-pulse rounded bg-muted" />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/40" />
        <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/40" />
      </div>
    </div>
  );
}
